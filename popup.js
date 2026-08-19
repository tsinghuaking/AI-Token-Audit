/**
 * popup.js — 弹窗面板逻辑
 * 三个 Tab：实时 / 历史 / 统计
 * 实时监听 background 推送的 call:start / call:end
 */

import { t, getLanguage, setLanguage } from './lib/i18n.js';
import { formatCost } from './lib/pricing.js';

// ---------- 状态 ----------

let currentTab = 'realtime';
let realtimeRecords = []; // 当前正在进行 + 最近完成的调用
let historyRecords = [];
let currentDetailRecord = null;

// ---------- 工具函数 ----------

function formatTime(timestamp) {
  const d = new Date(timestamp);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatNumber(n) {
  if (n == null) return '0';
  return Number(n).toLocaleString();
}

function getProtocolLabel(protocol) {
  const map = {
    'openai-chat': 'OpenAI Chat',
    'openai-completion': 'OpenAI Completion',
    'openai-embedding': 'Embedding',
    'anthropic': 'Anthropic',
    'gemini': 'Gemini',
    'unknown': 'Unknown'
  };
  return map[protocol] || protocol;
}

// ---------- Tab 切换 ----------

function switchTab(tabName) {
  currentTab = tabName;
  document.querySelectorAll('.tab').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-panel').forEach(el => {
    el.classList.toggle('active', el.id === `panel-${tabName}`);
  });
  if (tabName === 'history') loadHistory();
  if (tabName === 'stats') loadStats();
}

// ---------- 实时面板 ----------

function renderRealtime() {
  const list = document.getElementById('realtimeList');
  if (realtimeRecords.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📡</div>
        <div class="empty-title">${t('noCalls')}</div>
        <div class="empty-desc">${t('noCallsDesc')}</div>
      </div>`;
    return;
  }
  list.innerHTML = realtimeRecords.map(r => renderCallItem(r, true)).join('');
  bindCallItemClicks(list);
}

function renderCallItem(r, showStreaming) {
  const usage = r.usage || r.estimated || {};
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const totalTokens = usage.total_tokens || (inputTokens + outputTokens);
  const cost = (r.cost && r.cost.total_cost) || 0;
  const isStreaming = showStreaming && r._streaming;
  const isError = r.status && r.status >= 400;
  const estTag = r.isEstimated ? `<span class="est-tag">${t('estimated')}</span>` : '';

  return `
    <div class="call-item ${isStreaming ? 'streaming' : ''} ${isError ? 'error' : ''}" data-id="${r.callId || r.id}">
      <div class="call-header">
        <span class="call-model">${r.model || 'unknown'}${estTag}</span>
        <span class="call-time">${isStreaming ? t('calling') : formatTime(r.timestamp)}</span>
      </div>
      <div class="call-meta">
        <span>${getProtocolLabel(r.protocol)}</span>
        <span>${r.isStream ? t('stream') : t('nonStream')}</span>
        <span>${r.duration ? Math.round(r.duration) + 'ms' : '-'}</span>
        <span>HTTP ${r.status || '-'}</span>
      </div>
      <div class="call-tokens">
        <span class="token-badge">↓ ${formatNumber(inputTokens)}</span>
        <span class="token-badge output">↑ ${formatNumber(outputTokens)}</span>
        <span class="token-badge cost">$${cost ? cost.toFixed(4) : '0.0000'}</span>
      </div>
      <div class="call-domain">${r.domain || ''}</div>
    </div>`;
}

function bindCallItemClicks(container) {
  container.querySelectorAll('.call-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      const record = realtimeRecords.find(r => (r.callId || r.id) === id)
        || historyRecords.find(r => (r.callId || r.id) === id);
      if (record) showDetail(record);
    });
  });
}

// ---------- 历史面板 ----------

async function loadHistory() {
  const range = document.getElementById('historyRange').value;
  const now = Date.now();
  let from = null;
  if (range === 'today') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    from = d.getTime();
  } else if (range === 'week') {
    from = now - 7 * 24 * 3600 * 1000;
  } else if (range === 'month') {
    from = now - 30 * 24 * 3600 * 1000;
  }

  const resp = await chrome.runtime.sendMessage({ type: 'getRecords', payload: { limit: 100, from } });
  if (resp && resp.ok) {
    historyRecords = resp.records;
    renderHistory();
  }
}

function renderHistory() {
  const list = document.getElementById('historyList');
  if (historyRecords.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <div class="empty-title">${t('noCalls')}</div>
      </div>`;
    return;
  }
  list.innerHTML = historyRecords.map(r => renderCallItem(r, false)).join('');
  bindCallItemClicks(list);
}

// ---------- 统计面板 ----------

async function loadStats() {
  const resp = await chrome.runtime.sendMessage({ type: 'getStats', payload: {} });
  if (!resp || !resp.ok) return;
  const stats = resp.stats;

  document.getElementById('statCalls').textContent = formatNumber(stats.totalCalls);
  document.getElementById('statTokens').textContent = formatNumber(stats.totalTokens);
  document.getElementById('statCost').textContent = formatCost(stats.totalCost);

  renderStatBars('statsByModel', stats.byModel, 'tokens');
  renderStatBars('statsByDomain', stats.byDomain, 'tokens');
  renderStatBars('statsByDay', stats.byDay, 'tokens');
}

function renderStatBars(containerId, data, valueKey) {
  const container = document.getElementById(containerId);
  const entries = Object.entries(data).sort((a, b) => b[1][valueKey] - a[1][valueKey]).slice(0, 8);
  if (entries.length === 0) {
    container.innerHTML = '<div style="color:#999;font-size:11px;text-align:center;padding:10px;">No data</div>';
    return;
  }
  const maxVal = Math.max(...entries.map(e => e[1][valueKey]), 1);
  container.innerHTML = entries.map(([name, info]) => {
    const pct = (info[valueKey] / maxVal * 100).toFixed(1);
    return `
      <div class="stat-bar-item">
        <div class="stat-bar-header">
          <span class="stat-bar-name" title="${name}">${name}</span>
          <span class="stat-bar-value">${formatNumber(info.calls)} ${t('calls')} · ${formatNumber(info[valueKey])}</span>
        </div>
        <div class="stat-bar-track">
          <div class="stat-bar-fill" style="width:${pct}%"></div>
        </div>
      </div>`;
  }).join('');
}

// ---------- 今日汇总 ----------

async function loadTodaySummary() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const resp = await chrome.runtime.sendMessage({ type: 'getStats', payload: { from: d.getTime() } });
  if (!resp || !resp.ok) return;
  const stats = resp.stats;
  document.getElementById('todayCalls').textContent = formatNumber(stats.totalCalls);
  document.getElementById('todayTokens').textContent = formatNumber(stats.totalTokens);
  document.getElementById('todayCost').textContent = formatCost(stats.totalCost);
}

// ---------- 详情弹窗 ----------

function showDetail(record) {
  currentDetailRecord = record;
  const usage = record.usage || record.estimated || {};
  const cost = record.cost || {};
  const body = document.getElementById('modalBody');

  body.innerHTML = `
    <div class="detail-grid">
      <div class="detail-item">
        <div class="detail-label">${t('model')}</div>
        <div class="detail-value">${record.model || '-'} ${record.isEstimated ? t('estimated') : ''}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">${t('protocol')}</div>
        <div class="detail-value">${getProtocolLabel(record.protocol)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">${t('status')}</div>
        <div class="detail-value">HTTP ${record.status || '-'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">${t('duration')}</div>
        <div class="detail-value">${record.duration ? Math.round(record.duration) + ' ms' : '-'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">${t('inputTokens')}</div>
        <div class="detail-value">${formatNumber(usage.input_tokens || 0)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">${t('outputTokens')}</div>
        <div class="detail-value">${formatNumber(usage.output_tokens || 0)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">${t('totalTokens')}</div>
        <div class="detail-value">${formatNumber(usage.total_tokens || (usage.input_tokens || 0) + (usage.output_tokens || 0))}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">${t('cost')}</div>
        <div class="detail-value">${formatCost(cost.total_cost)}</div>
      </div>
      <div class="detail-item full">
        <div class="detail-label">${t('requestUrl')}</div>
        <div class="detail-value">${record.url || '-'}</div>
      </div>
      <div class="detail-item full">
        <div class="detail-label">${t('domain')}</div>
        <div class="detail-value">${record.domain || '-'} · ${record.isStream ? t('stream') : t('nonStream')}</div>
      </div>
    </div>
    <div class="detail-section-title">${t('requestPreview')}</div>
    <div class="detail-preview">${escapeHtml(record.inputText || '(empty)')}</div>
    <div class="detail-section-title">${t('responsePreview')}</div>
    <div class="detail-preview">${escapeHtml(record.outputText || '(empty)')}</div>
  `;
  document.getElementById('detailModal').classList.add('show');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function closeDetail() {
  document.getElementById('detailModal').classList.remove('show');
  currentDetailRecord = null;
}

// ---------- 导出 ----------

async function exportJSON() {
  const resp = await chrome.runtime.sendMessage({ type: 'exportJSON' });
  if (resp && resp.ok) {
    downloadFile(JSON.stringify(resp.data, null, 2), 'ai-token-audit.json', 'application/json');
  }
}

async function exportCSV() {
  const resp = await chrome.runtime.sendMessage({ type: 'exportCSV' });
  if (resp && resp.ok) {
    downloadFile(resp.csv, 'ai-token-audit.csv', 'text/csv');
  }
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function clearAll() {
  if (!confirm(t('confirmClear'))) return;
  await chrome.runtime.sendMessage({ type: 'clearAll' });
  realtimeRecords = [];
  historyRecords = [];
  renderRealtime();
  loadHistory();
  loadStats();
  loadTodaySummary();
}

// ---------- 实时消息监听 ----------

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'realtime:start') {
    const r = { ...msg.payload, _streaming: true };
    realtimeRecords.unshift(r);
    if (realtimeRecords.length > 20) realtimeRecords.pop();
    if (currentTab === 'realtime') renderRealtime();
  }
  if (msg.type === 'realtime:end') {
    const idx = realtimeRecords.findIndex(r => r.callId === msg.payload.callId);
    if (idx >= 0) {
      realtimeRecords[idx] = { ...msg.payload, _streaming: false };
    } else {
      realtimeRecords.unshift({ ...msg.payload, _streaming: false });
      if (realtimeRecords.length > 20) realtimeRecords.pop();
    }
    if (currentTab === 'realtime') renderRealtime();
    loadTodaySummary();
    if (currentTab === 'stats') loadStats();
  }
});

// ---------- 事件绑定 ----------

function bindEvents() {
  // Tab 切换
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // 刷新
  document.getElementById('btnRefresh').addEventListener('click', () => {
    loadTodaySummary();
    if (currentTab === 'history') loadHistory();
    if (currentTab === 'stats') loadStats();
  });

  // 设置
  document.getElementById('btnOptions').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 历史范围
  document.getElementById('historyRange').addEventListener('change', loadHistory);

  // 导出
  document.getElementById('btnExportJSON').addEventListener('click', exportJSON);
  document.getElementById('btnExportCSV').addEventListener('click', exportCSV);
  document.getElementById('btnClearAll').addEventListener('click', clearAll);

  // 详情弹窗关闭
  document.getElementById('modalClose').addEventListener('click', closeDetail);
  document.getElementById('detailModal').addEventListener('click', (e) => {
    if (e.target.id === 'detailModal') closeDetail();
  });
}

// ---------- 初始化 ----------

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
}

async function init() {
  applyI18n();
  bindEvents();
  await loadTodaySummary();
  // 加载最近的记录到实时面板
  const resp = await chrome.runtime.sendMessage({ type: 'getRecords', payload: { limit: 10 } });
  if (resp && resp.ok) {
    realtimeRecords = resp.records.map(r => ({ ...r, _streaming: false }));
  }
  renderRealtime();
}

init();
