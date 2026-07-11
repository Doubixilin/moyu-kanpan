# 摸鱼看盘 Design

## Goal

Build a discreet, semi-transparent desktop widget that tracks selected A-share quotes, fetches relevant market news, optionally summarizes news with a configurable LLM API, and opens original news links on click. Development happens on macOS, but the runtime target is Windows.

## Architecture

The app uses Electron because it supports transparent always-on-top windows on Windows while still allowing macOS development and verification. The main process owns polling, provider calls, configuration, tray actions, and external-link opening. The renderer is a compact native TypeScript UI focused on dense quote/news scanning.

Provider integrations are deliberately isolated. The first implementation uses configurable public endpoints from Eastmoney and Tencent-style fallback parsing where possible; these are treated as best-effort public data sources, not stable contracted APIs. Future provider changes should only touch the provider layer.

## Components

- `electron/main.ts`: creates the transparent floating window, runs polling, exposes IPC, and opens links externally.
- `electron/preload.ts`: exposes a small typed API to the renderer.
- `src/domain/*`: shared types and alert/news analysis rules.
- `src/providers/*`: quote/news provider implementations and parsing.
- `src/ai/*`: optional OpenAI-compatible summarization client.
- `src/renderer.ts`: compact translucent widget UI.
- `config/defaults.json`: default watchlist, polling intervals, and provider settings.

## Data Flow

1. App loads defaults and optional local config.
2. Main process polls quotes and news on independent timers.
3. News items are deduplicated by URL/title and optionally sent to the AI analyzer.
4. Main process pushes snapshots to the renderer over IPC.
5. Renderer displays quotes, alerts, and news summaries. Clicking news asks the main process to open the original URL in the system browser.

## Error Handling

Network failures keep the latest successful snapshot and show a compact status line. Provider failures are recorded as source-specific errors so one broken feed does not blank the entire widget. AI analysis is optional and must degrade to rule-based summaries when credentials are missing or a request fails.

## Testing

Unit tests cover quote parsing, news deduplication, rule-based analysis, and config loading. A build check verifies TypeScript and Vite output. Electron runtime behavior is smoke-tested locally on macOS, with Windows packaging prepared but not fully validated until a Windows machine is available.
