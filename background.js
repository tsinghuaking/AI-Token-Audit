/**
 * background.js — Service Worker（中央枢纽）
 * 职责：
 * 1. 接收 content script 转发的 call:start / call:end / call:error 消息
 * 2. 合并 start+end 为完整记录，写入 IndexedDB
 * 3. 计算成本（基于用户配置的价格表）
 * 4. 本地 token 估算（当 API 不返回 usage 时）
 * 5. 告警检测与通知
 * 6. 响应 popup/options 的查询请求
 */

import { addRecord, updateRecordByCallId, getStats, queryRecords, clearAllRecords, exportAllJSON, exportAllCSV, deleteRecord } from './lib/storage.js';
import { estimateInputOutput } from './lib/tokenizer.js';
import { calculateCost, DEFAULT_PRICING } from './lib/pricing.js';

// ---------- 配置管理 ----------

const DEFAULT_SETTINGS = {
  pricing: DEFAULT_PRICING,
  alerts: {
    enabled: false,
    dailyTokenThreshold: 100000,
    dailyCostThreshold: 1.0,
    perCallTokenThreshold: 10000,
    perCallCostThreshold: 0.1
  },
  language: 'auto'
};

async function getSettings() {
  const stored = await chrome.storage.local.get('atm_settings');
  return { ...DEFAULT_SETTINGS, ...(stored.atm_settings || {}) };
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ atm_settings: settings });
}

// ---------- 域名白名单（统计本站） ----------
async function getTrackedDomains() {
  const stored = await chrome.storage.local.get('atm_tracked_domains');
  return stored.atm_tracked_domains || [];
}
async function isDomainTracked(domain) {
  const list = await getTrackedDomains();
  return list.includes(domain);
}
async function toggleDomainTracking(domain, enable) {
  let list = await getTrackedDomains();
  if (enable) {
    if (!list.includes(domain)) list.push(domain);
  } else {
    list = list.filter(d => d !== domain);
  }
  await chrome.storage.local.set({ atm_tracked_domains: list });
  // 通知所有匹配的 tab 启用/禁用强制模式
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.url) continue;
    try {
      const url = new URL(tab.url);
      if (url.hostname === domain) {
        chrome.tabs.sendMessage(tab.id, { type: 'forceMode:set', enabled: enable }).catch(() => {});
      }
    } catch {}
  }
  return list;
}

// ---------- 告警状态追踪 ----------

const alertState = {
  dailyTokenAlerted: null,  // 记录已告警的日期
  dailyCostAlerted: null
};

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function checkAlerts(record, settings) {
  if (!settings.alerts.enabled) return;
  const a = settings.alerts;

  // 单次调用告警
  const usage = record.usage || record.estimated || {};
  const totalTokens = usage.total_tokens || 0;
  const totalCost = (record.cost && record.cost.total_cost) || 0;

  if (a.perCallTokenThreshold && totalTokens >= a.perCallTokenThreshold) {
    sendNotification('alertPerCallTokenTitle', 'alertPerCallTokenMsg', {
      value: totalTokens.toLocaleString(),
      threshold: a.perCallTokenThreshold.toLocaleString()
    });
  }
  if (a.perCallCostThreshold && totalCost >= a.perCallCostThreshold) {
    sendNotification('alertPerCallCostTitle', 'alertPerCallCostMsg', {
      value: totalCost.toFixed(4),
      threshold: a.perCallCostThreshold.toFixed(4)
    });
  }

  // 每日累计告警
  const today = getTodayKey();
  const stats = await getStats({ day: today });

  if (a.dailyTokenThreshold && stats.totalTokens >= a.dailyTokenThreshold) {
    if (alertState.dailyTokenAlerted !== today) {
      alertState.dailyTokenAlerted = today;
      sendNotification('alertDailyTokenTitle', 'alertDailyTokenMsg', {
        value: stats.totalTokens.toLocaleString(),
        threshold: a.dailyTokenThreshold.toLocaleString()
      });
    }
  }
  if (a.dailyCostThreshold && stats.totalCost >= a.dailyCostThreshold) {
    if (alertState.dailyCostAlerted !== today) {
      alertState.dailyCostAlerted = today;
      sendNotification('alertDailyCostTitle', 'alertDailyCostMsg', {
        value: stats.totalCost.toFixed(4),
        threshold: a.dailyCostThreshold.toFixed(4)
      });
    }
  }
}

function sendNotification(titleKey, msgKey, params) {
  // 简单通知，i18n 在 popup 侧处理，这里用英文兜底
  const title = titleKey.includes('Daily') ? 'Daily Alert' : 'Per-call Alert';
  const msg = `Threshold reached: ${params.value} / ${params.threshold}`;
  chrome.notifications.create(`atm_${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message: msg,
    priority: 1
  }).catch(() => {});
}

// ---------- 消息处理 ----------

// 暂存 call:start 的数据，等 call:end 到来时合并
const pendingCalls = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'call:start': {
          const payload = msg.payload;
          pendingCalls.set(payload.callId, {
            ...payload,
            tabId: sender.tab ? sender.tab.id : null
          });
          // 实时通知 popup（如果打开着）
          chrome.runtime.sendMessage({ type: 'realtime:start', payload }).catch(() => {});
          sendResponse({ ok: true });
          break;
        }

        case 'call:end': {
          const payload = msg.payload;
          const startData = pendingCalls.get(payload.callId) || {};
          pendingCalls.delete(payload.callId);

          const settings = await getSettings();
          const model = payload.responseModel || startData.model || 'unknown';

          // 如果没有精确 usage，用本地估算
          let usage = payload.usage;
          let isEstimated = false;
          if (!usage || (!usage.input_tokens && !usage.output_tokens)) {
            usage = estimateInputOutput(
              startData.inputText || '',
              payload.outputText || '',
              model
            );
            isEstimated = true;
          }

          // 计算成本
          const cost = calculateCost(usage, model, settings.pricing);

          const record = {
            callId: payload.callId,
            url: startData.url || payload.url,
            pageUrl: startData.pageUrl || payload.pageUrl,
            pageTitle: startData.pageTitle || payload.pageTitle,
            tabId: startData.tabId || (sender.tab ? sender.tab.id : null),
            protocol: startData.protocol || payload.protocol || 'unknown',
            model,
            method: startData.method || 'POST',
            isStream: payload.isStream || false,
            status: payload.status,
            duration: payload.duration,
            inputText: startData.inputText || '',
            inputTextLength: startData.inputTextLength || 0,
            outputText: payload.outputText || '',
            outputTextLength: payload.outputTextLength || 0,
            usage,
            estimated: isEstimated ? usage : null,
            isEstimated,
            cost,
            timestamp: payload.timestamp || Date.now()
          };

          const id = await addRecord(record);
          record.id = id;

          // 告警检测
          await checkAlerts(record, settings);

          // 通知 popup 更新
          chrome.runtime.sendMessage({ type: 'realtime:end', payload: record }).catch(() => {});
          sendResponse({ ok: true, id });
          break;
        }

        case 'call:error': {
          pendingCalls.delete(msg.payload.callId);
          sendResponse({ ok: true });
          break;
        }

        // popup/options 查询接口
        case 'getRecords': {
          const records = await queryRecords(msg.payload || {});
          sendResponse({ ok: true, records });
          break;
        }

        case 'getStats': {
          const stats = await getStats(msg.payload || {});
          sendResponse({ ok: true, stats });
          break;
        }

        case 'getSettings': {
          const settings = await getSettings();
          sendResponse({ ok: true, settings });
          break;
        }

        case 'saveSettings': {
          await saveSettings(msg.payload);
          sendResponse({ ok: true });
          break;
        }
        case 'isDomainTracked': {
          const tracked = await isDomainTracked(msg.payload.domain);
          sendResponse({ ok: true, tracked });
          break;
        }
        case 'toggleDomainTracking': {
          await toggleDomainTracking(msg.payload.domain, msg.payload.enable);
          sendResponse({ ok: true });
          break;
        }

        case 'deleteRecord': {
          await deleteRecord(msg.payload.id);
          sendResponse({ ok: true });
          break;
        }

        case 'clearAll': {
          await clearAllRecords();
          sendResponse({ ok: true });
          break;
        }

        case 'exportJSON': {
          const data = await exportAllJSON();
          sendResponse({ ok: true, data });
          break;
        }

        case 'exportCSV': {
          const csv = await exportAllCSV();
          sendResponse({ ok: true, csv });
          break;
        }

        default:
          sendResponse({ ok: false, error: 'unknown type' });
      }
    } catch (err) {
      console.error('[ATM] background error:', err);
      sendResponse({ ok: false, error: String(err) });
    }
  })();
  return true; // 保持消息通道开放，等待异步响应
});

// 安装时初始化
chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await saveSettings(settings);
  console.log('[ATM] Extension installed, settings initialized.');
});

// 页面加载完成后，如果域名在白名单中，自动启用强制统计模式
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  try {
    const url = new URL(tab.url);
    const tracked = await isDomainTracked(url.hostname);
    if (tracked) {
      chrome.tabs.sendMessage(tabId, { type: 'forceMode:set', enabled: true }).catch(() => {});
    }
  } catch {}
});
