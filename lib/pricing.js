/**
 * lib/pricing.js — 模型价格配置与成本计算
 * 支持通配符匹配（如 gpt-4o*、claude-*-sonnet-*）
 * 价格单位：美元 / 1K tokens
 */

/** 默认模型价格表（用户可在设置页修改） */
export const DEFAULT_PRICING = [
  // OpenAI GPT-4 系列
  { pattern: 'gpt-4o*', input: 2.50, output: 10.00, label: 'GPT-4o' },
  { pattern: 'gpt-4o-mini*', input: 0.15, output: 0.60, label: 'GPT-4o mini' },
  { pattern: 'gpt-4-turbo*', input: 10.00, output: 30.00, label: 'GPT-4 Turbo' },
  { pattern: 'gpt-4*', input: 30.00, output: 60.00, label: 'GPT-4' },
  { pattern: 'gpt-3.5-turbo*', input: 0.50, output: 1.50, label: 'GPT-3.5 Turbo' },
  // OpenAI o 系列
  { pattern: 'o1*', input: 15.00, output: 60.00, label: 'o1' },
  { pattern: 'o3*', input: 10.00, output: 40.00, label: 'o3' },
  { pattern: 'o4*', input: 8.00, output: 32.00, label: 'o4' },
  // Anthropic Claude
  { pattern: 'claude-*-opus-*', input: 15.00, output: 75.00, label: 'Claude Opus' },
  { pattern: 'claude-*-sonnet-*', input: 3.00, output: 15.00, label: 'Claude Sonnet' },
  { pattern: 'claude-*-haiku-*', input: 0.25, output: 1.25, label: 'Claude Haiku' },
  { pattern: 'claude*', input: 3.00, output: 15.00, label: 'Claude' },
  // Google Gemini
  { pattern: 'gemini-1.5-pro*', input: 1.25, output: 5.00, label: 'Gemini 1.5 Pro' },
  { pattern: 'gemini-1.5-flash*', input: 0.075, output: 0.30, label: 'Gemini 1.5 Flash' },
  { pattern: 'gemini-2.0-pro*', input: 1.25, output: 10.00, label: 'Gemini 2.0 Pro' },
  { pattern: 'gemini-2.0-flash*', input: 0.10, output: 0.40, label: 'Gemini 2.0 Flash' },
  { pattern: 'gemini*', input: 0.50, output: 2.00, label: 'Gemini' },
  // 国内模型
  { pattern: 'deepseek*', input: 0.14, output: 0.28, label: 'DeepSeek' },
  { pattern: 'qwen*', input: 0.15, output: 0.30, label: '通义千问' },
  { pattern: 'moonshot*', input: 0.60, output: 1.20, label: 'Kimi/Moonshot' },
  { pattern: 'glm*', input: 0.50, output: 0.50, label: '智谱 GLM' },
  { pattern: 'doubao*', input: 0.30, output: 0.60, label: '豆包' },
  { pattern: 'yi-*', input: 0.30, output: 0.60, label: '零一万物' },
  // 开源/本地
  { pattern: 'llama*', input: 0.00, output: 0.00, label: 'Llama (本地)' },
  { pattern: 'mistral*', input: 0.20, output: 0.60, label: 'Mistral' },
];

/**
 * 通配符匹配：* 匹配任意字符
 */
function wildcardMatch(pattern, str) {
  if (!pattern || !str) return false;
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i');
  return regex.test(str);
}

/**
 * 根据模型名查找价格配置
 * @param {string} model
 * @param {Array} pricingList
 * @returns {object|null}
 */
export function findPricing(model, pricingList) {
  if (!model) return null;
  const list = pricingList || DEFAULT_PRICING;
  // 优先精确匹配（无通配符的）
  for (const p of list) {
    if (!p.pattern.includes('*') && p.pattern.toLowerCase() === model.toLowerCase()) {
      return p;
    }
  }
  // 再通配符匹配
  for (const p of list) {
    if (wildcardMatch(p.pattern, model)) {
      return p;
    }
  }
  return null;
}

/**
 * 计算一次调用的成本
 * @param {object} usage - { input_tokens, output_tokens }
 * @param {string} model
 * @param {Array} pricingList
 * @returns {object} { input_cost, output_cost, total_cost, currency, pricing }
 */
export function calculateCost(usage, model, pricingList) {
  if (!usage) return { input_cost: 0, output_cost: 0, total_cost: 0, currency: 'USD' };
  const pricing = findPricing(model, pricingList);
  if (!pricing) {
    return { input_cost: 0, output_cost: 0, total_cost: 0, currency: 'USD', pricing: null };
  }
  const input_cost = (usage.input_tokens || 0) / 1000 * pricing.input;
  const output_cost = (usage.output_tokens || 0) / 1000 * pricing.output;
  return {
    input_cost: Math.round(input_cost * 1e6) / 1e6,
    output_cost: Math.round(output_cost * 1e6) / 1e6,
    total_cost: Math.round((input_cost + output_cost) * 1e6) / 1e6,
    currency: 'USD',
    pricing
  };
}

/**
 * 格式化成本显示
 */
export function formatCost(cost, currency = 'USD') {
  if (cost == null || isNaN(cost)) return '-';
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return `$${cost.toFixed(6)}`;
  if (cost < 1) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}
