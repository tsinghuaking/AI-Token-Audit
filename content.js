/**
 * content.js — 运行在隔离世界（ISOLATED world）
 * 职责：
 * 1. 把 injected.js 注入到页面主世界（MAIN world）
 * 2. 监听 injected.js 通过 window.postMessage 发来的消息
 * 3. 转发给 background service worker（chrome.runtime.sendMessage）
 * 4. 监听 background/popup 的查询请求，返回当前页面状态
 * 5. 转发强制统计模式（forceMode）给 injected.js
 */
const EXT_ID = '__ai_token_audit__';
const INJECTED_FLAG = '__ai_token_audit_injected__';

// ---------- 注入 injected.js 到页面主世界 ----------
function injectScript() {
  if (window[INJECTED_FLAG]) return;
  window[INJECTED_FLAG] = true;
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  script.async = false;
  script.onload = function () {
    script.remove();
  };
  (document.head || document.documentElement).appendChild(script);
}

if (document.documentElement) {
  injectScript();
} else {
  document.addEventListener('DOMContentLoaded', injectScript, { once: true });
}

// ---------- 消息桥接：页面 → 扩展 ----------
window.addEventListener('message', function (event) {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== EXT_ID) return;
  chrome.runtime.sendMessage({
    type: data.type,
    payload: {
      ...data.payload,
      pageUrl: location.href,
      pageTitle: document.title,
      tabId: chrome.runtime.id
    }
  }).catch(() => {});
});

// ---------- 响应 popup/background 的查询 ----------
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.type === 'ping') {
    sendResponse({ alive: true, url: location.href });
    return true;
  }
  if (msg.type === 'getPageInfo') {
    sendResponse({ url: location.href, title: document.title });
    return true;
  }
  // 转发强制模式设置给 injected.js
  if (msg.type === 'forceMode:set') {
    window.postMessage({ source: EXT_ID, type: 'forceMode:set', enabled: msg.enabled }, '*');
    sendResponse({ ok: true });
    return true;
  }
});

// 页面加载后检查当前域名是否在白名单中，如果是则自动启用强制模式
(async function () {
  try {
    const url = new URL(location.href);
    const resp = await chrome.runtime.sendMessage({ type: 'isDomainTracked', payload: { domain: url.hostname } });
    if (resp && resp.ok && resp.tracked) {
      const sendForceMode = () => window.postMessage({ source: EXT_ID, type: 'forceMode:set', enabled: true }, '*');
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(sendForceMode, 500));
      } else {
        setTimeout(sendForceMode, 500);
      }
    }
  } catch {}
})();
