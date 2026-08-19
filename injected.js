/**
 * injected.js — 运行在页面主世界（MAIN world）
 * 职责：hook fetch 和 XMLHttpRequest，拦截 AI API 调用，
 *       解析请求/响应，提取 model、usage、SSE 流式数据，
 *       通过 window.postMessage 转发给 content script。
 *
 * 支持协议：
 * - OpenAI 兼容 API（/v1/chat/completions 等）
 * - Anthropic API（/v1/messages）
 * - Google Gemini API（generateContent）
 * - ChatGPT 官网（/backend-api/conversation）
 * - Claude 官网（/api/.../chat_conversations）
 * - Gemini 官网（/_/BardChatUi/data/）
 * - 豆包、Kimi、通义等国内平台
 * - 通用兜底：请求体含 model+messages 的 POST 请求
 */
(function () {
  'use strict';

  const EXT_ID = '__ai_token_audit__';
  const SSE_DONE = '[DONE]';

  // ---------- 工具函数 ----------

  function safeJSON(text) {
    try { return JSON.parse(text); } catch { return null; }
  }

  /** 从 URL 推断协议类型 */
  function detectProtocol(url, body) {
    // 标准 API
    if (/\/v1\/chat\/completions/i.test(url)) return 'openai-chat';
    if (/\/v1\/completions/i.test(url)) return 'openai-completion';
    if (/\/v1\/messages/i.test(url)) return 'anthropic';
    if (/generateContent|streamGenerateContent/i.test(url)) return 'gemini';
    if (/\/v1\/embeddings/i.test(url)) return 'openai-embedding';

    // ChatGPT 官网
    if (/\/backend-api\/conversation/i.test(url)) return 'chatgpt-web';
    if (/chatgpt\.com\/backend-api/i.test(url)) return 'chatgpt-web';
    if (/chat\.openai\.com\/backend-api/i.test(url)) return 'chatgpt-web';

    // Claude 官网
    if (/claude\.ai\/api\/.*chat_conversations/i.test(url)) return 'claude-web';
    if (/\/api\/organizations\/.*chat_conversations/i.test(url)) return 'claude-web';

    // Gemini 官网
    if (/gemini\.google\.com\/_\/BardChatUi/i.test(url)) return 'gemini-web';

    // 国内平台
    if (/doubao\.com\/api/i.test(url)) return 'doubao-web';
    if (/kimi\.moonshot\.cn\/api/i.test(url)) return 'kimi-web';
    if (/tongyi\.aliyun\.com\/api/i.test(url)) return 'qwen-web';
    if (/yiyan\.baidu\.com\/api/i.test(url)) return 'wenxin-web';
    if (/deepseek\.com\/api/i.test(url)) return 'deepseek-web';

    // 通用兜底：如果 POST body 包含 model 和 messages/input，视为 OpenAI 兼容
    if (body) {
      const parsed = typeof body === 'string' ? safeJSON(body) : body;
      if (parsed && parsed.model && (parsed.messages || parsed.input || parsed.prompt)) {
        return 'openai-chat';
      }
    }

    return 'unknown';
  }

  /** 从请求体提取 model 字段 */
  function extractModelFromBody(body, protocol) {
    if (!body) return null;
    const parsed = typeof body === 'string' ? safeJSON(body) : body;
    if (!parsed) return null;

    // ChatGPT 官网：model 在顶层
    if (parsed.model) return parsed.model;
    if (parsed.model_name) return parsed.model_name;

    // Claude 官网：可能在 body 里
    if (parsed.model) return parsed.model;

    return null;
  }

  /** 从请求体提取输入文本（用于本地 token 估算） */
  function extractInputText(body, protocol) {
    if (!body) return '';
    const parsed = typeof body === 'string' ? safeJSON(body) : body;
    if (!parsed) return '';

    // ChatGPT 官网格式：messages[].author.role / messages[].content.parts[]
    if (protocol === 'chatgpt-web' && Array.isArray(parsed.messages)) {
      return parsed.messages.map(m => {
        if (m.content && Array.isArray(m.content.parts)) {
          return m.content.parts.filter(p => typeof p === 'string').join('');
        }
        if (typeof m.content === 'string') return m.content;
        return '';
      }).join('\n');
    }

    // Claude 官网格式
    if (protocol === 'claude-web') {
      if (parsed.text) return String(parsed.text);
      if (Array.isArray(parsed.messages)) {
        return parsed.messages.map(m => {
          if (typeof m.content === 'string') return m.content;
          if (Array.isArray(m.content)) return m.content.map(c => c.text || '').join('');
          return '';
        }).join('\n');
      }
    }

    // 标准 OpenAI 格式
    if (Array.isArray(parsed.messages)) {
      return parsed.messages.map(m => {
        if (typeof m.content === 'string') return m.content;
        if (Array.isArray(m.content)) return m.content.map(c => c.text || '').join('');
        return '';
      }).join('\n');
    }

    if (parsed.prompt) {
      return Array.isArray(parsed.prompt) ? parsed.prompt.join('\n') : String(parsed.prompt);
    }
    if (parsed.input) {
      return Array.isArray(parsed.input) ? parsed.input.join('\n') : String(parsed.input);
    }
    if (parsed.text) return String(parsed.text);

    return '';
  }

  /** 判断是否为流式请求 */
  function detectStream(body, protocol, contentType) {
    if (contentType && contentType.includes('text/event-stream')) return true;
    if (protocol === 'chatgpt-web') return true; // ChatGPT 官网基本都是流式
    if (protocol === 'claude-web') return true;
    if (protocol === 'gemini-web') return true;
    if (typeof body === 'string') {
      return /"stream"\s*:\s*true/i.test(body);
    }
    if (body && typeof body === 'object') {
      return body.stream === true;
    }
    return false;
  }

  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------- 消息转发 ----------

  function sendToExtension(type, payload) {
    window.postMessage({ source: EXT_ID, type, payload }, '*');
  }

  // ---------- 通用：从任意 JSON 对象中提取文本 ----------

  function extractTextFromObject(obj) {
    if (!obj || typeof obj !== 'object') return '';
    let text = '';

    // OpenAI 风格
    if (obj.choices && obj.choices[0]) {
      const c = obj.choices[0];
      if (c.delta) {
        if (typeof c.delta.content === 'string') text += c.delta.content;
        else if (Array.isArray(c.delta.content)) text += c.delta.content.map(x => x.text || '').join('');
      }
      if (c.message && typeof c.message.content === 'string') text += c.message.content;
    }

    // Anthropic 风格
    if (obj.delta && obj.delta.text) text += obj.delta.text;
    if (obj.content && Array.isArray(obj.content)) {
      text += obj.content.map(c => c.text || '').join('');
    }

    // Gemini 风格
    if (obj.candidates && obj.candidates[0] && obj.candidates[0].content) {
      const parts = obj.candidates[0].content.parts || [];
      text += parts.map(p => p.text || '').join('');
    }

    // ChatGPT 官网风格
    if (obj.message && obj.message.content) {
      const mc = obj.message.content;
      if (Array.isArray(mc)) {
        text += mc.map(c => {
          if (typeof c === 'string') return c;
          if (c.text) return c.text;
          if (c.parts) return c.parts.filter(p => typeof p === 'string').join('');
          return '';
        }).join('');
      }
    }
    if (obj.delta && typeof obj.delta === 'string') text += obj.delta;

    // 通用兜底：常见字段名
    if (obj.text && typeof obj.text === 'string') text += obj.text;
    if (obj.content && typeof obj.content === 'string') text += obj.content;
    if (obj.answer && typeof obj.answer === 'string') text += obj.answer;
    if (obj.result && typeof obj.result === 'string') text += obj.result;

    return text;
  }

  /** 从任意对象提取 usage */
  function extractUsageFromObject(obj) {
    if (!obj) return null;
    // 标准字段
    if (obj.usage) return obj.usage;
    if (obj.usageMetadata) return obj.usageMetadata;
    // ChatGPT 官网可能在 message.usage
    if (obj.message && obj.message.usage) return obj.message.usage;
    // 嵌套在 choices 里
    if (obj.choices && obj.choices[0] && obj.choices[0].usage) return obj.choices[0].usage;
    return null;
  }

  // ---------- SSE 流式解析器 ----------

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

        // event 行
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

          // 提取文本（通用方式，覆盖所有协议）
          fullText += extractTextFromObject(data);

          // ChatGPT 官网：event: delta 的 data.delta 是纯字符串
          if (protocol === 'chatgpt-web' && lastEvent === 'delta' && typeof data.delta === 'string') {
            fullText += data.delta;
          }

          // 提取 usage
          const usage = extractUsageFromObject(data);
          if (usage) finalUsage = usage;
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
            fullText += extractTextFromObject(data);
            const usage = extractUsageFromObject(data);
            if (usage) finalUsage = usage;
          }
        }
      }
    }

    return { chunks, finalUsage, fullText };
  }

  // ---------- 非流式响应解析 ----------

  function parseNonStreaming(data, protocol) {
    let usage = extractUsageFromObject(data);
    let outputText = extractTextFromObject(data);
    let model = data.model || data.modelVersion || null;

    // ChatGPT 官网
    if (protocol === 'chatgpt-web' && data.message) {
      model = data.message.model || model;
    }

    return { usage, outputText, model };
  }

  // ---------- 统一 usage 规范化 ----------

  function normalizeUsage(usage, protocol) {
    if (!usage) return null;

    // Anthropic
    if (protocol === 'anthropic' || usage.input_tokens !== undefined) {
      return {
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
        cache_read_input_tokens: usage.cache_read_input_tokens || 0,
        total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0)
      };
    }

    // Gemini
    if (protocol === 'gemini' || usage.promptTokenCount !== undefined) {
      return {
        input_tokens: usage.promptTokenCount || 0,
        output_tokens: usage.candidatesTokenCount || 0,
        total_tokens: usage.totalTokenCount || 0
      };
    }

    // OpenAI 兼容（默认）
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

    if (method !== 'POST') {
      return originalFetch.apply(this, args);
    }

    const reqBody = init.body || (args[0] instanceof Request ? args[0].body : null);
    const protocol = detectProtocol(url, reqBody);

    if (protocol === 'unknown') {
      return originalFetch.apply(this, args);
    }

    const callId = genId();
    const startTime = performance.now();
    const model = extractModelFromBody(reqBody, protocol);
    const inputText = extractInputText(reqBody, protocol);

    sendToExtension('call:start', {
      callId, url, protocol, model, method,
      isStream: true, // 先假设流式，后面根据响应修正
      inputText: inputText.slice(0, 2048),
      inputTextLength: inputText.length,
      timestamp: Date.now()
    });

    try {
      const response = await originalFetch.apply(this, args);
      const status = response.status;
      const contentType = response.headers.get('content-type') || '';
      const isSSE = detectStream(reqBody, protocol, contentType);
      const cloned = response.clone();

      if (isSSE && cloned.body) {
        const [streamForPage, streamForParse] = cloned.body.tee();
        const pageResponse = new Response(streamForPage, {
          status: cloned.status,
          statusText: cloned.statusText,
          headers: cloned.headers
        });

        parseSSEStream(streamForParse, protocol).then(({ finalUsage, fullText }) => {
          const duration = performance.now() - startTime;
          sendToExtension('call:end', {
            callId, status, duration,
            isStream: true,
            usage: normalizeUsage(finalUsage, protocol),
            outputText: fullText.slice(0, 2048),
            outputTextLength: fullText.length,
            timestamp: Date.now()
          });
        }).catch(err => {
          sendToExtension('call:error', { callId, error: String(err) });
        });

        return pageResponse;
      } else {
        cloned.text().then(text => {
          const duration = performance.now() - startTime;
          const data = safeJSON(text);
          if (data) {
            const { usage, outputText, model: respModel } = parseNonStreaming(data, protocol);
            sendToExtension('call:end', {
              callId, status, duration,
              isStream: false,
              usage: normalizeUsage(usage, protocol),
              outputText: (outputText || '').slice(0, 2048),
              outputTextLength: (outputText || '').length,
              responseModel: respModel || model,
              timestamp: Date.now()
            });
          } else {
            sendToExtension('call:end', {
              callId, status, duration,
              isStream: false, usage: null,
              outputText: '', outputTextLength: 0,
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
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (this.__atm_method !== 'POST') {
      return originalXHRSend.apply(this, arguments);
    }

    const protocol = detectProtocol(this.__atm_url, body);
    if (protocol === 'unknown') {
      return originalXHRSend.apply(this, arguments);
    }

    this.__atm_protocol = protocol;
    const callId = genId();
    const startTime = performance.now();
    const model = extractModelFromBody(body, protocol);
    const inputText = extractInputText(body, protocol);

    sendToExtension('call:start', {
      callId, url: this.__atm_url, protocol, model,
      method: this.__atm_method, isStream: true,
      inputText: inputText.slice(0, 2048),
      inputTextLength: inputText.length,
      timestamp: Date.now()
    });

    this.addEventListener('loadend', function () {
      const duration = performance.now() - startTime;
      const status = this.status;
      const contentType = this.getResponseHeader('content-type') || '';
      const responseText = this.responseText || '';
      const isSSE = detectStream(body, this.__atm_protocol, contentType);

      if (isSSE) {
        let finalUsage = null;
        let fullText = '';
        const lines = responseText.split('\n');
        let lastEvent = null;
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('event:')) {
            lastEvent = trimmed.slice(6).trim();
            continue;
          }
          if (!trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === SSE_DONE) continue;
          const data = safeJSON(dataStr);
          if (!data) continue;
          fullText += extractTextFromObject(data);
          if (this.__atm_protocol === 'chatgpt-web' && lastEvent === 'delta' && typeof data.delta === 'string') {
            fullText += data.delta;
          }
          const usage = extractUsageFromObject(data);
          if (usage) finalUsage = usage;
        }
        sendToExtension('call:end', {
          callId, status, duration, isStream: true,
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
            callId, status, duration, isStream: false,
            usage: normalizeUsage(usage, this.__atm_protocol),
            outputText: (outputText || '').slice(0, 2048),
            outputTextLength: (outputText || '').length,
            responseModel: respModel || model,
            timestamp: Date.now()
          });
        } else {
          sendToExtension('call:end', {
            callId, status, duration, isStream: false,
            usage: null, outputText: '', outputTextLength: 0,
            timestamp: Date.now()
          });
        }
      }
    });

    return originalXHRSend.apply(this, arguments);
  };

  sendToExtension('injected:ready', { timestamp: Date.now() });
})();
