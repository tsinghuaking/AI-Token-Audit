/**
 * injected.js — 运行在页面主世界（MAIN world）
 * 职责：hook fetch 和 XMLHttpRequest，拦截 AI API 调用，
 *       解析请求/响应，提取 model、usage、SSE 流式数据，
 *       通过 window.postMessage 转发给 content script。
 *
 * 设计原则：
 * 1. 用 Response.tee() 分叉流，一份还给页面，一份自己解析，不影响原站点。
 * 2. SSE 流式响应逐块解析，流结束时取最终 usage；中间用本地估算。
 * 3. 只做数据采集，不做存储和UI，全部转发。
 */
(function () {
  'use strict';

  const EXT_ID = '__ai_token_monitor__';
  const SSE_DONE = '[DONE]';

  // ---------- 工具函数 ----------

  /** 安全解析 JSON，失败返回 null */
  function safeJSON(text) {
    try { return JSON.parse(text); } catch { return null; }
  }

  /** 从 URL 推断协议类型 */
  function detectProtocol(url) {
    if (/\/v1\/chat\/completions/i.test(url)) return 'openai-chat';
    if (/\/v1\/completions/i.test(url)) return 'openai-completion';
    if (/\/v1\/messages/i.test(url)) return 'anthropic';
    if (/generateContent|streamGenerateContent/i.test(url)) return 'gemini';
    if (/\/v1\/embeddings/i.test(url)) return 'openai-embedding';
    return 'unknown';
  }

  /** 从请求体提取 model 字段 */
  function extractModelFromBody(body) {
    if (!body) return null;
    if (typeof body === 'string') {
      const parsed = safeJSON(body);
      return parsed ? (parsed.model || parsed.model_name || null) : null;
    }
    if (body.model) return body.model;
    return null;
  }

  /** 从请求体提取 messages 文本（用于本地 token 估算） */
  function extractInputText(body) {
    if (!body) return '';
    const parsed = typeof body === 'string' ? safeJSON(body) : body;
    if (!parsed) return '';
    if (Array.isArray(parsed.messages)) {
      return parsed.messages.map(m => m.content || '').join('\n');
    }
    if (parsed.prompt) {
      return Array.isArray(parsed.prompt) ? parsed.prompt.join('\n') : String(parsed.prompt);
    }
    if (parsed.input) {
      return Array.isArray(parsed.input) ? parsed.input.join('\n') : String(parsed.input);
    }
    return '';
  }

  /** 生成唯一ID */
  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------- 消息转发 ----------

  function sendToExtension(type, payload) {
    window.postMessage({
      source: EXT_ID,
      type,
      payload
    }, '*');
  }

  // ---------- SSE 流式解析器 ----------

  /**
   * 解析 SSE 流，返回 { chunks: [], finalUsage, fullText }
   * 支持 OpenAI 风格 data: {...} 和 Anthropic 风格 event: ...
   */
  async function parseSSEStream(stream, protocol) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const chunks = [];
    let finalUsage = null;
    let fullText = '';
    let lastEvent = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Anthropic 风格 event 行
        if (trimmed.startsWith('event:')) {
          lastEvent = trimmed.slice(6).trim();
          continue;
        }

        // data 行
        if (trimmed.startsWith('data:')) {
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === SSE_DONE) continue;

          const data = safeJSON(dataStr);
          if (!data) continue;

          chunks.push(data);

          // OpenAI 风格：delta.content
          if (data.choices && data.choices[0]) {
            const delta = data.choices[0].delta || data.choices[0].message;
            if (delta && delta.content) {
              if (typeof delta.content === 'string') fullText += delta.content;
              else if (Array.isArray(delta.content)) {
                fullText += delta.content.map(c => c.text || '').join('');
              }
            }
            // 最终 usage（OpenAI 在最后一个 chunk 或单独 chunk 返回）
            if (data.usage) finalUsage = data.usage;
            if (data.choices[0].usage) finalUsage = data.choices[0].usage;
          }

          // Anthropic 风格
          if (protocol === 'anthropic') {
            if (lastEvent === 'content_block_delta' && data.delta && data.delta.text) {
              fullText += data.delta.text;
            }
            if (lastEvent === 'message_delta' && data.usage) {
              finalUsage = data.usage;
            }
            if (data.type === 'message' && data.usage) {
              finalUsage = data.usage;
            }
            if (data.content && Array.isArray(data.content)) {
              fullText += data.content.map(c => c.text || '').join('');
            }
          }

          // Gemini 风格
          if (protocol === 'gemini') {
            if (data.candidates && data.candidates[0] && data.candidates[0].content) {
              const parts = data.candidates[0].content.parts || [];
              fullText += parts.map(p => p.text || '').join('');
            }
            if (data.usageMetadata) finalUsage = data.usageMetadata;
          }
        }
      }
    }

    // 处理 buffer 剩余
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith('data:')) {
        const dataStr = trimmed.slice(5).trim();
        if (dataStr !== SSE_DONE) {
          const data = safeJSON(dataStr);
          if (data) {
            chunks.push(data);
            if (data.usage) finalUsage = data.usage;
          }
        }
      }
    }

    return { chunks, finalUsage, fullText };
  }

  // ---------- 非流式响应解析 ----------

  function parseNonStreaming(data, protocol) {
    let usage = null;
    let outputText = '';
    let model = null;

    if (protocol.startsWith('openai')) {
      usage = data.usage || null;
      model = data.model || null;
      if (data.choices && data.choices[0]) {
        const msg = data.choices[0].message || data.choices[0].text;
        if (msg) {
          outputText = typeof msg === 'string' ? msg : (msg.content || '');
        }
      }
    } else if (protocol === 'anthropic') {
      usage = data.usage || null;
      model = data.model || null;
      if (data.content && Array.isArray(data.content)) {
        outputText = data.content.map(c => c.text || '').join('');
      }
    } else if (protocol === 'gemini') {
      usage = data.usageMetadata || null;
      model = data.modelVersion || null;
      if (data.candidates && data.candidates[0] && data.candidates[0].content) {
        const parts = data.candidates[0].content.parts || [];
        outputText = parts.map(p => p.text || '').join('');
      }
    }

    return { usage, outputText, model };
  }

  // ---------- 统一 usage 规范化 ----------

  function normalizeUsage(usage, protocol) {
    if (!usage) return null;
    if (protocol === 'anthropic') {
      return {
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
        cache_read_input_tokens: usage.cache_read_input_tokens || 0,
        total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0)
      };
    }
    if (protocol === 'gemini') {
      return {
        input_tokens: usage.promptTokenCount || 0,
        output_tokens: usage.candidatesTokenCount || 0,
        total_tokens: usage.totalTokenCount || 0
      };
    }
    // OpenAI 兼容
    return {
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0,
      total_tokens: usage.total_tokens || 0,
      reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens || 0
    };
  }

  // ---------- Hook fetch ----------

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = args[0] instanceof Request ? args[0].url : String(args[0]);
    const init = args[1] || {};
    const method = (init.method || (args[0] instanceof Request ? args[0].method : 'GET') || 'GET').toUpperCase();

    // 只关注 POST 请求（AI API 基本都是 POST）
    if (method !== 'POST') {
      return originalFetch.apply(this, args);
    }

    const protocol = detectProtocol(url);
    if (protocol === 'unknown') {
      return originalFetch.apply(this, args);
    }

    const callId = genId();
    const startTime = performance.now();
    const reqBody = init.body || (args[0] instanceof Request ? args[0].body : null);
    const model = extractModelFromBody(reqBody);
    const inputText = extractInputText(reqBody);
    const isStream = /"stream"\s*:\s*true/i.test(typeof reqBody === 'string' ? reqBody : JSON.stringify(reqBody || {}));

    // 通知：请求开始
    sendToExtension('call:start', {
      callId,
      url,
      protocol,
      model,
      method,
      isStream,
      inputText: inputText.slice(0, 2048),
      inputTextLength: inputText.length,
      timestamp: Date.now()
    });

    try {
      const response = await originalFetch.apply(this, args);
      const status = response.status;
      const contentType = response.headers.get('content-type') || '';
      const isSSE = contentType.includes('text/event-stream') || isStream;

      // 克隆响应用于解析
      const cloned = response.clone();

      if (isSSE && cloned.body) {
        // 流式：tee 分叉
        const [streamForPage, streamForParse] = cloned.body.tee();
        const pageResponse = new Response(streamForPage, {
          status: cloned.status,
          statusText: cloned.statusText,
          headers: cloned.headers
        });

        // 异步解析，不阻塞页面
        parseSSEStream(streamForParse, protocol).then(({ finalUsage, fullText }) => {
          const duration = performance.now() - startTime;
          const usage = normalizeUsage(finalUsage, protocol);
          sendToExtension('call:end', {
            callId,
            status,
            duration,
            isStream: true,
            usage,
            outputText: fullText.slice(0, 2048),
            outputTextLength: fullText.length,
            timestamp: Date.now()
          });
        }).catch(err => {
          sendToExtension('call:error', { callId, error: String(err) });
        });

        return pageResponse;
      } else {
        // 非流式：读取 JSON
        cloned.text().then(text => {
          const duration = performance.now() - startTime;
          const data = safeJSON(text);
          if (data) {
            const { usage, outputText, model: respModel } = parseNonStreaming(data, protocol);
            sendToExtension('call:end', {
              callId,
              status,
              duration,
              isStream: false,
              usage: normalizeUsage(usage, protocol),
              outputText: (outputText || '').slice(0, 2048),
              outputTextLength: (outputText || '').length,
              responseModel: respModel || model,
              timestamp: Date.now()
            });
          } else {
            sendToExtension('call:end', {
              callId,
              status,
              duration,
              isStream: false,
              usage: null,
              outputText: '',
              outputTextLength: 0,
              timestamp: Date.now()
            });
          }
        }).catch(err => {
          sendToExtension('call:error', { callId, error: String(err) });
        });

        return response;
      }
    } catch (err) {
      sendToExtension('call:error', { callId, error: String(err) });
      throw err;
    }
  };

  // ---------- Hook XMLHttpRequest ----------

  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__atm_url = String(url);
    this.__atm_method = method.toUpperCase();
    this.__atm_protocol = detectProtocol(this.__atm_url);
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (this.__atm_method !== 'POST' || this.__atm_protocol === 'unknown') {
      return originalXHRSend.apply(this, arguments);
    }

    const callId = genId();
    const startTime = performance.now();
    const model = extractModelFromBody(body);
    const inputText = extractInputText(body);
    const isStream = /"stream"\s*:\s*true/i.test(typeof body === 'string' ? body : JSON.stringify(body || {}));

    sendToExtension('call:start', {
      callId,
      url: this.__atm_url,
      protocol: this.__atm_protocol,
      model,
      method: this.__atm_method,
      isStream,
      inputText: inputText.slice(0, 2048),
      inputTextLength: inputText.length,
      timestamp: Date.now()
    });

    this.addEventListener('loadend', function () {
      const duration = performance.now() - startTime;
      const status = this.status;
      const contentType = this.getResponseHeader('content-type') || '';
      const responseText = this.responseText || '';

      if (contentType.includes('text/event-stream') || isStream) {
        // SSE over XHR：逐行解析
        const lines = responseText.split('\n');
        let finalUsage = null;
        let fullText = '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === SSE_DONE) continue;
          const data = safeJSON(dataStr);
          if (!data) continue;
          if (data.choices && data.choices[0]) {
            const delta = data.choices[0].delta || data.choices[0].message;
            if (delta && delta.content) {
              fullText += typeof delta.content === 'string' ? delta.content : '';
            }
            if (data.usage) finalUsage = data.usage;
          }
          if (this.__atm_protocol === 'anthropic' && data.usage) finalUsage = data.usage;
        }
        sendToExtension('call:end', {
          callId,
          status,
          duration,
          isStream: true,
          usage: normalizeUsage(finalUsage, this.__atm_protocol),
          outputText: fullText.slice(0, 2048),
          outputTextLength: fullText.length,
          timestamp: Date.now()
        });
      } else {
        const data = safeJSON(responseText);
        if (data) {
          const { usage, outputText, model: respModel } = parseNonStreaming(data, this.__atm_protocol);
          sendToExtension('call:end', {
            callId,
            status,
            duration,
            isStream: false,
            usage: normalizeUsage(usage, this.__atm_protocol),
            outputText: (outputText || '').slice(0, 2048),
            outputTextLength: (outputText || '').length,
            responseModel: respModel || model,
            timestamp: Date.now()
          });
        } else {
          sendToExtension('call:end', {
            callId,
            status,
            duration,
            isStream: false,
            usage: null,
            outputText: '',
            outputTextLength: 0,
            timestamp: Date.now()
          });
        }
      }
    });

    return originalXHRSend.apply(this, arguments);
  };

  // 通知注入成功
  sendToExtension('injected:ready', { timestamp: Date.now() });
})();
