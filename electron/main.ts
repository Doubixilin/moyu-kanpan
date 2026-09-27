import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  safeStorage,
  screen,
  session,
  shell,
  Tray,
  type IpcMainInvokeEvent
} from "electron";
import { parse as parseDotEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CachedNewsAnalyzer, JsonNewsAnalysisCache } from "../src/ai/batch.js";
import { EncryptedApiKeyStore } from "../src/ai/credentials.js";
import {
  analyzeNewsBatch,
  safeAiError,
  testAiConnection as testAiProviderConnection
} from "../src/ai/openaiCompatible.js";
import {
  activeSecurityCodes,
  preserveRuntimeSecrets,
  toUserSettings,
  type AppConfig,
  type UserSettings,
  type WindowSettings
} from "../src/config.js";
import { analyzeNewsWithRules } from "../src/domain/analysis.js";
import { benchmarkCodeForSecurity, buildDecisionCue } from "../src/domain/decision.js";
import { buildSanitizedEventContext } from "../src/domain/handoff.js";
import {
  emptyMarketOverview,
  resolveMarketInstrument as resolveMarketInstrumentInput
} from "../src/domain/market.js";
import { aggregateNewsSource } from "../src/domain/news.js";
import { mostSevereAlert as pickMostSevereAlert } from "../src/domain/alertSeverity.js";
import { normalizeAiTestRequest as normalizeAiTestRequestInput } from "../src/domain/aiTestRequest.js";
import { parseLocalPreviewPort } from "../src/config.js";
import { errorMessage, upsertError } from "../src/domain/errors.js";
import {
  presentNews as presentNewsSelection,
  selectRelevantNews as selectRelevantNewsByContext
} from "../src/domain/newsSelection.js";
import { parseProfileRequest as parseProfileRequestInput } from "../src/settings/profile.js";
import { buildTrayPresentation, type TrayVisualState } from "../src/domain/trayStatus.js";
import {
  buildAlertCandidates,
  calculateRiskSnapshot,
  emptyRiskSnapshot
} from "../src/domain/risk.js";
import { ensureVisibleWindowBounds } from "../src/domain/windowBounds.js";
import { quickWindowBounds } from "../src/domain/quickWindowBounds.js";
import {
  isExternalLinkAllowed,
  isInsecureStorageBackend,
  isTrustedRendererUrl,
  resolveDevServerUrl
} from "../src/domain/runtimeSecurity.js";
import { isOversizedSettingsPayload } from "../src/domain/settingsPayload.js";
import {
  getAShareMarketState,
  isAShareTradingSession,
  isTradingCalendarVerified
} from "../src/domain/marketClock.js";
import {
  FAST_INDEX_INTERVAL_MS,
  IDLE_QUOTE_INTERVAL_MS,
  quoteTargetIntervalMs,
  startToStartDelayMs
} from "../src/domain/refreshPolicy.js";
import {
  buildFeedStatus,
  isQuoteFeedStalled,
  newestQuoteTimestamp,
  quoteFingerprint,
  summarizeNewsSourceHealth
} from "../src/domain/status.js";
import type {
  AiRuntimeStatus,
  AppSnapshot,
  DataSource,
  MarketDetail,
  MarketInstrument,
  NewsAnalysis,
  NewsItem,
  ProviderHealth,
  Quote
} from "../src/domain/types.js";
import { AlertEngine, JsonAlertStateStore } from "../src/services/alerts.js";
import { JsonMarketCache, MarketDataCoordinator } from "../src/services/marketData.js";
import { NewsDataCoordinator } from "../src/services/newsData.js";
import { openRecoveringNewsEventStore, SqliteNewsEventStore } from "../src/services/newsEvents.js";
import { QuoteCoordinator } from "../src/services/quotes.js";
import { createSingleFlight } from "../src/services/singleFlight.js";
import { LocalWorkWebServer } from "../src/services/localWeb.js";
import { buildPublicSnapshot, buildPublicTrend } from "../src/presentation/publicSnapshot.js";
import { SettingsStore, settingsForRenderer } from "../src/settings/store.js";
import {
  exportProfile,
  previewProfileImport,
  profilePrompt,
  type ProfileImportMode
} from "../src/settings/profile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAIN_RENDERER_PATH = path.join(__dirname, "../../dist/index.html");
const SETTINGS_RENDERER_PATH = path.join(__dirname, "../../dist/settings.html");
const QUICK_RENDERER_PATH = path.join(__dirname, "../../dist/quick.html");
const EXCEL_RENDERER_PATH = path.join(__dirname, "../../dist/excel.html");
const WORK_WEB_ROOT = path.join(__dirname, "../../dist");
const LOCAL_RENDERER_URLS = [
  MAIN_RENDERER_PATH,
  SETTINGS_RENDERER_PATH,
  QUICK_RENDERER_PATH,
  EXCEL_RENDERER_PATH
].map((entry) => pathToFileURL(entry).toString());
const ALLOWED_ENV_KEYS = ["AI_API_KEY", "AI_API_BASE_URL", "AI_MODEL"] as const;
const APP_ICON_PATH = path.join(__dirname, "../../resources/icons/app-256.png");
const TRAY_ICON_PATH = path.join(__dirname, "../../resources/icons/tray.png");

const CLICK_THROUGH_SHORTCUT_CANDIDATES = [
  "CommandOrControl+Alt+X",
  "CommandOrControl+Shift+F12",
  "CommandOrControl+Alt+F10",
  "CommandOrControl+Shift+F10"
];
let config: AppConfig;
let settingsStore: SettingsStore;
let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let quickWindow: BrowserWindow | null = null;
let excelWindow: BrowserWindow | null = null;
let localWorkWeb: LocalWorkWebServer | null = null;
let localWorkWebVisibleClients = 0;
let tray: Tray | null = null;
let trayVisualState: TrayVisualState | null = null;
let trayPresentationFingerprint = "";
let newsAnalyzer: CachedNewsAnalyzer;
let aiCredentialStore: EncryptedApiKeyStore;
let aiCredentialSource: AiRuntimeStatus["credentialSource"] = "none";
let aiStatus: AiRuntimeStatus = {
  enabled: false,
  configured: false,
  secureStorageAvailable: false,
  credentialSource: "none",
  state: "unconfigured",
  provider: "deepseek",
  model: "deepseek-v4-flash",
  lastTestedAt: null,
  lastSuccessAt: null,
  message: "未配置 API Key，使用本地规则"
};
let quotePollTimer: NodeJS.Timeout | null = null;
let fastIndexPollTimer: NodeJS.Timeout | null = null;
let marketPollTimer: NodeJS.Timeout | null = null;
let newsPollTimer: NodeJS.Timeout | null = null;
let refreshQuotesNow: (() => Promise<void>) | null = null;
let refreshFastIndicesNow: (() => Promise<void>) | null = null;
let refreshMarketNow: (() => Promise<void>) | null = null;
let refreshNewsNow: (() => Promise<void>) | null = null;
let latestQuotes: Quote[] = [];
let latestNews: AppSnapshot["news"] = [];
let latestMarket = emptyMarketOverview();
let latestRisk = emptyRiskSnapshot();
let latestErrors: string[] = [];
let clickThrough = false;
let showHideShortcut = "";
let clickThroughShortcut = CLICK_THROUGH_SHORTCUT_CANDIDATES[0] ?? "";
let boundsSaveTimer: NodeJS.Timeout | null = null;
let settingsSaveInProgress = false;
let quotesLastSuccessAt: string | null = null;
let newsLastSuccessAt: string | null = null;
let quotesLastAttemptFailed = false;
let newsLastAttemptFailed = false;
let newsAnalysisInFlight = false;
let newsRefreshGeneration = 0;
let quotesSource: DataSource | null = null;
let quotesDataUpdatedAt: string | null = null;
let quotesLastChangedAt: string | null = null;
let latestQuoteFingerprint: string | null = null;
let lastQuoteDeliveryFingerprint = "";
let lastQuoteDeliveryAt = 0;
let quotesCoverage: number | null = null;
let quotesDegraded = false;
let quotesConflictCount = 0;
let quotesRetainedCount = 0;
let quotesMissingCount = 0;
let quotesAlertSafe = false;
let quoteProviderHealth: ProviderHealth[] = [];
let newsSource: DataSource | null = null;
let isQuitting = false;
let shutdownInProgress = false;
let shutdownReady = false;
let devServerUrl: string | null = null;
let marketDataCoordinator: MarketDataCoordinator;
let newsDataCoordinator: NewsDataCoordinator;
let newsEventStore: SqliteNewsEventStore;
let alertEngine: AlertEngine;
let alertStateStore: JsonAlertStateStore;
let lastAlertStateSaveAt = 0;
const quoteCoordinator = new QuoteCoordinator();

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function createWindow(): BrowserWindow {
  const primaryWorkArea = screen.getPrimaryDisplay().workArea;
  const bounds = ensureVisibleWindowBounds(
    config.window,
    screen.getAllDisplays().map((display) => display.workArea),
    primaryWorkArea
  );
  const window = new BrowserWindow({
    ...bounds,
    show: false,
    transparent: true,
    frame: false,
    resizable: !config.window.locked,
    movable: !config.window.locked,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: config.window.alwaysOnTop,
    skipTaskbar: config.window.trayOnly,
    icon: APP_ICON_PATH,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  hardenRendererWindow(window);

  if (config.window.alwaysOnTop) window.setAlwaysOnTop(true, "screen-saver");
  window.setIgnoreMouseEvents(clickThrough, { forward: true });
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(MAIN_RENDERER_PATH);
  }
  window.webContents.on("did-finish-load", pushSnapshot);
  window.webContents.on("before-input-event", (event, input) => {
    if (input.key === "F11") event.preventDefault();
  });
  window.once("ready-to-show", () => void persistWindowBounds(window));
  window.on("move", () => scheduleWindowBoundsSave(window));
  window.on("resize", () => scheduleWindowBoundsSave(window));
  window.on("maximize", () => window.unmaximize());
  window.on("enter-full-screen", () => window.setFullScreen(false));
  window.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    window.hide();
    settingsWindow?.hide();
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  return window;
}

function createQuickWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 320,
    height: 380,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    icon: APP_ICON_PATH,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  hardenRendererWindow(window);
  if (devServerUrl) {
    void window.loadURL(new URL("quick.html", devServerUrl).toString());
  } else {
    void window.loadFile(QUICK_RENDERER_PATH);
  }
  window.webContents.on("did-finish-load", () => {
    if (!window.isDestroyed()) window.webContents.send("snapshot:update", snapshot());
  });
  window.on("blur", () => {
    if (!window.webContents.isDevToolsOpened()) window.hide();
  });
  window.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    window.hide();
  });
  window.on("closed", () => {
    if (quickWindow === window) quickWindow = null;
  });
  return window;
}

function createExcelWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 560,
    show: false,
    frame: false,
    transparent: false,
    resizable: true,
    movable: true,
    maximizable: true,
    minimizable: true,
    fullscreenable: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    title: "月度工作台 - 数据表",
    icon: APP_ICON_PATH,
    backgroundColor: "#f3f3f3",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  hardenRendererWindow(window);
  if (devServerUrl) {
    void window.loadURL(new URL("excel.html", devServerUrl).toString());
  } else {
    void window.loadFile(EXCEL_RENDERER_PATH);
  }
  window.webContents.on("did-finish-load", () => {
    if (!window.isDestroyed()) window.webContents.send("snapshot:update", snapshot());
  });
  window.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    window.hide();
  });
  window.on("closed", () => {
    if (excelWindow === window) excelWindow = null;
  });
  return window;
}

function openExcelWorkspace(): void {
  if (!excelWindow || excelWindow.isDestroyed()) excelWindow = createExcelWindow();
  if (excelWindow.isMinimized()) excelWindow.restore();
  excelWindow.show();
  excelWindow.moveTop();
  excelWindow.focus();
  triggerRefresh("quotes", refreshQuotesNow);
  triggerRefresh("indices", refreshFastIndices);
}

async function openLocalWorkWeb(): Promise<void> {
  if (!localWorkWeb) return;
  await shell.openExternal(localWorkWeb.url);
}
function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    mainWindow?.setAlwaysOnTop(false);
    settingsWindow.show();
    settingsWindow.moveTop();
    settingsWindow.focus();
    return;
  }

  const window = new BrowserWindow({
    width: 660,
    height: 780,
    minWidth: 560,
    minHeight: 620,
    title: "摸鱼看盘设置",
    autoHideMenuBar: true,
    skipTaskbar: config.window.trayOnly,
    icon: APP_ICON_PATH,
    backgroundColor: "#f3f4f6",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  hardenRendererWindow(window);
  settingsWindow = window;
  mainWindow?.setAlwaysOnTop(false);

  if (devServerUrl) {
    void window.loadURL(new URL("settings.html", devServerUrl).toString());
  } else {
    void window.loadFile(SETTINGS_RENDERER_PATH);
  }

  window.on("closed", () => {
    if (settingsWindow === window) settingsWindow = null;
    restoreConfiguredAlwaysOnTop();
  });
}
function createTray(): void {
  if (tray) return;
  const icon = nativeImage.createFromPath(TRAY_ICON_PATH).resize({
    width: 16,
    height: 16,
    quality: "best"
  });
  if (icon.isEmpty()) throw new Error("Failed to create tray icon");

  tray = new Tray(icon);
  tray.setToolTip("摸鱼看盘");
  tray.on("click", () => toggleQuickView());
  updateTrayMenu();
}

function updateTrayMenu(): void {
  if (!tray || !config) return;
  const bossKeyLabel = showHideShortcut || (config.window.bossKeyEnabled ? "注册失败" : "未启用");
  const latestAlert = latestRisk.recentEvents[0];
  const alertMode = config.risk.mode === "shadow" ? "影子模式" : "正式提醒";
  const presentation = buildTrayPresentation(snapshot());
  const tooltip = latestRisk.paused
    ? `${presentation.tooltip}｜提醒已暂停`
    : config.risk.mode === "active" && config.risk.notifications.tray && latestAlert
      ? `${presentation.tooltip}｜提醒：${latestAlert.title}`
      : presentation.tooltip;
  const fingerprint = JSON.stringify({
    tooltip,
    quoteLabels: presentation.quoteLabels,
    latestAlert: latestAlert?.id,
    alertMode,
    paused: latestRisk.paused,
    bossKeyLabel,
    window: config.window,
    tabs: config.tabs.map((tab) => [tab.id, tab.title, tab.visible, tab.order]),
    theme: config.appearance.theme,
    clickThrough
  });
  if (presentation.state !== trayVisualState) {
    tray.setImage(createTrayStateIcon(presentation.state));
    trayVisualState = presentation.state;
  }
  tray.setToolTip(tooltip.slice(0, 120));
  if (fingerprint === trayPresentationFingerprint) return;
  trayPresentationFingerprint = fingerprint;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示速览", click: () => toggleQuickView() },
      { label: "显示完整窗口（" + bossKeyLabel + "）", click: () => revealMainWindow() },
      { label: "打开月度工作台", click: () => openExcelWorkspace() },
      { label: "打开项目工作网页", click: () => void openLocalWorkWeb() },
      ...presentation.quoteLabels.map((label) => ({ label, enabled: false })),
      ...(presentation.quoteLabels.length > 0 ? [{ type: "separator" as const }] : []),
      { label: "设置…", click: () => openSettingsWindow() },
      { label: `提醒：${alertMode}${latestRisk.paused ? " · 已暂停" : ""}`, enabled: false },
      ...(latestAlert ? [{ label: `最近：${latestAlert.title}`, enabled: false }] : []),
      {
        label: latestRisk.paused ? "恢复提醒" : "暂停提醒至下一交易日",
        click: () => void (latestRisk.paused ? resumeAlerts() : pauseAlertsToday())
      },
      {
        label: "始终置顶",
        type: "checkbox",
        checked: config.window.alwaysOnTop,
        click: (item) => void updateWindowSettings({ alwaysOnTop: item.checked })
      },
      {
        label: "仅托盘驻留",
        type: "checkbox",
        checked: config.window.trayOnly,
        click: (item) => void updateWindowSettings({ trayOnly: item.checked })
      },
      {
        label: "锁定窗口位置",
        type: "checkbox",
        checked: config.window.locked,
        click: (item) => void updateWindowSettings({ locked: item.checked })
      },
      {
        label: "恢复默认窗口大小",
        click: () => void resetMainWindowBounds()
      },
      {
        label: "切换页面",
        submenu: config.tabs
          .filter((tab) => tab.visible)
          .sort((a, b) => a.order - b.order)
          .map((tab) => ({
            label: tab.title,
            type: "radio" as const,
            checked: config.navigation.lastActiveTabId === tab.id,
            click: () => void setActiveTab(tab.id)
          }))
      },
      {
        label: config.appearance.theme === "stealth" ? "切换为标准模式" : "切换为低调模式",
        click: () => void toggleTheme()
      },
      {
        label: clickThrough
          ? "关闭点击穿透（" + (clickThroughShortcut || "未注册") + "）"
          : "开启点击穿透（" + (clickThroughShortcut || "未注册") + "）",
        click: () => void toggleClickThrough(!clickThrough)
      },
      { type: "separator" },
      { label: "退出", click: () => app.quit() }
    ])
  );
}

function createTrayStateIcon(state: TrayVisualState): Electron.NativeImage {
  const colors: Record<TrayVisualState, string> = {
    neutral: "#64748b",
    up: "#c2413b",
    down: "#2f855a",
    attention: "#d38b16",
    degraded: "#7c3aed"
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="3" fill="${colors[state]}"/><path d="M4 10.5h2V7H4zm3 0h2V4.5H7zm3 0h2V6h-2z" fill="white" opacity=".92"/></svg>`;
  const dynamic = nativeImage
    .createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`)
    .resize({ width: 16, height: 16, quality: "best" });
  return dynamic.isEmpty()
    ? nativeImage.createFromPath(TRAY_ICON_PATH).resize({ width: 16, height: 16 })
    : dynamic;
}

function registerGlobalShortcuts(): void {
  try {
    applyBossKeyRegistration(config.window);
    latestErrors = latestErrors.filter((error) => !error.startsWith("shortcut:"));
  } catch (error) {
    latestErrors = upsertError(latestErrors, "shortcut:" + errorMessage(error));
  }
  clickThroughShortcut = registerFirstAvailableShortcut(
    CLICK_THROUGH_SHORTCUT_CANDIDATES,
    () => void toggleClickThrough(!clickThrough)
  );
  updateTrayMenu();
}

function applyBossKeyRegistration(next: WindowSettings): void {
  if (!next.bossKeyEnabled) {
    if (showHideShortcut) globalShortcut.unregister(showHideShortcut);
    showHideShortcut = "";
    return;
  }

  const shortcut = next.bossKeyAccelerator;
  if (showHideShortcut === shortcut && globalShortcut.isRegistered(shortcut)) return;
  if (!globalShortcut.register(shortcut, () => toggleWindow(true))) {
    throw new Error("老板键 " + shortcut + " 已被其他程序占用");
  }

  if (showHideShortcut && showHideShortcut !== shortcut) {
    globalShortcut.unregister(showHideShortcut);
  }
  showHideShortcut = shortcut;
}
function registerFirstAvailableShortcut(candidates: string[], handler: () => void): string {
  for (const shortcut of candidates) {
    if (globalShortcut.register(shortcut, handler)) return shortcut;
  }
  latestErrors = upsertError(latestErrors, `shortcut:${candidates.join(" / ")} 注册失败`);
  return "";
}

function scheduleWindowBoundsSave(window: BrowserWindow): void {
  if (
    config.window.locked ||
    window.isDestroyed() ||
    window.isMaximized() ||
    window.isFullScreen() ||
    window.isMinimized()
  )
    return;
  if (boundsSaveTimer) clearTimeout(boundsSaveTimer);
  boundsSaveTimer = setTimeout(() => {
    boundsSaveTimer = null;
    void persistWindowBounds(window);
  }, 350);
}

async function persistWindowBounds(window: BrowserWindow): Promise<void> {
  if (
    isQuitting ||
    config.window.locked ||
    window.isDestroyed() ||
    window.isMaximized() ||
    window.isFullScreen() ||
    window.isMinimized()
  )
    return;
  if (settingsSaveInProgress) {
    scheduleWindowBoundsSave(window);
    return;
  }
  const bounds = window.getBounds();
  if (
    config.window.x === bounds.x &&
    config.window.y === bounds.y &&
    config.window.width === bounds.width &&
    config.window.height === bounds.height
  ) {
    return;
  }

  const next = toUserSettings(config);
  next.window = { ...next.window, ...bounds };
  try {
    config = preserveRuntimeSecrets(await settingsStore.save(next), config);
  } catch (error) {
    latestErrors = upsertError(latestErrors, "window:" + errorMessage(error));
    pushSnapshot();
  }
}

function restoreConfiguredAlwaysOnTop(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (config.window.alwaysOnTop) {
    mainWindow.setAlwaysOnTop(true, "screen-saver");
  } else {
    mainWindow.setAlwaysOnTop(false);
  }
}

function applyWindowPreferences(): void {
  clickThrough = config.window.clickThrough;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible()) {
      mainWindow.setAlwaysOnTop(false);
    } else {
      restoreConfiguredAlwaysOnTop();
    }
    mainWindow.setSkipTaskbar(config.window.trayOnly);
    mainWindow.setMovable(!config.window.locked);
    mainWindow.setResizable(!config.window.locked);
    mainWindow.setMaximizable(false);
    mainWindow.setFullScreenable(false);
    mainWindow.setIgnoreMouseEvents(clickThrough, { forward: true });
  }
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.setSkipTaskbar(config.window.trayOnly);
  }
  if (process.platform === "darwin" && app.dock) {
    if (config.window.trayOnly) app.dock.hide();
    else void app.dock.show();
  }
}
function loadEnvironmentFiles(): void {
  // 打包态**不读任何 `.env`**：exe 目录、userData 与 cwd 都在同用户可写范围内，
  // 能被用来把已保存的密钥指向攻击者的端点（审计报告 §8 Low-5）。
  // 打包后请用设置界面配置（安全存储），或由系统环境变量提供 AI_*。
  if (app.isPackaged) return;
  const candidates = [
    path.join(app.getPath("userData"), ".env"),
    path.join(path.dirname(app.getPath("exe")), ".env"),
    path.join(process.cwd(), ".env")
  ];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const normalized = path.resolve(candidate);
    if (seen.has(normalized) || !fs.existsSync(normalized)) continue;
    seen.add(normalized);
    const parsed = parseDotEnv(fs.readFileSync(normalized));
    for (const key of ALLOWED_ENV_KEYS) {
      if (process.env[key] === undefined && typeof parsed[key] === "string") {
        process.env[key] = parsed[key];
      }
    }
  }
}

/** `safeStorage` 实际选中的后端；非 Linux 或 API 不可用时返回 undefined。 */
function selectedStorageBackend(): string | undefined {
  try {
    return safeStorage.getSelectedStorageBackend();
  } catch {
    return undefined;
  }
}

function readDefaultConfig(): Record<string, unknown> {
  const candidates = [
    path.join(__dirname, "../../config/defaults.json"),
    path.join(process.resourcesPath ?? "", "config/defaults.json")
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    // JSON.parse 返回 any；显式收敛并确认是对象，避免 any 扩散成 AppConfig。
    const parsed: unknown = JSON.parse(fs.readFileSync(candidate, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  }
  return {};
}

function findPersonalSeedPath(): string | undefined {
  const candidates = [
    path.join(app.getPath("userData"), "personal.local.json"),
    path.join(path.dirname(app.getPath("exe")), "personal.local.json"),
    ...(!app.isPackaged ? [path.join(process.cwd(), "config", "personal.local.json")] : [])
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function hardenRendererWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url, LOCAL_RENDERER_URLS, devServerUrl)) event.preventDefault();
  });
}

function handleTrusted(
  channel: string,
  // 用 unknown[] 而不是 any[]：渲染器传进来的参数都是不可信输入，必须由各 handler 自行收窄。
  listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
): void {
  ipcMain.handle(channel, (event, ...args) => {
    const senderUrl = event.senderFrame?.url ?? event.sender.getURL();
    if (!isTrustedRendererUrl(senderUrl, LOCAL_RENDERER_URLS, devServerUrl)) {
      throw new Error("拒绝来自非受信页面的请求");
    }
    // Electron 把 args 标为 any[]；显式收敛成 unknown[] 交给各 handler 自行收窄。
    return listener(event, ...(args as unknown[]));
  });
}
function quoteSurfaceIsForeground(): boolean {
  return Boolean(
    (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) ||
    (quickWindow && !quickWindow.isDestroyed() && quickWindow.isVisible()) ||
    (excelWindow && !excelWindow.isDestroyed() && excelWindow.isVisible()) ||
    localWorkWebVisibleClients > 0
  );
}

function scheduleQuoteRefresh(startedAtMs: number): void {
  if (isQuitting) return;
  if (quotePollTimer) clearTimeout(quotePollTimer);
  const now = new Date();
  const target = quoteTargetIntervalMs({
    marketState: getAShareMarketState(now),
    foreground: quoteSurfaceIsForeground(),
    mode: config.refreshPolicy.mode
  });
  const delay = startToStartDelayMs(target, Date.now() - startedAtMs);
  quotePollTimer = setTimeout(runQuoteRefresh, delay);
}

function runQuoteRefresh(): void {
  if (isQuitting || !refreshQuotesNow) return;
  if (quotePollTimer) clearTimeout(quotePollTimer);
  const startedAtMs = Date.now();
  void refreshQuotesNow()
    .catch((error) => reportInternalFailure("quotes", error))
    .finally(() => scheduleQuoteRefresh(startedAtMs));
}

function scheduleFastIndexRefresh(startedAtMs: number): void {
  if (isQuitting) return;
  if (fastIndexPollTimer) clearTimeout(fastIndexPollTimer);
  const target = isAShareTradingSession(new Date())
    ? FAST_INDEX_INTERVAL_MS
    : IDLE_QUOTE_INTERVAL_MS;
  const delay = startToStartDelayMs(target, Date.now() - startedAtMs);
  fastIndexPollTimer = setTimeout(runFastIndexRefresh, delay);
}

function runFastIndexRefresh(): void {
  if (isQuitting || !refreshFastIndicesNow) return;
  if (fastIndexPollTimer) clearTimeout(fastIndexPollTimer);
  const startedAtMs = Date.now();
  void refreshFastIndicesNow()
    .catch((error) => reportInternalFailure("indices", error))
    .finally(() => scheduleFastIndexRefresh(startedAtMs));
}

function scheduleMarketRefresh(): void {
  if (isQuitting) return;
  if (marketPollTimer) clearTimeout(marketPollTimer);
  const activeInterval = Math.max(config.pollIntervals.quotesMs * 3, 15_000);
  const target = isAShareTradingSession(new Date()) ? activeInterval : 60_000;
  const delay = startToStartDelayMs(target, 0);
  marketPollTimer = setTimeout(() => {
    void runMarketRefresh();
  }, delay);
}

async function runMarketRefresh(): Promise<void> {
  try {
    await refreshMarketNow?.();
  } catch (error) {
    reportInternalFailure("market", error);
  } finally {
    scheduleMarketRefresh();
  }
}

/** 网络恢复/系统唤醒后的补偿刷新：60 秒内只认真执行一次（审计报告 §8 Info-8）。 */
const CONNECTIVITY_REFRESH_COOLDOWN_MS = 60_000;
let lastConnectivityRefreshAt = 0;

function refreshAfterConnectivityChange(): void {
  const now = Date.now();
  // 失败重连、反复休眠/唤醒、多个窗口同时 online 时都会走到这里；
  // 去掉防抖会打成"突发外网请求"，而 60 秒内的行情/新闻本来就是同一批数据。
  if (now - lastConnectivityRefreshAt < CONNECTIVITY_REFRESH_COOLDOWN_MS) return;
  lastConnectivityRefreshAt = now;
  runQuoteRefresh();
  runFastIndexRefresh();
  triggerRefresh("market", refreshMarketNow);
  triggerRefresh("news", refreshNewsNow);
}

async function refreshQuotes(): Promise<void> {
  const evaluationTime = new Date();
  try {
    const codes = activeSecurityCodes(config);
    if (codes.length === 0) {
      latestQuotes = [];
      latestQuoteFingerprint = null;
      quotesDataUpdatedAt = null;
      quotesLastChangedAt = null;
      quotesSource = null;
      quotesCoverage = null;
      quotesDegraded = false;
      quotesConflictCount = 0;
      quotesRetainedCount = 0;
      quotesMissingCount = 0;
      quotesAlertSafe = false;
      quoteProviderHealth = [];
      quotesLastAttemptFailed = false;
      latestErrors = latestErrors.filter((error) => !error.startsWith("quotes:"));
    } else {
      const now = evaluationTime;
      // 交易日历只按年维护：未收录的年份会退化为"工作日 + 时段"判断，休市日会被当作
      // 交易日。这里把该状态变成可见告警，避免静默降级（否则 2027 起无人察觉）。
      latestErrors = isTradingCalendarVerified(now)
        ? latestErrors.filter((error) => !error.startsWith("calendar:"))
        : upsertError(
            latestErrors,
            "calendar:交易日历未收录当前年份，休市日将按交易日处理，请更新到新版本"
          );
      const result = await quoteCoordinator.fetch(codes, config.providers.quote, {
        marketOpen: isAShareTradingSession(now),
        nowMs: now.getTime(),
        maxSourceAgeMs: Math.max(config.pollIntervals.quotesMs * 6, 60_000)
      });
      const receivedAt = now.toISOString();
      const nextFingerprint = quoteFingerprint(result.quotes);
      if (latestQuoteFingerprint !== nextFingerprint) quotesLastChangedAt = receivedAt;
      latestQuoteFingerprint = nextFingerprint;
      quotesDataUpdatedAt = newestQuoteTimestamp(result.quotes);
      latestQuotes = result.quotes;
      quotesSource = result.quotes.length > 0 ? result.source : null;
      quotesCoverage = result.coverage;
      quotesDegraded = result.degraded;
      quotesConflictCount = result.conflictCount;
      quotesRetainedCount = result.retainedCount;
      quotesMissingCount = result.missingCodes.length;
      quotesAlertSafe = result.alertSafe;
      quoteProviderHealth = result.providerHealth;
      quotesLastAttemptFailed = result.liveCount === 0;
      if (result.liveCount > 0) {
        quotesLastSuccessAt = receivedAt;
        latestErrors = latestErrors.filter((error) => !error.startsWith("quotes:"));
      } else {
        const reason = result.failures.join("; ") || "no trusted live quote";
        latestErrors = upsertError(latestErrors, `quotes:${reason}`);
      }
    }
  } catch (error) {
    quotesLastAttemptFailed = true;
    quotesDegraded = true;
    quotesAlertSafe = false;
    latestErrors = upsertError(latestErrors, `quotes:${errorMessage(error)}`);
  }
  // 提醒子系统（系统通知 / 托盘）的异常不应中断行情快照，也不能让 rejection 逃逸出去。
  try {
    await refreshRisk(evaluationTime);
  } catch (error) {
    reportInternalFailure("risk", error);
  }
  pushQuoteSnapshotIfNeeded();
}

function pushQuoteSnapshotIfNeeded(): void {
  const fingerprint = JSON.stringify({
    quotes: latestQuoteFingerprint,
    source: quotesSource,
    coverage: quotesCoverage,
    degraded: quotesDegraded,
    conflictCount: quotesConflictCount,
    retainedCount: quotesRetainedCount,
    missingCount: quotesMissingCount,
    alertSafe: quotesAlertSafe,
    failed: quotesLastAttemptFailed,
    errors: latestErrors.filter((error) => error.startsWith("quotes:")),
    riskSafe: latestRisk.dataSafe,
    latestAlert: latestRisk.recentEvents.at(-1)?.id ?? null
  });
  const nowMs = Date.now();
  if (fingerprint === lastQuoteDeliveryFingerprint && nowMs - lastQuoteDeliveryAt < 15_000) {
    return;
  }
  lastQuoteDeliveryFingerprint = fingerprint;
  lastQuoteDeliveryAt = nowMs;
  pushSnapshot();
}

async function refreshFastIndices(): Promise<void> {
  const now = new Date();
  try {
    const result = await marketDataCoordinator.fetchFastIndices(config.providers.quote, {
      marketOpen: isAShareTradingSession(now),
      nowMs: now.getTime(),
      maxSourceAgeMs: Math.max(FAST_INDEX_INTERVAL_MS * 12, 60_000)
    });
    if (result.items.length === 0) return;
    const previous = JSON.stringify(latestMarket.indices);
    latestMarket = {
      ...latestMarket,
      indices: result.items,
      source: result.source ?? latestMarket.source,
      updatedAt:
        newestQuoteTimestamp(
          result.items.map((item) => ({
            code: item.instrument.code,
            name: item.instrument.name,
            market: item.instrument.market,
            price: item.price,
            change: item.change,
            changePercent: item.changePercent,
            open: null,
            previousClose: null,
            high: null,
            low: null,
            volume: null,
            amount: item.amount,
            source: item.source,
            updatedAt: item.updatedAt ?? undefined
          }))
        ) ?? latestMarket.updatedAt,
      errors: [
        ...latestMarket.errors.filter((error) => !error.startsWith("indices:")),
        ...result.errors.map((error) => `indices:${error}`)
      ]
    };
    if (JSON.stringify(latestMarket.indices) !== previous) pushSnapshot();
  } catch (error) {
    latestMarket = {
      ...latestMarket,
      errors: [
        ...latestMarket.errors.filter((entry) => !entry.startsWith("indices:")),
        `indices:${errorMessage(error)}`
      ]
    };
  }
}

async function refreshRisk(now: Date): Promise<void> {
  if (!alertEngine) return;
  const stalled = isQuoteFeedStalled({
    dataUpdatedAt: quotesDataUpdatedAt,
    lastChangedAt: quotesLastChangedAt,
    marketOpen: isAShareTradingSession(now),
    nowMs: now.getTime(),
    thresholdMs: Math.max(config.pollIntervals.quotesMs * 6, 45_000)
  });
  const calculated = calculateRiskSnapshot({
    settings: config,
    quotes: latestQuotes,
    feedHealthy: !quotesLastAttemptFailed && !stalled,
    now
  });
  const evaluation = alertEngine.evaluate(buildAlertCandidates(config, calculated), {
    now,
    mode: config.risk.mode,
    cooldownMinutes: config.risk.cooldownMinutes,
    oncePerDay: config.risk.oncePerDay,
    onlyDuringTrading: config.risk.onlyDuringTrading,
    tradingSession: isAShareTradingSession(now)
  });
  latestRisk = {
    ...calculated,
    paused: evaluation.paused,
    pausedThroughDate: alertEngine.exportState().pausedThroughDate,
    recentEvents: alertEngine.recentEvents()
  };
  if (evaluation.events.length > 0) deliverAlertEvents(evaluation.events);
  if (
    evaluation.stateChanged &&
    (evaluation.events.length > 0 || now.getTime() - lastAlertStateSaveAt >= 30_000)
  ) {
    await persistAlertState(now.getTime());
  }
}

async function persistAlertState(nowMs = Date.now()): Promise<void> {
  try {
    await alertStateStore.write(alertEngine.exportState());
    lastAlertStateSaveAt = nowMs;
  } catch {
    // Alert persistence failure must not take down live quote refresh.
  }
}

function mostSevereAlert(
  events: AppSnapshot["risk"]["recentEvents"]
): AppSnapshot["risk"]["recentEvents"][number] | undefined {
  return pickMostSevereAlert(events);
}

function deliverAlertEvents(events: AppSnapshot["risk"]["recentEvents"]): void {
  if (config.risk.mode !== "active") return;
  const mostSevere = mostSevereAlert(events);
  if (!mostSevere) return;
  if (config.risk.notifications.windows && Notification.isSupported()) {
    for (const event of events) {
      new Notification({ title: event.title, body: event.message, silent: true }).show();
    }
  }
  if (config.risk.notifications.tray) {
    tray?.setToolTip(`提醒：${mostSevere.title}`);
    updateTrayMenu();
  }
}

async function pauseAlertsToday(): Promise<void> {
  alertEngine.pauseForToday();
  await persistAlertState();
  await refreshRisk(new Date());
  updateTrayMenu();
  pushSnapshot();
}

async function resumeAlerts(): Promise<void> {
  alertEngine.resume();
  await persistAlertState();
  await refreshRisk(new Date());
  updateTrayMenu();
  pushSnapshot();
}

async function refreshMarket(): Promise<void> {
  const now = new Date();
  try {
    latestMarket = await marketDataCoordinator.fetchOverview(config.providers.quote, {
      marketOpen: isAShareTradingSession(now),
      nowMs: now.getTime(),
      maxSourceAgeMs: Math.max(config.pollIntervals.quotesMs * 10, 120_000)
    });
  } catch (error) {
    latestMarket = {
      ...latestMarket,
      stale: true,
      degraded: true,
      errors: [`market:${errorMessage(error)}`]
    };
  }
  pushSnapshot();
}
async function refreshNews(): Promise<void> {
  try {
    const generation = ++newsRefreshGeneration;
    const analysisNamespace = aiAnalysisNamespace();
    const candidateLimit =
      config.news.mode === "important"
        ? Math.min(40, Math.max(config.news.maxItems * 3, 20))
        : Math.min(30, Math.max(config.news.maxItems * 2, 20));
    const activeCodes = activeSecurityCodes(config);
    const result = await newsDataCoordinator.refresh(activeCodes, {
      limit: Math.max(candidateLimit * 4, 100),
      analysisNamespace
    });
    const candidates = selectRelevantNews(result.items).slice(0, candidateLimit);
    const now = new Date();
    const pending =
      config.ai.enabled && config.ai.apiKey
        ? candidates.filter(
            (item) =>
              !item.analysis &&
              newsEventStore.analysisDue(item.eventId ?? item.id, now, analysisNamespace)
          )
        : [];
    const analyzed = candidates.map((item) => ({
      ...item,
      analysis: item.analysis ?? analyzeNewsWithRules(item, "AI 分析排队中")
    }));

    latestNews = presentNews(analyzed, candidateLimit);
    if (result.liveSuccess) {
      newsSource = aggregateNewsSource(result.items, result.sources);
      newsLastSuccessAt = result.fetchedAt;
    }
    if (result.attempted) newsLastAttemptFailed = result.degraded || !result.liveSuccess;
    const sourceHealthMessage = summarizeNewsSourceHealth(newsSourceStates());
    latestErrors = sourceHealthMessage
      ? upsertError(latestErrors, `news:${sourceHealthMessage}`)
      : latestErrors.filter((error) => !error.startsWith("news:"));
    void analyzePendingNews(
      pending.slice(0, 5),
      candidates,
      analysisNamespace,
      candidateLimit,
      generation
    );
  } catch (error) {
    newsLastAttemptFailed = true;
    const sourceHealthMessage = summarizeNewsSourceHealth(newsSourceStates());
    // 不要吞掉异常本身：此前 catch {} 丢掉了 newsData 抛出的具体原因。
    const detail = [sourceHealthMessage, errorMessage(error)].filter(Boolean).join("；");
    latestErrors = upsertError(latestErrors, `news:${detail || "资讯更新暂时失败，稍后自动重试"}`);
  }
  pushSnapshot();
}

function presentNews(items: AppSnapshot["news"], limit: number): AppSnapshot["news"] {
  return presentNewsSelection(items, limit, config.news.mode);
}

async function analyzePendingNews(
  pending: NewsItem[],
  candidates: Array<NewsItem & { analysis?: NewsAnalysis }>,
  namespace: string,
  limit: number,
  generation: number
): Promise<void> {
  if (!pending.length || newsAnalysisInFlight) return;
  newsAnalysisInFlight = true;
  try {
    const analyses = await newsAnalyzer.analyze(pending, namespace);
    const analyzedById = new Map(pending.map((item, index) => [item.id, analyses[index]!]));
    const now = new Date();
    for (const item of pending) {
      const analysis = analyzedById.get(item.id);
      if (!analysis) continue;
      if (analysis.provider === "ai" && analysis.status === "analyzed") {
        newsEventStore.saveAnalysis(item.eventId ?? item.id, analysis, namespace);
      } else if (config.ai.enabled && config.ai.apiKey && analysis.failureReason) {
        newsEventStore.markAnalysisFailure(item.eventId ?? item.id, analysis.failureReason, now);
      }
    }
    if (generation !== newsRefreshGeneration || namespace !== aiAnalysisNamespace()) return;
    const analyzed = candidates.map((item) => ({
      ...item,
      analysis:
        item.analysis ?? analyzedById.get(item.id) ?? analyzeNewsWithRules(item, "AI 分析排队中")
    }));
    latestNews = presentNews(analyzed, limit);
    pushSnapshot();
  } catch (error) {
    latestErrors = upsertError(latestErrors, `ai:${safeAiError(error)}`);
    pushSnapshot();
  } finally {
    newsAnalysisInFlight = false;
  }
}

function newsSourceStates() {
  return ["eastmoney", "media-fallback", "cninfo", "csrc"].map((source) =>
    newsEventStore.sourceState(source)
  );
}

function selectRelevantNews<T extends NewsItem>(items: T[]): T[] {
  return selectRelevantNewsByContext(items, {
    securities: config.securities,
    activeCodes: activeSecurityCodes(config),
    quoteNames: new Map(
      latestQuotes.filter((quote) => quote.name).map((quote) => [quote.code, quote.name])
    ),
    mode: config.news.mode
  });
}
function aiAnalysisNamespace(): string {
  if (!config.ai.enabled || !config.ai.apiKey) return "rules-v2";
  return ["ai-v4", config.ai.provider, config.ai.baseUrl, config.ai.model].join(":");
}

async function maybeAnalyzeBatch(items: NewsItem[]): Promise<NewsAnalysis[]> {
  if (!config.ai.enabled) {
    setAiReadyStatus("AI 已关闭，使用本地规则");
    return items.map((item) => analyzeNewsWithRules(item, "AI 已关闭"));
  }
  if (!config.ai.apiKey) {
    setAiReadyStatus("未配置 API Key，使用本地规则");
    return items.map((item) => analyzeNewsWithRules(item, "未配置 API Key"));
  }

  try {
    const analyses = await analyzeNewsBatch(items, config.ai);
    const now = new Date().toISOString();
    aiStatus = {
      ...aiStatus,
      enabled: true,
      configured: true,
      credentialSource: aiCredentialSource,
      state: "success",
      provider: config.ai.provider,
      model: config.ai.model,
      lastSuccessAt: now,
      message: `AI 分析成功 · ${config.ai.model}`
    };
    return analyses;
  } catch (error) {
    const message = safeAiError(error);
    aiStatus = {
      ...aiStatus,
      enabled: config.ai.enabled,
      configured: Boolean(config.ai.apiKey),
      credentialSource: aiCredentialSource,
      state: "error",
      provider: config.ai.provider,
      model: config.ai.model,
      message
    };
    return items.map((item) => analyzeNewsWithRules(item, message));
  }
}

function setAiReadyStatus(message?: string): void {
  const configured = Boolean(config.ai.apiKey);
  aiStatus = {
    ...aiStatus,
    enabled: config.ai.enabled,
    configured,
    secureStorageAvailable: aiCredentialStore?.isAvailable() ?? false,
    credentialSource: aiCredentialSource,
    state: configured ? "ready" : "unconfigured",
    provider: config.ai.provider,
    model: config.ai.model,
    message:
      message ??
      (configured
        ? config.ai.enabled
          ? `已配置 ${config.ai.model}`
          : "已配置但未启用"
        : "未配置 API Key，使用本地规则")
  };
}

function aiStatusForRenderer(): AiRuntimeStatus {
  return { ...aiStatus };
}

function pushAiStatus(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send("ai:statusUpdate", aiStatusForRenderer());
  }
  pushSnapshot();
}

async function initializeAiCredentials(): Promise<void> {
  const environmentKey = config.ai.apiKey.trim();
  let secureKey = "";
  let credentialError = "";
  try {
    secureKey = await aiCredentialStore.read();
  } catch (error) {
    credentialError = safeAiError(error);
  }

  config.ai.apiKey = secureKey || environmentKey;
  aiCredentialSource = secureKey ? "secure" : environmentKey ? "environment" : "none";
  setAiReadyStatus(
    credentialError ||
      (aiCredentialSource === "environment"
        ? "使用环境变量中的 API Key；设置页不会显示明文"
        : undefined)
  );
  if (credentialError) aiStatus.state = "error";
}

async function setAiApiKey(value: unknown): Promise<AiRuntimeStatus> {
  if (typeof value !== "string") throw new Error("API Key 无效");
  await aiCredentialStore.write(value);
  config.ai.apiKey = value.trim();
  aiCredentialSource = "secure";
  setAiReadyStatus("API Key 已通过系统安全存储加密保存");
  pushAiStatus();
  triggerRefresh("news", refreshNewsNow);
  return aiStatusForRenderer();
}

async function clearAiApiKey(): Promise<AiRuntimeStatus> {
  await aiCredentialStore.clear();
  const environmentKey = (process.env.AI_API_KEY ?? "").trim();
  config.ai.apiKey = environmentKey;
  aiCredentialSource = environmentKey ? "environment" : "none";
  setAiReadyStatus(
    environmentKey
      ? "已清除安全存储；环境变量中的 API Key 仍然生效"
      : "API Key 已清除，使用本地规则"
  );
  newsAnalyzer.clearMemory();
  pushAiStatus();
  triggerRefresh("news", refreshNewsNow);
  return aiStatusForRenderer();
}

async function testConfiguredAi(value: unknown): Promise<AiRuntimeStatus> {
  const request = normalizeAiTestRequest(value);
  aiStatus = {
    ...aiStatus,
    enabled: request.enabled,
    state: "testing",
    provider: request.provider,
    model: request.model,
    message: "正在测试模型连接…"
  };
  pushAiStatus();

  const testedAt = new Date().toISOString();
  try {
    await testAiProviderConnection(request);
    aiStatus = {
      ...aiStatus,
      enabled: config.ai.enabled,
      configured: Boolean(config.ai.apiKey),
      credentialSource: aiCredentialSource,
      state: "success",
      provider: request.provider,
      model: request.model,
      lastTestedAt: testedAt,
      lastSuccessAt: testedAt,
      message: `连接成功 · ${request.model}`
    };
  } catch (error) {
    aiStatus = {
      ...aiStatus,
      enabled: config.ai.enabled,
      configured: Boolean(config.ai.apiKey),
      credentialSource: aiCredentialSource,
      state: "error",
      provider: request.provider,
      model: request.model,
      lastTestedAt: testedAt,
      message: safeAiError(error)
    };
  }
  pushAiStatus();
  return aiStatusForRenderer();
}

function normalizeAiTestRequest(value: unknown): AppConfig["ai"] {
  return normalizeAiTestRequestInput(value, config.ai.apiKey);
}

function snapshot(): AppSnapshot {
  const now = new Date();
  const quotesStalled = isQuoteFeedStalled({
    dataUpdatedAt: quotesDataUpdatedAt,
    lastChangedAt: quotesLastChangedAt,
    marketOpen: isAShareTradingSession(now),
    nowMs: now.getTime(),
    thresholdMs: Math.max(config.pollIntervals.quotesMs * 6, 45_000)
  });
  return {
    quotes: latestQuotes,
    news: latestNews,
    market: latestMarket,
    risk: latestRisk,
    ai: aiStatusForRenderer(),
    errors: latestErrors,
    updatedAt: now.toISOString(),
    settings: settingsForRenderer(config),
    feeds: {
      quotes: buildFeedStatus({
        lastSuccessAt: quotesLastSuccessAt,
        lastAttemptFailed: quotesLastAttemptFailed,
        intervalMs: config.pollIntervals.quotesMs,
        source: quotesSource,
        dataUpdatedAt: quotesDataUpdatedAt,
        lastChangedAt: quotesLastChangedAt,
        stalled: quotesStalled,
        coverage: quotesCoverage,
        degraded: quotesDegraded,
        conflictCount: quotesConflictCount,
        retainedCount: quotesRetainedCount,
        missingCount: quotesMissingCount,
        alertSafe: quotesAlertSafe,
        providerHealth: quoteProviderHealth,
        marketState: getAShareMarketState(now)
      }),
      news: buildFeedStatus({
        lastSuccessAt: newsLastSuccessAt,
        lastAttemptFailed: newsLastAttemptFailed,
        intervalMs: config.pollIntervals.newsMs,
        source: newsSource
      })
    },
    ui: {
      clickThrough
    }
  };
}

function pushSnapshot(): void {
  updateTrayMenu();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("snapshot:update", snapshot());
  }
  if (quickWindow && !quickWindow.isDestroyed()) {
    quickWindow.webContents.send("snapshot:update", snapshot());
  }
  if (excelWindow && !excelWindow.isDestroyed()) {
    excelWindow.webContents.send("snapshot:update", snapshot());
  }
  localWorkWeb?.broadcast(buildPublicSnapshot(snapshot()));
}

function pushSettings(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send("settings:update", settingsForRenderer(config));
    settingsWindow.webContents.send("ai:statusUpdate", aiStatusForRenderer());
  }
}

function registerIpc(): void {
  handleTrusted("app:online", () => refreshAfterConnectivityChange());
  handleTrusted("snapshot:get", () => snapshot());
  handleTrusted("settings:get", () => settingsForRenderer(config));
  handleTrusted("ai:status", () => aiStatusForRenderer());
  handleTrusted("ai:setApiKey", (_event, apiKey: unknown) => setAiApiKey(apiKey));
  handleTrusted("ai:clearApiKey", () => clearAiApiKey());
  handleTrusted("ai:testConnection", (_event, value: unknown) => testConfiguredAi(value));
  handleTrusted("alerts:pauseToday", () => pauseAlertsToday());
  handleTrusted("alerts:resume", () => resumeAlerts());
  handleTrusted("market:detail", async (_event, value: unknown): Promise<MarketDetail> => {
    const instrument = resolveMarketInstrument(value);
    const now = new Date();
    return marketDataCoordinator.fetchDetail(instrument, config.providers.quote, {
      marketOpen: isAShareTradingSession(now),
      nowMs: now.getTime(),
      maxSourceAgeMs: Math.max(config.pollIntervals.quotesMs * 10, 180_000)
    });
  });
  handleTrusted("settings:save", async (_event, value: unknown) => {
    // 渲染器已被 sender 校验过，但载荷体积仍要有上限（配置导入包有 2 MB 上限）。
    if (isOversizedSettingsPayload(value)) throw new Error("设置数据过大，已拒绝保存");
    return saveSettings(value);
  });
  handleTrusted("navigation:setActiveTab", async (_event, tabId: unknown) =>
    typeof tabId === "string" ? setActiveTab(tabId) : settingsForRenderer(config)
  );
  handleTrusted("settings:open", () => openSettingsWindow());
  handleTrusted("window:hide", () => hideMainWindow());
  handleTrusted("window:showFull", () => {
    quickWindow?.hide();
    revealMainWindow();
  });
  handleTrusted("quick:hide", () => quickWindow?.hide());
  handleTrusted("excel:open", () => openExcelWorkspace());
  handleTrusted("excel:windowAction", (_event, action: unknown) => {
    if (!excelWindow || excelWindow.isDestroyed()) return;
    if (action === "minimize") excelWindow.minimize();
    if (action === "maximize") {
      if (excelWindow.isMaximized()) excelWindow.unmaximize();
      else excelWindow.maximize();
    }
    if (action === "close") excelWindow.hide();
  });
  handleTrusted("appearance:setBackgroundOpacity", async (_event, opacity: unknown) => {
    const next = toUserSettings(config);
    const value = Number(opacity);
    // 非法输入保持当前值，其余交给保存路径的规范化裁剪。
    if (Number.isFinite(value)) next.appearance.backgroundOpacity = value;
    return saveSettings(next);
  });
  handleTrusted("appearance:toggleTheme", () => toggleTheme());
  handleTrusted("link:open", async (_event, url: unknown) => {
    // 只放行无 userinfo 的 https：明文 http 会把用户送到可被篡改的页面上。
    if (isExternalLinkAllowed(url)) await shell.openExternal(url as string);
  });
  handleTrusted("news:copyContext", (_event, eventId: unknown) => {
    const text = sanitizedContextForEvent(eventId);
    clipboard.writeText(text);
    return "已复制脱敏上下文";
  });
  handleTrusted("profile:preview", (_event, value: unknown) => {
    const request = parseProfileRequest(value);
    return previewProfileImport(settingsForRenderer(config), request.text, request.mode);
  });
  handleTrusted("profile:apply", async (_event, value: unknown) => {
    const request = parseProfileRequest(value);
    const preview = previewProfileImport(settingsForRenderer(config), request.text, request.mode);
    if (!preview.valid || !preview.nextSettings)
      throw new Error("配置包校验失败，请先修正预览中的问题");
    if (!preview.hasChanges) throw new Error("配置包与当前设置没有差异，无需导入");
    const backupCreated = await settingsStore.createImportBackup();
    const saved = await saveSettings(preview.nextSettings);
    return { settings: saved, preview: { ...preview, nextSettings: undefined }, backupCreated };
  });
  handleTrusted("profile:copyPrompt", () => {
    clipboard.writeText(profilePrompt());
    return "已复制配置包提示词";
  });
  handleTrusted("profile:copyExport", () => {
    clipboard.writeText(exportProfile(settingsForRenderer(config)));
    return "已复制当前配置包";
  });
  handleTrusted("profile:hasBackup", () => settingsStore.hasImportBackup());
  handleTrusted("profile:restoreBackup", async () => {
    const backup = await settingsStore.readImportBackup();
    return saveSettings(toUserSettings(backup));
  });
  handleTrusted("window:toggleClickThrough", (_event, enabled: unknown) =>
    toggleClickThrough(Boolean(enabled))
  );
}

function parseProfileRequest(value: unknown): { text: string; mode: ProfileImportMode } {
  return parseProfileRequestInput(value);
}

function sanitizedContextForEvent(value: unknown): string {
  const eventId = typeof value === "string" ? value.trim() : "";
  if (!eventId || eventId.length > 200) throw new Error("无效的事件标识");
  const item = latestNews.find((news) => news.eventId === eventId || news.id === eventId);
  if (!item) throw new Error("事件已更新，请刷新后重试");

  const holdingCodes = new Set(config.holdings.map((holding) => holding.securityCode));
  const watchlistCodes = new Set(config.watchlist.map((entry) => entry.securityCode));
  const initialCue = buildDecisionCue({
    item,
    analysis: item.analysis,
    holdingCodes,
    watchlistCodes,
    quoteChangePercent: null,
    benchmarkChangePercent: null,
    recentRuleTriggered: false
  });
  const relatedCode = initialCue.relatedCode;
  const quote = relatedCode ? latestQuotes.find((entry) => entry.code === relatedCode) : undefined;
  const benchmarkCode = benchmarkCodeForSecurity(relatedCode ?? "600000");
  const benchmark = latestMarket.indices.find((entry) => entry.instrument.code === benchmarkCode);
  const recentAlerts = latestRisk.recentEvents.filter(
    (event) =>
      event.securityCode === relatedCode &&
      Date.now() - Date.parse(event.triggeredAt) <= 30 * 60_000
  );
  const cue = buildDecisionCue({
    item,
    analysis: item.analysis,
    holdingCodes,
    watchlistCodes,
    quoteChangePercent: quote?.changePercent ?? null,
    benchmarkChangePercent: benchmark?.changePercent ?? null,
    recentRuleTriggered: recentAlerts.length > 0
  });
  const tracking =
    relatedCode && holdingCodes.has(relatedCode)
      ? "holding"
      : relatedCode && watchlistCodes.has(relatedCode)
        ? "watchlist"
        : "market";
  const securityName = relatedCode
    ? (config.securities.find((security) => security.code === relatedCode)?.name ??
      quote?.name ??
      null)
    : null;

  return buildSanitizedEventContext({
    item,
    tracking,
    securityName,
    quote: quote
      ? {
          code: quote.code,
          price: quote.price,
          changePercent: quote.changePercent,
          updatedAt: quote.updatedAt,
          source: quote.source
        }
      : undefined,
    benchmark: benchmark
      ? {
          name: benchmark.instrument.name,
          changePercent: benchmark.changePercent,
          updatedAt: benchmark.updatedAt
        }
      : undefined,
    cue,
    alerts: recentAlerts.map((event) => ({
      type: event.type,
      title: event.title,
      triggeredAt: event.triggeredAt,
      mode: event.mode
    }))
  });
}

function resolveMarketInstrument(value: unknown): MarketInstrument {
  return resolveMarketInstrumentInput(value, config.securities);
}
async function setActiveTab(tabId: string): Promise<UserSettings> {
  const tab = config.tabs.find((item) => item.id === tabId && item.visible);
  if (!tab) return settingsForRenderer(config);

  const next = toUserSettings(config);
  next.navigation.lastActiveTabId = tab.id;
  return saveSettings(next, false);
}
async function saveSettings(
  value: unknown,
  refreshData = true,
  captureCurrentBounds = true
): Promise<UserSettings> {
  settingsSaveInProgress = true;
  try {
    const previous = config;
    const candidate = structuredClone(value);
    if (
      captureCurrentBounds &&
      candidate &&
      typeof candidate === "object" &&
      "window" in candidate &&
      mainWindow &&
      !mainWindow.isDestroyed() &&
      !mainWindow.isMaximized() &&
      !mainWindow.isFullScreen() &&
      !mainWindow.isMinimized()
    ) {
      const incoming = candidate as UserSettings;
      incoming.window = { ...incoming.window, ...mainWindow.getBounds() };
    }

    const saved = await settingsStore.save(candidate);
    try {
      applyBossKeyRegistration(saved.window);
    } catch (error) {
      await settingsStore.save(toUserSettings(previous));
      throw error;
    }

    latestErrors = latestErrors.filter((error) => !error.startsWith("shortcut:"));
    config = preserveRuntimeSecrets(saved, previous);
    setAiReadyStatus();
    applyWindowPreferences();
    updateTrayMenu();
    pushSnapshot();
    pushSettings();
    if (refreshData) {
      triggerRefresh("quotes", refreshQuotesNow);
      triggerRefresh("market", refreshMarketNow);
      triggerRefresh("news", refreshNewsNow);
    }
    return settingsForRenderer(config);
  } finally {
    settingsSaveInProgress = false;
  }
}
async function toggleTheme(): Promise<UserSettings> {
  const next = toUserSettings(config);
  next.appearance.theme = next.appearance.theme === "stealth" ? "standard" : "stealth";
  return saveSettings(next);
}

async function toggleClickThrough(enabled: boolean): Promise<UserSettings> {
  return updateWindowSettings({ clickThrough: Boolean(enabled) });
}

async function updateWindowSettings(patch: Partial<WindowSettings>): Promise<UserSettings> {
  const next = toUserSettings(config);
  next.window = { ...next.window, ...patch };
  return saveSettings(next, false);
}

function hideMainWindow(): void {
  mainWindow?.hide();
}

function toggleQuickView(): void {
  if (!quickWindow || quickWindow.isDestroyed()) quickWindow = createQuickWindow();
  if (quickWindow.isVisible()) {
    quickWindow.hide();
    return;
  }
  const trayBounds = tray?.getBounds();
  if (!trayBounds) return;
  const display = screen.getDisplayNearestPoint({
    x: trayBounds.x + Math.round(trayBounds.width / 2),
    y: trayBounds.y + Math.round(trayBounds.height / 2)
  });
  quickWindow.setBounds(
    quickWindowBounds(trayBounds, display.workArea, {
      width: 320,
      height: 380
    }),
    false
  );
  quickWindow.show();
  quickWindow.focus();
  runQuoteRefresh();
  runFastIndexRefresh();
}

function toggleWindow(fromBossKey: boolean): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow();
    revealMainWindow();
    return;
  }

  const settingsVisible = Boolean(
    settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible()
  );
  if (mainWindow.isVisible() || (fromBossKey && settingsVisible)) {
    mainWindow.hide();
    if (fromBossKey) {
      settingsWindow?.hide();
      restoreConfiguredAlwaysOnTop();
    }
    return;
  }
  revealMainWindow();
}

function revealMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow();
  }
  recoverNormalWindowState(mainWindow);
  if (!settingsWindow?.isVisible()) restoreConfiguredAlwaysOnTop();
  mainWindow.show();
  mainWindow.moveTop();
  if (!clickThrough) mainWindow.focus();
  runQuoteRefresh();
  runFastIndexRefresh();
}

function recoverNormalWindowState(window: BrowserWindow): void {
  const wasTransient = window.isFullScreen() || window.isMaximized() || window.isMinimized();
  if (window.isFullScreen()) window.setFullScreen(false);
  if (window.isMaximized()) window.unmaximize();
  if (window.isMinimized()) window.restore();
  if (!wasTransient) return;

  const primaryWorkArea = screen.getPrimaryDisplay().workArea;
  const bounds = ensureVisibleWindowBounds(
    config.window,
    screen.getAllDisplays().map((display) => display.workArea),
    primaryWorkArea
  );
  window.setBounds(bounds, false);
}

async function resetMainWindowBounds(): Promise<void> {
  const next = toUserSettings(config);
  next.window = {
    ...next.window,
    width: 380,
    height: 520,
    x: null,
    y: null
  };
  await saveSettings(next, false, false);
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  if (mainWindow.isMinimized()) mainWindow.restore();
  const workArea = screen.getPrimaryDisplay().workArea;
  mainWindow.setBounds(ensureVisibleWindowBounds(next.window, [workArea], workArea), false);
  mainWindow.show();
  mainWindow.moveTop();
}
/**
 * 触发一次后台刷新。
 *
 * 这些刷新在 `try` 之外还有会抛错的尾部工作（例如 refreshQuotes 末尾的 refreshRisk →
 * 系统通知/托盘，refreshNews 末尾的 pushSnapshot），`.finally()` 会把 rejection 重新抛进
 * 已被丢弃的派生 Promise，于是主进程收到 unhandledRejection 且原始原因丢失。
 * 统一在这里捕获并记入可见告警。
 */
function triggerRefresh(scope: string, task: (() => Promise<void>) | null | undefined): void {
  if (!task) return;
  void task().catch((error) => reportInternalFailure(scope, error));
}

function reportInternalFailure(scope: string, error: unknown): void {
  latestErrors = upsertError(latestErrors, `internal:${scope} 刷新异常：${errorMessage(error)}`);
}

if (hasSingleInstanceLock)
  void app.whenReady().then(async () => {
    if (process.platform === "win32") app.setAppUserModelId("dev.polaris.floatingStockWidget");
    // 应用不需要任何 Web 权限（摄像头/麦克风/定位/通知/剪贴板读取等）：一律拒绝。
    // 不设这两个 handler 时 Electron 的默认行为取决于页面与 Chromium 版本（审计报告 §8 Info-8）。
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false)
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    loadEnvironmentFiles();
    devServerUrl = resolveDevServerUrl(app.isPackaged, process.env.VITE_DEV_SERVER_URL);
    const defaults = readDefaultConfig();
    settingsStore = new SettingsStore(
      path.join(app.getPath("userData"), "settings.json"),
      defaults,
      process.env,
      findPersonalSeedPath()
    );
    config = await settingsStore.load();
    const settingsRecoveryMessage = settingsStore.consumeRecoveryMessage();
    if (settingsRecoveryMessage)
      latestErrors = upsertError(latestErrors, `settings:${settingsRecoveryMessage}`);
    if (isInsecureStorageBackend(process.platform, selectedStorageBackend())) {
      latestErrors = upsertError(
        latestErrors,
        "secure-storage:系统安全存储回落到 basic_text（等价明文），建议改用环境变量提供 API Key"
      );
    }
    aiCredentialStore = new EncryptedApiKeyStore(
      path.join(app.getPath("userData"), "ai-credential.json"),
      {
        isAvailable: () => safeStorage.isEncryptionAvailable(),
        encryptString: (value) => safeStorage.encryptString(value),
        decryptString: (value) => safeStorage.decryptString(value)
      }
    );
    await initializeAiCredentials();
    clickThrough = config.window.clickThrough;
    if (!config.navigation.rememberLastTab) {
      config.navigation.lastActiveTabId = config.navigation.defaultTabId;
    }
    newsAnalyzer = new CachedNewsAnalyzer(
      maybeAnalyzeBatch,
      new JsonNewsAnalysisCache(path.join(app.getPath("userData"), "ai-analysis-cache.json")),
      5
    );
    alertStateStore = new JsonAlertStateStore(
      path.join(app.getPath("userData"), "alert-state.json")
    );
    alertEngine = new AlertEngine(await alertStateStore.read());
    latestRisk = {
      ...emptyRiskSnapshot(config.risk.mode),
      paused: alertEngine.isPaused(),
      pausedThroughDate: alertEngine.exportState().pausedThroughDate,
      recentEvents: alertEngine.recentEvents()
    };
    marketDataCoordinator = new MarketDataCoordinator(
      undefined,
      new JsonMarketCache(path.join(app.getPath("userData"), "market-cache.json"))
    );
    const newsStoreResult = openRecoveringNewsEventStore(
      path.join(app.getPath("userData"), "news-events.sqlite")
    );
    newsEventStore = newsStoreResult.store;
    if (newsStoreResult.recovered) {
      latestErrors = upsertError(latestErrors, "news:本地新闻数据库损坏，已隔离并重建");
    }
    newsDataCoordinator = new NewsDataCoordinator(newsEventStore);

    localWorkWeb = new LocalWorkWebServer({
      assetRoot: WORK_WEB_ROOT,
      snapshot: () => buildPublicSnapshot(snapshot()),
      trend: async (code) => {
        const visible = config.watchlist.some((item) => item.visible && item.securityCode === code);
        const security = config.securities.find((item) => item.code === code);
        if (!visible || !security) return null;
        const now = new Date();
        const detail = await marketDataCoordinator.fetchDetail(
          resolveMarketInstrument({ kind: "stock", market: security.market, code }),
          config.providers.quote,
          {
            marketOpen: isAShareTradingSession(now),
            nowMs: now.getTime(),
            maxSourceAgeMs: Math.max(config.pollIntervals.quotesMs * 10, 180_000)
          }
        );
        return buildPublicTrend(detail);
      },
      token: !app.isPackaged ? process.env.MOYU_WEB_PREVIEW_TOKEN : undefined,
      onVisibleClientsChange: (count) => {
        const becameVisible = localWorkWebVisibleClients === 0 && count > 0;
        localWorkWebVisibleClients = count;
        if (becameVisible) {
          triggerRefresh("quotes", refreshQuotesNow);
          triggerRefresh("indices", refreshFastIndicesNow);
        }
      }
    });
    await localWorkWeb.start(
      !app.isPackaged ? parseLocalPreviewPort(process.env.MOYU_WEB_PREVIEW_PORT) : 0
    );

    registerIpc();
    mainWindow = createWindow();
    createTray();
    quickWindow = createQuickWindow();
    if (
      !app.isPackaged &&
      (process.env.MOYU_EXCEL_PREVIEW === "1" || process.argv.includes("--excel-preview"))
    ) {
      openExcelWorkspace();
    }
    registerGlobalShortcuts();
    powerMonitor.on("resume", refreshAfterConnectivityChange);

    refreshQuotesNow = createSingleFlight(refreshQuotes);
    refreshFastIndicesNow = createSingleFlight(refreshFastIndices);
    refreshMarketNow = createSingleFlight(refreshMarket);
    refreshNewsNow = createSingleFlight(refreshNews);
    runQuoteRefresh();
    runFastIndexRefresh();
    void runMarketRefresh();
    triggerRefresh("news", refreshNewsNow);
    newsPollTimer = setInterval(
      () => triggerRefresh("news", refreshNewsNow),
      config.pollIntervals.newsMs
    );
    if (!app.isPackaged && process.argv.includes("--web-preview")) void openLocalWorkWeb();
  });

app.on("before-quit", (event) => {
  if (shutdownReady) {
    isQuitting = true;
    return;
  }
  event.preventDefault();
  if (shutdownInProgress) return;
  shutdownInProgress = true;
  isQuitting = true;
  if (boundsSaveTimer) clearTimeout(boundsSaveTimer);
  if (quotePollTimer) clearTimeout(quotePollTimer);
  if (fastIndexPollTimer) clearTimeout(fastIndexPollTimer);
  if (marketPollTimer) clearTimeout(marketPollTimer);
  if (newsPollTimer) clearInterval(newsPollTimer);
  void (async () => {
    try {
      if (alertEngine && alertStateStore) await persistAlertState();
    } catch (error) {
      console.error("Failed to persist shutdown state", error);
    }
    try {
      await localWorkWeb?.close();
      localWorkWeb = null;
    } catch (error) {
      console.error("Failed to close local work web", error);
    }
    try {
      // 关闭新闻库：内部会先 checkpoint WAL 再关闭，避免 -wal 长期不回收。
      newsEventStore?.close();
    } catch (error) {
      console.error("Failed to close news store", error);
    }
    shutdownReady = true;
    app.quit();
  })();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  tray?.destroy();
  tray = null;
});

app.on("second-instance", () => {
  if (app.isReady() && settingsStore) revealMainWindow();
});

app.on("activate", () => {
  if (settingsStore) revealMainWindow();
});
