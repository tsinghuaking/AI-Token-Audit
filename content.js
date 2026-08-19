/**
 * content.js — 运行在隔离世界（ISOLATED world）
 * 职责：
 * 1. 把 injected.js 注入到页面主世界（MAIN world）
 * 2. 监听 injected.js 通过 window.postMessage 发来的消息
 * 3. 转发给 background service worker（chrome.runtime.sendMessage）
 * 4. 监听 background/popup 的查询请求，返回当前页面状态
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

// document_start 时 head 可能还不存在，用 MutationObserver 兜底
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

  // 转发给 background
  chrome.runtime.sendMessage({
    type: data.type,
    payload: {
      ...data.payload,
      pageUrl: location.href,
      pageTitle: document.title,
      tabId: chrome.runtime.id // 占位，background 会用 sender.tab.id
    }
  }).catch(() => {
    // service worker 可能休眠，忽略
  });
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
});
