/**
 * options.js — 设置页逻辑
 * 管理：语言、模型价格表、告警阈值、数据导出/清空
 */

import { t, getLanguage, setLanguage } from './lib/i18n.js';

let currentSettings = null;

// ---------- 加载设置 ----------

async function loadSettings() {
  const resp = await chrome.runtime.sendMessage({ type: 'getSettings' });
  if (resp && resp.ok) {
    currentSettings = resp.settings;
    renderSettings();
  }
}

function renderSettings() {
  // 语言
  document.getElementById('langSelect').value = currentSettings.language || 'auto';

  // 价格表
  renderPricingTable(currentSettings.pricing || []);

  // 告警
  document.getElementById('alertEnabled').checked = currentSettings.alerts?.enabled || false;
  document.getElementById('dailyTokenThreshold').value = currentSettings.alerts?.dailyTokenThreshold || '';
  document.getElementById('dailyCostThreshold').value = currentSettings.alerts?.dailyCostThreshold || '';
  document.getElementById('perCallTokenThreshold').value = currentSettings.alerts?.perCallTokenThreshold || '';
  document.getElementById('perCallCostThreshold').value = currentSettings.alerts?.perCallCostThreshold || '';
}

// ---------- 价格表渲染 ----------

function renderPricingTable(pricingList) {
  const container = document.getElementById('pricingRows');
  container.innerHTML = '';
  pricingList.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'pricing-row';
    row.innerHTML = `
      <input class="col-pattern" type="text" value="${escapeAttr(item.pattern || '')}" placeholder="gpt-4o*">
      <input class="col-label" type="text" value="${escapeAttr(item.label || '')}" placeholder="GPT-4o">
      <input class="col-input" type="number" step="0.001" value="${item.input ?? ''}" placeholder="2.50">
      <input class="col-output" type="number" step="0.001" value="${item.output ?? ''}" placeholder="10.00">
      <button class="btn-delete col-action" data-idx="${idx}" title="删除">×</button>
    `;
    container.appendChild(row);
  });

  // 绑定删除
  container.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      currentSettings.pricing.splice(idx, 1);
      renderPricingTable(currentSettings.pricing);
    });
  });
}

function collectPricingFromDOM() {
  const rows = document.querySelectorAll('#pricingRows .pricing-row');
  const pricing = [];
  rows.forEach(row => {
    const inputs = row.querySelectorAll('input');
    const pattern = inputs[0].value.trim();
    const label = inputs[1].value.trim();
    const input = parseFloat(inputs[2].value);
    const output = parseFloat(inputs[3].value);
    if (pattern) {
      pricing.push({
        pattern,
        label: label || pattern,
        input: isNaN(input) ? 0 : input,
        output: isNaN(output) ? 0 : output
      });
    }
  });
  return pricing;
}

// ---------- 保存设置 ----------

async function saveSettings() {
  const pricing = collectPricingFromDOM();
  const settings = {
    language: document.getElementById('langSelect').value,
    pricing,
    alerts: {
      enabled: document.getElementById('alertEnabled').checked,
      dailyTokenThreshold: parseInt(document.getElementById('dailyTokenThreshold').value) || 0,
      dailyCostThreshold: parseFloat(document.getElementById('dailyCostThreshold').value) || 0,
      perCallTokenThreshold: parseInt(document.getElementById('perCallTokenThreshold').value) || 0,
      perCallCostThreshold: parseFloat(document.getElementById('perCallCostThreshold').value) || 0
    }
  };

  const resp = await chrome.runtime.sendMessage({ type: 'saveSettings', payload: settings });
  if (resp && resp.ok) {
    currentSettings = settings;
    // 同步 i18n
    setLanguage(settings.language);
    applyI18n();
    showSaveStatus('✓ 已保存');
  } else {
    showSaveStatus('✗ 保存失败', true);
  }
}

function showSaveStatus(text, isError = false) {
  const el = document.getElementById('saveStatus');
  el.textContent = text;
  el.style.color = isError ? '#e74c3c' : '#27ae60';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

// ---------- 添加价格规则 ----------

function addPricingRow() {
  if (!currentSettings.pricing) currentSettings.pricing = [];
  currentSettings.pricing.push({ pattern: '', label: '', input: 0, output: 0 });
  renderPricingTable(currentSettings.pricing);
  // 聚焦最后一行的 pattern 输入
  const rows = document.querySelectorAll('#pricingRows .pricing-row');
  if (rows.length > 0) {
    rows[rows.length - 1].querySelector('input').focus();
  }
}

// ---------- 数据管理 ----------

async function exportJSON() {
  const resp = await chrome.runtime.sendMessage({ type: 'exportJSON' });
  if (resp && resp.ok) {
    downloadFile(JSON.stringify(resp.data, null, 2), 'ai-token-monitor.json', 'application/json');
  }
}

async function exportCSV() {
  const resp = await chrome.runtime.sendMessage({ type: 'exportCSV' });
  if (resp && resp.ok) {
    downloadFile(resp.csv, 'ai-token-monitor.csv', 'text/csv');
  }
}

async function clearData() {
  if (!confirm('确定要清空所有数据吗？此操作不可恢复。')) return;
  await chrome.runtime.sendMessage({ type: 'clearAll' });
  showSaveStatus('✓ 已清空');
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

// ---------- 工具 ----------

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
}

// ---------- 事件绑定 ----------

function bindEvents() {
  document.getElementById('btnSave').addEventListener('click', saveSettings);
  document.getElementById('btnAddPricing').addEventListener('click', addPricingRow);
  document.getElementById('btnExportJSON').addEventListener('click', exportJSON);
  document.getElementById('btnExportCSV').addEventListener('click', exportCSV);
  document.getElementById('btnClearData').addEventListener('click', clearData);
}

// ---------- 初始化 ----------

async function init() {
  applyI18n();
  bindEvents();
  await loadSettings();
}

init();
