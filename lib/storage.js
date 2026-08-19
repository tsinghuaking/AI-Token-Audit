/**
 * lib/storage.js — IndexedDB 封装
 * 存储所有调用记录，100% 本地，不上传任何数据。
 *
 * 数据库结构：
 *   db: ai_token_monitor
 *   store: records (keyPath: id)
 *     索引：by_timestamp, by_model, by_domain, by_day
 *
 * 记录结构：
 *   {
 *     id, callId, url, domain, protocol, model, method, isStream,
 *     status, duration, inputText, inputTextLength, outputText, outputTextLength,
 *     usage: { input_tokens, output_tokens, total_tokens, ... },
 *     estimated: { input_tokens, output_tokens, total_tokens },
 *     cost: { input_cost, output_cost, total_cost, currency },
 *     pageUrl, pageTitle, tabId, timestamp
 *   }
 */

const DB_NAME = 'ai_token_monitor';
const DB_VERSION = 1;
const STORE_NAME = 'records';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function (e) {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('by_timestamp', 'timestamp', { unique: false });
        store.createIndex('by_model', 'model', { unique: false });
        store.createIndex('by_domain', 'domain', { unique: false });
        store.createIndex('by_day', 'day', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

function getDayKey(timestamp) {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 新增一条记录 */
export async function addRecord(record) {
  const db = await openDB();
  const id = record.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const fullRecord = {
    ...record,
    id,
    domain: extractDomain(record.url || record.pageUrl || ''),
    day: getDayKey(record.timestamp || Date.now())
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(fullRecord);
    tx.oncomplete = () => resolve(id);
    tx.onerror = () => reject(tx.error);
  });
}

/** 更新一条记录（按 callId 匹配） */
export async function updateRecordByCallId(callId, updates) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.openCursor();
    req.onsuccess = function (e) {
      const cursor = e.target.result;
      if (cursor) {
        if (cursor.value.callId === callId) {
          const updated = { ...cursor.value, ...updates };
          cursor.update(updated);
          resolve(updated);
        } else {
          cursor.continue();
        }
      } else {
        resolve(null);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

/** 查询记录，支持过滤和分页 */
export async function queryRecords({ limit = 50, offset = 0, model, domain, day, from, to } = {}) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('by_timestamp');
    const results = [];
    const req = index.openCursor(null, 'prev'); // 降序，最新在前
    let skipped = 0;

    req.onsuccess = function (e) {
      const cursor = e.target.result;
      if (!cursor) { resolve(results); return; }
      const rec = cursor.value;

      // 过滤
      if (model && rec.model !== model) { cursor.continue(); return; }
      if (domain && rec.domain !== domain) { cursor.continue(); return; }
      if (day && rec.day !== day) { cursor.continue(); return; }
      if (from && rec.timestamp < from) { cursor.continue(); return; }
      if (to && rec.timestamp > to) { cursor.continue(); return; }

      if (skipped < offset) { skipped++; cursor.continue(); return; }
      results.push(rec);
      if (results.length >= limit) { resolve(results); return; }
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/** 获取统计汇总 */
export async function getStats({ from, to, day } = {}) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.openCursor();
    const stats = {
      totalCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      byModel: {},
      byDomain: {},
      byDay: {}
    };

    req.onsuccess = function (e) {
      const cursor = e.target.result;
      if (!cursor) { resolve(stats); return; }
      const rec = cursor.value;

      if (day && rec.day !== day) { cursor.continue(); return; }
      if (from && rec.timestamp < from) { cursor.continue(); return; }
      if (to && rec.timestamp > to) { cursor.continue(); return; }

      stats.totalCalls++;
      const usage = rec.usage || rec.estimated || {};
      const input = usage.input_tokens || 0;
      const output = usage.output_tokens || 0;
      const total = usage.total_tokens || (input + output);
      stats.totalInputTokens += input;
      stats.totalOutputTokens += output;
      stats.totalTokens += total;
      stats.totalCost += (rec.cost && rec.cost.total_cost) || 0;

      const m = rec.model || 'unknown';
      stats.byModel[m] = stats.byModel[m] || { calls: 0, tokens: 0, cost: 0 };
      stats.byModel[m].calls++;
      stats.byModel[m].tokens += total;
      stats.byModel[m].cost += (rec.cost && rec.cost.total_cost) || 0;

      const d = rec.domain || 'unknown';
      stats.byDomain[d] = stats.byDomain[d] || { calls: 0, tokens: 0, cost: 0 };
      stats.byDomain[d].calls++;
      stats.byDomain[d].tokens += total;
      stats.byDomain[d].cost += (rec.cost && rec.cost.total_cost) || 0;

      const dayKey = rec.day;
      stats.byDay[dayKey] = stats.byDay[dayKey] || { calls: 0, tokens: 0, cost: 0 };
      stats.byDay[dayKey].calls++;
      stats.byDay[dayKey].tokens += total;
      stats.byDay[dayKey].cost += (rec.cost && rec.cost.total_cost) || 0;

      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/** 删除记录 */
export async function deleteRecord(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 清空所有记录 */
export async function clearAllRecords() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 导出全部记录为 JSON */
export async function exportAllJSON() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 导出为 CSV */
export async function exportAllCSV() {
  const records = await exportAllJSON();
  const headers = [
    'id', 'timestamp', 'day', 'domain', 'url', 'protocol', 'model',
    'method', 'isStream', 'status', 'duration_ms',
    'input_tokens', 'output_tokens', 'total_tokens',
    'input_cost', 'output_cost', 'total_cost',
    'pageUrl', 'pageTitle'
  ];
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const rows = records.map(r => {
    const usage = r.usage || r.estimated || {};
    const cost = r.cost || {};
    return [
      r.id, new Date(r.timestamp).toISOString(), r.day, r.domain, r.url,
      r.protocol, r.model, r.method, r.isStream, r.status, r.duration,
      usage.input_tokens || 0, usage.output_tokens || 0, usage.total_tokens || 0,
      cost.input_cost || 0, cost.output_cost || 0, cost.total_cost || 0,
      r.pageUrl, r.pageTitle
    ].map(escape).join(',');
  });
  return [headers.join(','), ...rows].join('\n');
}
