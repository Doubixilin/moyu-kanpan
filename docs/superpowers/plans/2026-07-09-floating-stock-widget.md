# 摸鱼看盘 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows-targeted Electron floating stock/news widget that can be developed and smoke-tested on macOS.

**Architecture:** Electron main process handles background polling, provider calls, AI integration, tray/window behavior, and external links. React renderer displays a compact translucent watchlist and news feed. Provider and AI modules are isolated so data sources can be replaced later.

**Tech Stack:** Electron, TypeScript, Node test runner, electron-builder.

---

### Task 1: Scaffold and Test Harness

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `index.html`
- Create: `src/test/setup.ts`

- [ ] Create Node/Electron package scripts for `dev`, `build`, `test`, and `package:win`.
- [ ] Configure TypeScript for strict app and test code.
- [ ] Configure Vitest with jsdom for renderer-safe unit tests.
- [ ] Run `npm install`.
- [ ] Run `npm test` and confirm the empty test suite wiring works.

### Task 2: Domain and Provider Tests

**Files:**
- Create: `src/domain/types.ts`
- Create: `src/domain/news.ts`
- Create: `src/domain/analysis.ts`
- Create: `src/providers/eastmoney.ts`
- Create: `src/providers/tencent.ts`
- Create: `src/providers/__tests__/eastmoney.test.ts`
- Create: `src/domain/__tests__/news.test.ts`
- Create: `src/domain/__tests__/analysis.test.ts`

- [ ] Write failing tests for Eastmoney quote parsing.
- [ ] Write failing tests for Tencent quote parsing fallback.
- [ ] Write failing tests for news deduplication.
- [ ] Write failing tests for rule-based alert analysis.
- [ ] Implement minimal parser and domain code until tests pass.

### Task 3: Electron Main, Preload, and Config

**Files:**
- Create: `electron/main.ts`
- Create: `electron/preload.ts`
- Create: `src/config.ts`
- Create: `config/defaults.json`
- Create: `src/config.test.ts`

- [ ] Write failing config-loading tests for defaults and env overrides.
- [ ] Implement config loading.
- [ ] Create transparent, frameless, always-on-top BrowserWindow.
- [ ] Add IPC for initial snapshot, push updates, window controls, and opening links.
- [ ] Add tray menu for show/hide, opacity presets, and quit.

### Task 4: Renderer UI

**Files:**
- Create: `src/App.tsx`
- Create: `src/main.tsx`
- Create: `src/styles.css`
- Create: `src/vite-env.d.ts`

- [ ] Build compact quote rows with price, change percent, and source.
- [ ] Build compact news rows with title, source, time, AI/rule summary, and click target.
- [ ] Add status indicators for provider errors and stale data.
- [ ] Keep the UI semi-transparent, small, and suitable for always-on-top desktop use.

### Task 5: AI Integration and Docs

**Files:**
- Create: `src/ai/openaiCompatible.ts`
- Create: `.env.example`
- Create: `README.md`
- Create: `.gitignore`

- [ ] Add OpenAI-compatible API client driven by environment variables.
- [ ] Fall back to local rule-based summaries when no API key is configured.
- [ ] Document setup, development, Windows packaging, and API caveats.
- [ ] Run `npm test` and `npm run build`.
- [ ] Commit the working app.
