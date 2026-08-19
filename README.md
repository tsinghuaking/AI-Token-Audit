简体中文 | [English](README_en.md)

<div align="center">

# AI Token Audit

</div>

<div align="center">

![License](https://img.shields.io/badge/License-MIT-green.svg)
![Manifest](https://img.shields.io/badge/Manifest-V3-blue.svg)
![Browser](https://img.shields.io/badge/Browser-Chrome%2FEdge-blue.svg)
[![Release](https://img.shields.io/github/v/release/tsinghuaking/Token-Audit?label=Release)](https://github.com/tsinghuaking/Token-Audit/releases)
[![Download](https://img.shields.io/github/downloads/tsinghuaking/Token-Audit/total?label=Downloads)](https://github.com/tsinghuaking/Token-Audit/releases)

</div>

## 项目简介

**AI Token Audit** 是一款浏览器扩展，用来**实时监测网页端 AI 调用的 Token 消耗、真实模型与成本**，支持历史统计、告警与数据导出。装上即用，零配置，所有数据 100% 存储在本地，不上传任何网络。

**AI Token Audit** is a browser extension that **monitors token consumption, actual model, and cost of web AI calls in real time**, with history statistics, alerts, and data export. Zero-configuration, 100% local storage, no data uploaded.

> 为什么需要它：各类套壳 AI 平台的积分制度不透明，你花了多少积分、实际调用了哪个模型、对应官方 API 真实成本是多少，往往一无所知。这个工具把这些黑盒数据全部透明化。

## ✨ 功能特性

### 核心能力
- **零配置**：装上扩展，打开任意大模型网页正常聊天，自动开始监测
- **全协议覆盖**：
  - OpenAI 兼容 `/v1/chat/completions`、`/v1/completions`、`/v1/embeddings`
  - Anthropic `/v1/messages`
  - Google Gemini `generateContent` / `streamGenerateContent`
  - 几乎覆盖所有主流代理和自部署方案（LiteLLM、one-api、vLLM、Ollama-OpenAI、Together、Groq、OpenRouter、DeepSeek、Moonshot、Qwen、豆包 Ark 等）
- **流式响应正确解析**：SSE 响应体做 `tee()` 分叉，页面拿原数据流，镜像侧解析 usage chunk，不影响原站点
- **精确 + 估算双模式**：API 返回 usage 时用精确值；不返回时用本地分词器估算（准确率 85%-95%）
- **成本自动计算**：自定义模型价格表（支持通配符 `gpt-4o*`、`claude-*-sonnet-*`），费用即刻出现

### 面板功能
- **实时面板**：今日调用次数/Token/成本汇总，正在进行的调用实时显示（脉冲动画）
- **历史记录**：按今日/本周/本月/全部筛选，每条记录可查看完整详情
  - 完整请求 URL、协议、流式标记、耗时、HTTP 状态
  - prompt / completion 前 2KB 预览
- **统计报表**：总调用次数、总 Token、总成本；按模型/域名/日期的分布柱状图
- **告警系统**：
  - 每日 Token 阈值告警
  - 每日成本阈值告警
  - 单次调用 Token/成本阈值告警
  - 浏览器系统通知推送
- **一键导出**：JSON（保留全部字段）、CSV（可直接用 Excel 打开）
- **中英双语**：中文 / English / 自动（跟随浏览器）
- **100% 本地**：所有数据存在 IndexedDB，随时一键清空

## 📦 安装方法

### 开发者模式加载（当前方式）

1. 打开 Chrome / Edge，地址栏输入 `chrome://extensions/`
2. 右上角开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本项目的 `ai-token-monitor` 文件夹
5. 扩展图标出现在工具栏，点击即可使用

### 打包为 .crx（可选）

在扩展管理页点击「打包扩展程序」，选择项目根目录即可生成 `.crx` 文件。

## 🚀 使用方法

1. 安装后，打开任意 AI 网页（如 ChatGPT、Claude、DeepSeek、各类套壳平台）
2. 正常开始聊天，扩展图标旁会显示调用状态
3. 点击扩展图标，查看：
   - **实时** Tab：当前正在进行的调用和今日汇总
   - **历史** Tab：所有历史调用记录，支持筛选和导出
   - **统计** Tab：按模型/域名/日期的用量分布
4. 点击右上角 ⚙ 进入设置页：
   - 配置模型价格（输入/输出单价，支持通配符）
   - 设置告警阈值
   - 切换语言
   - 导出或清空数据

## 📁 项目结构

```
ai-token-monitor/
├── manifest.json          # 扩展清单（Manifest V3）
├── background.js          # Service Worker（中央枢纽：存储、成本、告警）
├── content.js             # 内容脚本（注入桥接）
├── injected.js            # 注入页面主世界（hook fetch/XHR + SSE 解析）
├── popup.html / .css / .js  # 弹窗面板（实时/历史/统计）
├── options.html / .css / .js # 设置页（价格/告警/语言/数据）
├── lib/
│   ├── storage.js         # IndexedDB 存储层
│   ├── tokenizer.js       # 本地 Token 估算
│   ├── pricing.js         # 模型价格与成本计算
│   └── i18n.js            # 中英双语
├── icons/                 # 扩展图标
└── README.md
```

## 🔧 技术原理

### 流量拦截
- `content.js` 通过 `chrome.scripting` 将 `injected.js` 注入页面**主世界（MAIN world）**
- `injected.js` 猴子补丁 `window.fetch` 和 `XMLHttpRequest.prototype.send`
- 仅拦截 POST 请求且 URL 匹配 AI API 协议特征的调用

### SSE 流式解析
- 对 `text/event-stream` 响应，调用 `response.body.tee()` 分叉为两条流
- 一条流封装为新 Response 还给页面，保证原站点正常工作
- 另一条流逐块解析，提取 `delta.content` 累加输出文本，捕获最终 `usage`

### Token 统计
- **精确模式**：从 API 响应的 `usage` 字段提取 `prompt_tokens` / `completion_tokens`
- **估算模式**：内置启发式分词器，按 CJK 字符（~1.4字/token）、ASCII（~4字符/token）、代码密度等维度估算

### 数据存储
- 所有调用记录存入浏览器本地 `IndexedDB`（数据库名 `ai_token_monitor`）
- 支持按时间、模型、域名索引查询
- 永不上传任何对话内容到外部服务器

## ⚙️ 自定义模型价格

在设置页的「模型价格配置」中添加规则：

| 模型匹配（支持通配符） | 显示名称 | 输入价格 ($/1K) | 输出价格 ($/1K) |
|---|---|---|---|
| `gpt-4o*` | GPT-4o | 2.50 | 10.00 |
| `claude-*-sonnet-*` | Claude Sonnet | 3.00 | 15.00 |
| `deepseek*` | DeepSeek | 0.14 | 0.28 |

通配符 `*` 匹配任意字符，规则按顺序匹配，优先精确匹配。

## 🛡️ 隐私说明

- 所有对话内容、Token 统计、成本计算**全部在浏览器本地完成**
- 扩展不包含任何远程服务器通信代码（除了被监测页面自身的 AI API 调用）
- 数据仅存在当前浏览器的 IndexedDB 中，清除浏览器数据或点击「清空所有数据」即可完全删除

## 📝 已知限制

1. 仅覆盖**浏览器内**的网页应用，无法监测桌面客户端（需配合本地代理网关方案）
2. Token 估算模式非 100% 精确，建议优先依赖 API 返回的 usage
3. 部分高度自定义的套壳平台可能隐藏 model 字段，此时模型显示为 `unknown`
4. 多模态（图片/语音）的 Token 折算暂未实现，后续版本补充

## 🤝 二次开发建议

- 替换 `lib/tokenizer.js` 为 `@dqbd/tiktoken` 的 WASM 版本，可获得 OpenAI 级精确分词
- 新增「平台积分换算」模块：在 `lib/pricing.js` 基础上增加积分规则表，实现「平台积分 → 真实 Token → 官方成本」的穿透换算
- 新增模型行为指纹识别：通过标准测试 Prompt 的输出分布特征识别深度套壳模型
- 扩展为本地代理网关版，覆盖桌面 AI 客户端

## 📄 许可证

MIT License
