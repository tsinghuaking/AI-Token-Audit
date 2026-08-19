/**
 * lib/i18n.js — 中英双语
 */

export const translations = {
  zh_CN: {
    // popup
    appName: 'AI Token Audit',
    tabRealtime: '实时',
    tabHistory: '历史',
    tabStats: '统计',
    tabSettings: '设置',
    noCalls: '暂无调用记录',
    noCallsDesc: '打开任意大模型网页开始聊天，记录将自动出现在这里',
    calling: '正在调用...',
    inputTokens: '输入 Token',
    outputTokens: '输出 Token',
    totalTokens: '总 Token',
    cost: '成本',
    model: '模型',
    domain: '域名',
    protocol: '协议',
    duration: '耗时',
    status: '状态',
    stream: '流式',
    nonStream: '非流式',
    time: '时间',
    viewDetail: '查看详情',
    delete: '删除',
    clearAll: '清空全部',
    exportJSON: '导出 JSON',
    exportCSV: '导出 CSV',
    confirmClear: '确定要清空所有记录吗？此操作不可恢复。',
    today: '今日',
    thisWeek: '本周',
    thisMonth: '本月',
    allTime: '全部',
    totalCalls: '总调用次数',
    totalTokens: '总 Token 数',
    totalCost: '总成本',
    byModel: '按模型',
    byDomain: '按域名',
    byDay: '按日期',
    calls: '次',
    tokens: 'Token',
    // settings
    settingsTitle: '设置',
    pricingConfig: '模型价格配置',
    pricingDesc: '自定义各模型的输入/输出价格（美元 / 1K tokens），支持通配符 *',
    addPricing: '添加价格规则',
    pattern: '模型匹配',
    inputPrice: '输入价格',
    outputPrice: '输出价格',
    label: '显示名称',
    save: '保存',
    cancel: '取消',
    alertConfig: '告警配置',
    alertDesc: '当 Token 消耗或成本达到阈值时发送浏览器通知',
    enableAlert: '启用告警',
    dailyTokenThreshold: '每日 Token 阈值',
    dailyCostThreshold: '每日成本阈值（美元）',
    perCallTokenThreshold: '单次调用 Token 阈值',
    perCallCostThreshold: '单次调用成本阈值（美元）',
    language: '语言',
    auto: '自动（跟随浏览器）',
    chinese: '中文',
    english: 'English',
    dataManagement: '数据管理',
    dataDesc: '所有数据存储在本地 IndexedDB，不会上传到任何服务器',
    clearData: '清空所有数据',
    exportData: '导出数据',
    about: '关于',
    version: '版本',
    // alerts
    alertDailyTokenTitle: '每日 Token 用量告警',
    alertDailyTokenMsg: '今日 Token 消耗已达到阈值：{value} / {threshold}',
    alertDailyCostTitle: '每日成本告警',
    alertDailyCostMsg: '今日成本已达到阈值：${value} / ${threshold}',
    alertPerCallTokenTitle: '单次调用 Token 告警',
    alertPerCallTokenMsg: '本次调用 Token 消耗：{value}，超过阈值 {threshold}',
    alertPerCallCostTitle: '单次调用成本告警',
    alertPerCallCostMsg: '本次调用成本：${value}，超过阈值 ${threshold}',
    // detail
    detailTitle: '调用详情',
    requestUrl: '请求 URL',
    requestMethod: '请求方法',
    responseStatus: '响应状态',
    requestPreview: '请求内容预览（前 2KB）',
    responsePreview: '响应内容预览（前 2KB）',
    estimated: '（估算）',
    exact: '（精确）',
    close: '关闭',
    copy: '复制',
    copied: '已复制',
  },
  en: {
    appName: 'AI Token Audit',
    tabRealtime: 'Realtime',
    tabHistory: 'History',
    tabStats: 'Stats',
    tabSettings: 'Settings',
    noCalls: 'No calls yet',
    noCallsDesc: 'Open any LLM webpage and start chatting, records will appear here automatically',
    calling: 'Calling...',
    inputTokens: 'Input Tokens',
    outputTokens: 'Output Tokens',
    totalTokens: 'Total Tokens',
    cost: 'Cost',
    model: 'Model',
    domain: 'Domain',
    protocol: 'Protocol',
    duration: 'Duration',
    status: 'Status',
    stream: 'Stream',
    nonStream: 'Non-stream',
    time: 'Time',
    viewDetail: 'View Detail',
    delete: 'Delete',
    clearAll: 'Clear All',
    exportJSON: 'Export JSON',
    exportCSV: 'Export CSV',
    confirmClear: 'Are you sure to clear all records? This cannot be undone.',
    today: 'Today',
    thisWeek: 'This Week',
    thisMonth: 'This Month',
    allTime: 'All Time',
    totalCalls: 'Total Calls',
    totalTokens: 'Total Tokens',
    totalCost: 'Total Cost',
    byModel: 'By Model',
    byDomain: 'By Domain',
    byDay: 'By Day',
    calls: 'calls',
    tokens: 'tokens',
    settingsTitle: 'Settings',
    pricingConfig: 'Model Pricing',
    pricingDesc: 'Customize input/output prices (USD / 1K tokens), wildcard * supported',
    addPricing: 'Add Pricing Rule',
    pattern: 'Model Pattern',
    inputPrice: 'Input Price',
    outputPrice: 'Output Price',
    label: 'Label',
    save: 'Save',
    cancel: 'Cancel',
    alertConfig: 'Alert Configuration',
    alertDesc: 'Send browser notification when token usage or cost reaches threshold',
    enableAlert: 'Enable Alerts',
    dailyTokenThreshold: 'Daily Token Threshold',
    dailyCostThreshold: 'Daily Cost Threshold (USD)',
    perCallTokenThreshold: 'Per-call Token Threshold',
    perCallCostThreshold: 'Per-call Cost Threshold (USD)',
    language: 'Language',
    auto: 'Auto (follow browser)',
    chinese: '中文',
    english: 'English',
    dataManagement: 'Data Management',
    dataDesc: 'All data is stored locally in IndexedDB, never uploaded to any server',
    clearData: 'Clear All Data',
    exportData: 'Export Data',
    about: 'About',
    version: 'Version',
    alertDailyTokenTitle: 'Daily Token Alert',
    alertDailyTokenMsg: 'Today\'s token usage reached threshold: {value} / {threshold}',
    alertDailyCostTitle: 'Daily Cost Alert',
    alertDailyCostMsg: 'Today\'s cost reached threshold: ${value} / ${threshold}',
    alertPerCallTokenTitle: 'Per-call Token Alert',
    alertPerCallTokenMsg: 'This call used {value} tokens, exceeding threshold {threshold}',
    alertPerCallCostTitle: 'Per-call Cost Alert',
    alertPerCallCostMsg: 'This call cost ${value}, exceeding threshold ${threshold}',
    detailTitle: 'Call Detail',
    requestUrl: 'Request URL',
    requestMethod: 'Request Method',
    responseStatus: 'Response Status',
    requestPreview: 'Request Preview (first 2KB)',
    responsePreview: 'Response Preview (first 2KB)',
    estimated: '(estimated)',
    exact: '(exact)',
    close: 'Close',
    copy: 'Copy',
    copied: 'Copied',
  }
};

let currentLang = null;

export function getLanguage() {
  if (currentLang) return currentLang;
  try {
    const stored = localStorage.getItem('atm_lang');
    if (stored && stored !== 'auto') {
      currentLang = stored;
      return currentLang;
    }
  } catch {}
  const navLang = navigator.language || 'en';
  currentLang = navLang.startsWith('zh') ? 'zh_CN' : 'en';
  return currentLang;
}

export function setLanguage(lang) {
  currentLang = lang === 'auto' ? null : lang;
  try {
    localStorage.setItem('atm_lang', lang);
  } catch {}
}

export function t(key, params = {}) {
  const lang = getLanguage();
  const dict = translations[lang] || translations.en;
  let str = dict[key] || translations.en[key] || key;
  for (const [k, v] of Object.entries(params)) {
    str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
  }
  return str;
}
