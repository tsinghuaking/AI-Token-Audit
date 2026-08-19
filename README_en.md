[简体中文](README.md) | English

<div align="center">
<img src="docs/logo.png" alt="AI Token Audit" width="260">
</div>

<div align="center">

# AI Token Audit

</div>

<div align="center">

![License](https://img.shields.io/badge/License-MIT-green.svg)
![Manifest](https://img.shields.io/badge/Manifest-V3-blue.svg)
![Browser](https://img.shields.io/badge/Browser-Chrome%2FEdge-blue.svg)
[![Release](https://img.shields.io/github/v/release/tsinghuaking/AI-Token-Audit?label=Release)](https://github.com/tsinghuaking/AI-Token-Audit/releases)
[![Download](https://img.shields.io/github/downloads/tsinghuaking/AI-Token-Audit/total?label=Downloads)](https://github.com/tsinghuaking/AI-Token-Audit/releases)

</div>

## About

**AI Token Audit** is a browser extension that **monitors token consumption, actual model, and cost of web AI calls in real time**, with history statistics, alerts, and data export. Zero-configuration, 100% local storage, no data uploaded to any server.

> Why you need it: Most reseller AI platforms have opaque credit systems — you never know how many credits you spent, which model was actually called, or what the true official API cost is. This tool brings all that black-box data into the light.

## Features

### Core Capabilities

- **Zero configuration**: Install the extension, open any LLM webpage, start chatting — monitoring begins automatically.
- **Full protocol coverage**:
  - OpenAI-compatible `/v1/chat/completions`, `/v1/completions`, `/v1/embeddings`
  - Anthropic `/v1/messages`
  - Google Gemini `generateContent` / `streamGenerateContent`
  - Covers virtually all mainstream proxies and self-hosted solutions (LiteLLM, one-api, vLLM, Ollama-OpenAI, Together, Groq, OpenRouter, DeepSeek, Moonshot, Qwen, Doubao Ark, etc.)
- **Accurate streaming parsing**: SSE response body is split via `tee()` — the page gets the original data stream while a mirror side parses usage chunks without affecting the original site.
- **Exact + estimated dual mode**: Uses exact values when the API returns `usage`; falls back to local tokenizer estimation (85%-95% accuracy) when it doesn't.
- **Automatic cost calculation**: Customizable model price table with wildcard support (`gpt-4o*`, `claude-*-sonnet-*`), costs appear instantly.

### Panel Features

- **Realtime panel**: Today's call count / token / cost summary; in-progress calls show live with pulse animation.
- **History records**: Filter by today / this week / this month / all time; each record supports full detail view:
  - Complete request URL, protocol, streaming flag, duration, HTTP status
  - prompt / completion preview (first 2KB)
- **Statistics dashboard**: Total calls, total tokens, total cost; distribution bar charts by model / domain / date.
- **Alert system**:
  - Daily token threshold alert
  - Daily cost threshold alert
  - Per-call token / cost threshold alert
  - Browser system notification delivery
- **One-click export**: JSON (all fields preserved), CSV (open directly in Excel).
- **Bilingual**: Chinese / English / Auto (follow browser).
- **100% local**: All data stored in IndexedDB, clear anytime with one click.

## Installation

### From Release (recommended for end users)

> ⚠️ **Note**: Chrome does **not** support direct drag-and-drop installation of `.crx` files (it will show "not listed in Chrome Web Store" and cannot be enabled). Please follow these steps:

1. Download **`AI-Token-Audit-v1.0.crx`** from the [Releases](https://github.com/tsinghuaking/AI-Token-Audit/releases) page.
2. Rename the `.crx` file to `.zip`, then extract it into a folder (e.g. `AI-Token-Audit/`).
3. Open `chrome://extensions/` in Chrome / Edge.
4. Enable "**Developer mode**" in the top-right corner.
5. Click "**Load unpacked**" in the top-left corner.
6. Select the extracted folder — installation complete.

> Edge browser supports direct drag-and-drop of `.crx` files, no extraction needed.

### Load from source (for developers)

1. `git clone https://github.com/tsinghuaking/AI-Token-Audit.git`
2. Open `chrome://extensions/`, enable "Developer mode".
3. Click "Load unpacked" and select the project folder.

## Usage

1. After installation, open any AI webpage (ChatGPT, Claude, DeepSeek, various reseller platforms).
2. Start chatting normally — the extension monitors automatically.
3. Click the extension icon to view:
   - **Realtime** tab: in-progress calls and today's summary
   - **History** tab: all historical calls, with filtering and export
   - **Stats** tab: usage distribution by model / domain / date
4. Click the ⚙ icon (top-right) to open settings:
   - Configure model pricing (input/output per 1M tokens, wildcard supported)
   - Set alert thresholds
   - Switch language
   - Export or clear data

## Project Structure

```
ai-token-audit/
├── manifest.json          # Extension manifest (Manifest V3)
├── background.js          # Service Worker (central hub: storage, cost, alerts)
├── content.js             # Content script (injection bridge)
├── injected.js            # Injected into page MAIN world (hook fetch/XHR + SSE parsing)
├── popup.html / .css / .js  # Popup panel (realtime/history/stats)
├── options.html / .css / .js # Settings page (pricing/alerts/language/data)
├── lib/
│   ├── storage.js         # IndexedDB storage layer
│   ├── tokenizer.js       # Local token estimation
│   ├── pricing.js         # Model pricing and cost calculation
│   └── i18n.js            # Bilingual support
├── icons/                 # Extension icons
└── README.md
```

## Technical Principles

### Traffic Interception
- `content.js` injects `injected.js` into the page's **MAIN world** via `chrome.scripting`.
- `injected.js` monkey-patches `window.fetch` and `XMLHttpRequest.prototype.send`.
- Only intercepts POST requests whose URL matches AI API protocol patterns.

### SSE Streaming Parsing
- For `text/event-stream` responses, calls `response.body.tee()` to split into two streams.
- One stream is wrapped into a new Response and returned to the page, ensuring the original site works normally.
- The other stream is parsed chunk by chunk, accumulating `delta.content` for output text and capturing the final `usage`.

### Token Statistics
- **Exact mode**: Extracts `prompt_tokens` / `completion_tokens` from the API response's `usage` field.
- **Estimated mode**: Built-in heuristic tokenizer, estimating by CJK characters (~1.4 chars/token), ASCII (~4 chars/token), code density, etc.

### Data Storage
- All call records are stored in the browser's local `IndexedDB` (database name `ai_token_monitor`).
- Supports querying by time, model, and domain indexes.
- Never uploads any conversation content to external servers.

## Custom Model Pricing

Add rules in the "Model Pricing" section of the settings page:

| Model Pattern (wildcard supported) | Label | Input Price ($/1M) | Output Price ($/1M) |
|---|---|---|---|
| `gpt-4o*` | GPT-4o | 2.50 | 10.00 |
| `claude-*-sonnet-*` | Claude Sonnet | 3.00 | 15.00 |
| `deepseek*` | DeepSeek | 0.14 | 0.28 |

The wildcard `*` matches any characters. Rules are matched in order, with exact matches taking priority.

## Privacy

- All conversation content, token statistics, and cost calculations are done **entirely in the browser locally**.
- The extension contains no remote server communication code (other than the AI API calls made by the monitored pages themselves).
- Data only exists in the current browser's IndexedDB — clearing browser data or clicking "Clear All Data" completely removes it.

## Known Limitations

1. Only covers **in-browser** web applications; cannot monitor desktop clients (requires a local proxy gateway approach).
2. Token estimation mode is not 100% accurate; prefer relying on API-returned usage when available.
3. Some heavily customized reseller platforms may hide the model field, in which case the model displays as `unknown`.
4. Multimodal (image/audio) token conversion is not yet implemented — planned for future releases.

## License

This project is released under the [MIT License](LICENSE).
