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
  shell,
  Tray,
  type IpcMainInvokeEvent
} from "electron";
import { parse as parseDotEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CachedNewsAnalyzer,
  JsonNewsAnalysisCache
} from "../src/ai/batch.js";
import { EncryptedApiKeyStore } from "../src/ai/credentials.js";
import {
  analyzeNewsBatch,
  safeAiError,
  testAiConnection as testAiProviderConnection
} from "../src/ai/openaiCompatible.js";
import {
  activeSecurityCodes,
  loadAppConfigFromObject,
  preserveRuntimeSecrets,
  toUserSettings,
  type AiSettings,
  type AppConfig,
  type UserSettings,
  type WindowSettings
} from "../src/config.js";
import { analyzeNewsWithRules } from "../src/domain/analysis.js";
import { benchmarkCodeForSecurity, buildDecisionCue } from "../src/domain/decision.js";
import { buildSanitizedEventContext } from "../src/domain/handoff.js";
import {
  DEFAULT_MARKET_INDICES,
  emptyMarketOverview,
  instrumentKey
} from "../src/domain/market.js";
import { aggregateNewsSource } from "../src/domain/news.js";
import { buildTrayPresentation, type TrayVisualState } from "../src/domain/trayStatus.js";
import {
  buildAlertCandidates,
  calculateRiskSnapshot,
  emptyRiskSnapshot
} from "../src/domain/risk.js";
import { ensureVisibleWindowBounds } from "../src/domain/windowBounds.js";
import { quickWindowBounds } from "../src/domain/quickWindowBounds.js";
import {
  isSecureApiBaseUrl,
  isTrustedRendererUrl,
  resolveDevServerUrl
} from "../src/domain/runtimeSecurity.js";
import {
  getAShareMarketState,
  isAShareTradingSession
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
import {
  openRecoveringNewsEventStore,
  SqliteNewsEventStore
} from "../src/services/newsEvents.js";
import { QuoteCoordinator } from "../src/services/quotes.js";
import { createSingleFlight } from "../src/services/singleFlight.js";
import { LocalWorkWebServer } from "../src/services/localWeb.js";
import { buildPublicSnapshot, buildPublicTrend } from "../src/presentation/publicSnapshot.js";
import { SettingsStore, settingsForRenderer } from "../src/settings/store.js";
import { DEFAULT_BOSS_KEY_ACCELERATOR } from "../src/shortcut.js";
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
]
  .map((entry) => pathToFileURL(entry).toString());
const ALLOWED_ENV_KEYS = ["AI_API_KEY", "AI_API_BASE_URL", "AI_MODEL"] as const;
const APP_ICON_PATH = path.join(__dirname, "../../resources/icons/app-256.png");
const TRAY_ICON_PATH = path.join(__dirname, "../../resources/icons/tray.png");
const MAC_TRAY_TEMPLATE_ICON_PATH = path.join(
  __dirname,
  "../../resources/icons/trayTemplate.png"
);

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
let secureStorageAvailable: boolean | null = null;
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

app.setName("摸鱼看盘");
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function setWindowAlwaysOnTop(window: BrowserWindow, enabled: boolean): void {
  if (enabled) {
    window.setAlwaysOnTop(true, process.platform === "darwin" ? "floating" : "screen-saver");
  } else {
    window.setAlwaysOnTop(false);
  }
}

function syncMacDockVisibility(): void {
  if (process.platform !== "darwin" || !app.dock) return;
  if (config.window.trayOnly) {
    app.dock.hide();
  } else {
    void app.dock.show();
  }
}

async function migrateConflictingMacDefaultShortcut(): Promise<void> {
  if (process.platform !== "darwin" ||
      config.window.bossKeyAccelerator !== "CommandOrControl+Alt+Space") return;
  const next = toUserSettings(config);
  next.window.bossKeyAccelerator = DEFAULT_BOSS_KEY_ACCELERATOR;
  config = await settingsStore.save(next);
}

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
    hasShadow: true,
    roundedCorners: true,
    hiddenInMissionControl: process.platform === "darwin" && config.window.trayOnly,
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

  setWindowAlwaysOnTop(window, config.window.alwaysOnTop);
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
    restoreConfiguredAlwaysOnTop();
    syncMacDockVisibility();
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
    hiddenInMissionControl: process.platform === "darwin",
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
  setWindowAlwaysOnTop(window, true);
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
  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const bounds = ensureVisibleWindowBounds(
    { width: 1180, height: 760, x: null, y: null },
    [workArea],
    workArea
  );
  const window = new BrowserWindow({
    ...bounds,
    minWidth: Math.min(900, bounds.width),
    minHeight: Math.min(560, bounds.height),
    show: false,
    ...(process.platform === "darwin"
      ? {
          frame: true,
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 13, y: 11 }
        }
      : { frame: false }),
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
  void refreshQuotesNow?.();
  void refreshFastIndices();
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
    syncMacDockVisibility();
    scheduleSecureStorageAvailabilityCheck();
    return;
  }

  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const bounds = ensureVisibleWindowBounds(
    { width: 660, height: 780, x: null, y: null },
    [workArea],
    workArea
  );
  const window = new BrowserWindow({
    ...bounds,
    minWidth: Math.min(560, bounds.width),
    minHeight: Math.min(620, bounds.height),
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
    syncMacDockVisibility();
  });
  window.on("hide", () => {
    restoreConfiguredAlwaysOnTop();
    syncMacDockVisibility();
  });
  window.on("show", syncMacDockVisibility);
  scheduleSecureStorageAvailabilityCheck();
}

function scheduleSecureStorageAvailabilityCheck(): void {
  if (secureStorageAvailable != null) return;
  setTimeout(() => {
    if (secureStorageAvailable != null || !aiCredentialStore) return;
    try {
      secureStorageAvailable = aiCredentialStore.isAvailable();
    } catch {
      secureStorageAvailable = false;
    }
    setAiReadyStatus();
    pushAiStatus();
  }, 0);
}
function createTray(): void {
  if (tray) return;
  const icon = process.platform === "darwin"
    ? nativeImage.createFromPath(MAC_TRAY_TEMPLATE_ICON_PATH)
    : nativeImage.createFromPath(TRAY_ICON_PATH).resize({
        width: 16,
        height: 16,
        quality: "best"
      });
  if (icon.isEmpty()) throw new Error("Failed to create tray icon");
  if (process.platform === "darwin") icon.setTemplateImage(true);

  tray = new Tray(icon);
  tray.setToolTip("摸鱼看盘");
  tray.on("click", () => toggleQuickView());
  updateTrayMenu();
}

function updateTrayMenu(): void {
  if (!tray || !config) return;
  const bossKeyLabel = showHideShortcut ||
    (config.window.bossKeyEnabled ? "注册失败" : "未启用");
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
  if (process.platform === "darwin") {
    const template = nativeImage.createFromPath(MAC_TRAY_TEMPLATE_ICON_PATH);
    if (template.isEmpty()) throw new Error("Failed to create macOS tray template icon");
    template.setTemplateImage(true);
    return template;
  }
  const colors: Record<TrayVisualState, string> = {
    neutral: "#64748b",
    up: "#c2413b",
    down: "#2f855a",
    attention: "#d38b16",
    degraded: "#7c3aed"
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="3" fill="${colors[state]}"/><path d="M4 10.5h2V7H4zm3 0h2V4.5H7zm3 0h2V6h-2z" fill="white" opacity=".92"/></svg>`;
  const dynamic = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
  ).resize({ width: 16, height: 16, quality: "best" });
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
function registerFirstAvailableShortcut(
  candidates: string[],
  handler: () => void
): string {
  for (const shortcut of candidates) {
    if (globalShortcut.register(shortcut, handler)) return shortcut;
  }
  latestErrors = upsertError(latestErrors, `shortcut:${candidates.join(" / ")} 注册失败`);
  return "";
}

function scheduleWindowBoundsSave(window: BrowserWindow): void {
  if (config.window.locked || window.isDestroyed() ||
      window.isMaximized() || window.isFullScreen() || window.isMinimized()) return;
  if (boundsSaveTimer) clearTimeout(boundsSaveTimer);
  boundsSaveTimer = setTimeout(() => {
    boundsSaveTimer = null;
    void persistWindowBounds(window);
  }, 350);
}

async function persistWindowBounds(window: BrowserWindow): Promise<void> {
  if (isQuitting || config.window.locked || window.isDestroyed() ||
      window.isMaximized() || window.isFullScreen() || window.isMinimized()) return;
  if (settingsSaveInProgress) {
    scheduleWindowBoundsSave(window);
    return;
  }
  const bounds = window.getBounds();
  if (config.window.x === bounds.x && config.window.y === bounds.y &&
      config.window.width === bounds.width && config.window.height === bounds.height) {
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
  setWindowAlwaysOnTop(mainWindow, config.window.alwaysOnTop);
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
    if (process.platform === "darwin") {
      mainWindow.setHiddenInMissionControl(config.window.trayOnly);
    }
  }
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.setSkipTaskbar(config.window.trayOnly);
  }
  syncMacDockVisibility();
}
function loadEnvironmentFiles(): void {
  const candidates = [
    path.join(app.getPath("userData"), ".env"),
    path.join(path.dirname(app.getPath("exe")), ".env"),
    ...(!app.isPackaged ? [path.join(process.cwd(), ".env")] : [])
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

function readDefaultConfig(): Record<string, unknown> {
  const candidates = [
    path.join(__dirname, "../../config/defaults.json"),
    path.join(process.resourcesPath ?? "", "config/defaults.json")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return JSON.parse(fs.readFileSync(candidate, "utf8"));
  }
  return {};
}

function findPersonalSeedPath(): string | undefined {
  const candidates = [
    path.join(app.getPath("userData"), "personal.local.json"),
    path.join(path.dirname(app.getPath("exe")), "personal.local.json"),
    ...(!app.isPackaged
      ? [path.join(process.cwd(), "config", "personal.local.json")]
      : [])
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
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown
): void {
  ipcMain.handle(channel, (event, ...args) => {
    const senderUrl = event.senderFrame?.url ?? event.sender.getURL();
    if (!isTrustedRendererUrl(senderUrl, LOCAL_RENDERER_URLS, devServerUrl)) {
      throw new Error("拒绝来自非受信页面的请求");
    }
    return listener(event, ...args);
  });
}
function quoteSurfaceIsForeground(): boolean {
  return Boolean(
    mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ||
    quickWindow && !quickWindow.isDestroyed() && quickWindow.isVisible() ||
    excelWindow && !excelWindow.isDestroyed() && excelWindow.isVisible() ||
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
  void refreshQuotesNow().finally(() => scheduleQuoteRefresh(startedAtMs));
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
  void refreshFastIndicesNow().finally(() => scheduleFastIndexRefresh(startedAtMs));
}

function scheduleMarketRefresh(): void {
  if (isQuitting) return;
  if (marketPollTimer) clearTimeout(marketPollTimer);
  const activeInterval = Math.max(config.pollIntervals.quotesMs * 3, 15_000);
  const target = isAShareTradingSession(new Date()) ? activeInterval : 60_000;
  const delay = startToStartDelayMs(target, 0);
  marketPollTimer = setTimeout(async () => {
    try {
      await refreshMarketNow?.();
    } finally {
      scheduleMarketRefresh();
    }
  }, delay);
}

function refreshAfterConnectivityChange(): void {
  runQuoteRefresh();
  runFastIndexRefresh();
  void refreshMarketNow?.();
  void refreshNewsNow?.();
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
  await refreshRisk(evaluationTime);
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
      updatedAt: newestQuoteTimestamp(result.items.map((item) => ({
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
      }))) ?? latestMarket.updatedAt,
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
  const evaluation = alertEngine.evaluate(
    buildAlertCandidates(config, calculated),
    {
      now,
      mode: config.risk.mode,
      cooldownMinutes: config.risk.cooldownMinutes,
      oncePerDay: config.risk.oncePerDay,
      onlyDuringTrading: config.risk.onlyDuringTrading,
      tradingSession: isAShareTradingSession(now)
    }
  );
  latestRisk = {
    ...calculated,
    paused: evaluation.paused,
    pausedThroughDate: alertEngine.exportState().pausedThroughDate,
    recentEvents: alertEngine.recentEvents()
  };
  if (evaluation.events.length > 0) deliverAlertEvents(evaluation.events);
  if (evaluation.stateChanged &&
      (evaluation.events.length > 0 || now.getTime() - lastAlertStateSaveAt >= 30_000)) {
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

function deliverAlertEvents(events: AppSnapshot["risk"]["recentEvents"]): void {
  if (config.risk.mode !== "active") return;
  const newest = events.at(-1);
  if (!newest) return;
  if (config.risk.notifications.windows && Notification.isSupported()) {
    for (const event of events) {
      new Notification({ title: event.title, body: event.message, silent: true }).show();
    }
  }
  if (config.risk.notifications.tray) {
    tray?.setToolTip(`提醒：${newest.title}`);
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
    const pending = config.ai.enabled && config.ai.apiKey
      ? candidates.filter((item) =>
          !item.analysis && newsEventStore.analysisDue(item.eventId ?? item.id, now, analysisNamespace)
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
      pending.slice(0, 5), candidates, analysisNamespace, candidateLimit, generation
    );
  } catch {
    newsLastAttemptFailed = true;
    const sourceHealthMessage = summarizeNewsSourceHealth(newsSourceStates());
    latestErrors = upsertError(
      latestErrors,
      `news:${sourceHealthMessage ?? "资讯更新暂时失败，稍后自动重试"}`
    );
  }
  pushSnapshot();
}

function presentNews(items: AppSnapshot["news"], limit: number): AppSnapshot["news"] {
  return (config.news.mode === "important"
    ? items.filter((item) => item.analysis?.useful === true && item.analysis.priority !== "low")
    : items
  ).slice(0, limit);
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
      analysis: item.analysis ?? analyzedById.get(item.id) ??
        analyzeNewsWithRules(item, "AI 分析排队中")
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
  return ["eastmoney", "media-fallback", "cninfo", "csrc"]
    .map((source) => newsEventStore.sourceState(source));
}

function selectRelevantNews<T extends NewsItem>(items: T[]): T[] {
  const activeCodes = new Set(activeSecurityCodes(config));
  const securities = config.securities.filter((security) => activeCodes.has(security.code));
  const quoteNames = new Map(
    latestQuotes
      .filter((quote) => activeCodes.has(quote.code) && quote.name)
      .map((quote) => [quote.code, quote.name])
  );
  const annotated = items.map((item): T => {
    const text = `${item.title} ${item.summary ?? ""}`;
    const relatedCodes = new Set(
      (item.relatedCodes ?? []).filter((code) => activeCodes.has(code))
    );
    for (const security of securities) {
      const keywords = [
        security.code,
        security.name,
        security.alias,
        quoteNames.get(security.code) ?? ""
      ].filter((keyword) => keyword.length >= 2);
      if (keywords.some((keyword) => text.includes(keyword))) {
        relatedCodes.add(security.code);
      }
    }
    return {
      ...item,
      relatedCodes: [...relatedCodes]
    } as T;
  });

  if (config.news.mode !== "watchlist_related") return annotated;
  return annotated.filter((item) => (item.relatedCodes?.length ?? 0) > 0);
}
function aiAnalysisNamespace(): string {
  if (!config.ai.enabled || !config.ai.apiKey) return "rules-v2";
  return [
    "ai-v4",
    config.ai.provider,
    config.ai.baseUrl,
    config.ai.model
  ].join(":");
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
    secureStorageAvailable: secureStorageAvailable ?? false,
    credentialSource: aiCredentialSource,
    state: configured ? "ready" : "unconfigured",
    provider: config.ai.provider,
    model: config.ai.model,
    message: message ?? (
      configured
        ? config.ai.enabled
          ? `已配置 ${config.ai.model}`
          : "已配置但未启用"
        : "未配置 API Key，使用本地规则"
    )
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
    if (secureKey) secureStorageAvailable = true;
  } catch (error) {
    secureStorageAvailable = false;
    credentialError = safeAiError(error);
  }

  config.ai.apiKey = secureKey || environmentKey;
  aiCredentialSource = secureKey
    ? "secure"
    : environmentKey
      ? "environment"
      : "none";
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
  secureStorageAvailable = true;
  config.ai.apiKey = value.trim();
  aiCredentialSource = "secure";
  setAiReadyStatus("API Key 已通过系统安全存储加密保存");
  pushAiStatus();
  void refreshNewsNow?.();
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
  void refreshNewsNow?.();
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
  if (!value || typeof value !== "object") throw new Error("AI 测试参数无效");
  const request = value as { ai?: Partial<AiSettings>; apiKey?: unknown };
  const incoming = request.ai;
  if (!incoming || (incoming.provider !== "deepseek" && incoming.provider !== "custom")) {
    throw new Error("AI 服务类型无效");
  }
  const baseUrl = typeof incoming.baseUrl === "string" ? incoming.baseUrl.trim() : "";
  const model = typeof incoming.model === "string" ? incoming.model.trim() : "";
  const timeoutSeconds = Number(incoming.timeoutSeconds);
  try {
    if (!isSecureApiBaseUrl(baseUrl)) throw new Error();
  } catch {
    throw new Error("AI API 地址无效");
  }
  if (!model || model.length > 100) throw new Error("AI 模型名称无效");
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 5 || timeoutSeconds > 120) {
    throw new Error("AI 请求超时必须为 5–120 秒");
  }
  const transientKey = typeof request.apiKey === "string" ? request.apiKey.trim() : "";
  return {
    enabled: incoming.enabled !== false,
    provider: incoming.provider,
    baseUrl: baseUrl.replace(/\/$/, ""),
    model,
    timeoutSeconds: Math.round(timeoutSeconds),
    apiKey: transientKey || config.ai.apiKey
  };
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
  handleTrusted("settings:save", async (_event, value: unknown) => saveSettings(value));
  handleTrusted("navigation:setActiveTab", async (_event, tabId: string) =>
    setActiveTab(tabId)
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
  handleTrusted("appearance:setBackgroundOpacity", async (_event, opacity: number) => {
    const next = toUserSettings(config);
    next.appearance.backgroundOpacity = opacity;
    return saveSettings(next);
  });
  handleTrusted("appearance:toggleTheme", () => toggleTheme());
  handleTrusted("link:open", async (_event, url: string) => {
    if (/^https?:\/\//.test(url)) await shell.openExternal(url);
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
    if (!preview.valid || !preview.nextSettings) throw new Error("配置包校验失败，请先修正预览中的问题");
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
  handleTrusted("window:toggleClickThrough", (_event, enabled: boolean) =>
    toggleClickThrough(enabled)
  );
}

function parseProfileRequest(value: unknown): { text: string; mode: ProfileImportMode } {
  if (!value || typeof value !== "object") throw new Error("无效的配置包请求");
  const request = value as Record<string, unknown>;
  const text = typeof request.text === "string" ? request.text : "";
  if (text.length > 2_000_000) throw new Error("配置包不能超过 2MB");
  return { text, mode: request.mode === "replace" ? "replace" : "merge" };
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
  const recentAlerts = latestRisk.recentEvents.filter((event) =>
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
  const tracking = relatedCode && holdingCodes.has(relatedCode)
    ? "holding"
    : relatedCode && watchlistCodes.has(relatedCode)
      ? "watchlist"
      : "market";
  const securityName = relatedCode
    ? config.securities.find((security) => security.code === relatedCode)?.name ??
      quote?.name ?? null
    : null;

  return buildSanitizedEventContext({
    item,
    tracking,
    securityName,
    quote: quote ? {
      code: quote.code,
      price: quote.price,
      changePercent: quote.changePercent,
      updatedAt: quote.updatedAt,
      source: quote.source
    } : undefined,
    benchmark: benchmark ? {
      name: benchmark.instrument.name,
      changePercent: benchmark.changePercent,
      updatedAt: benchmark.updatedAt
    } : undefined,
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
  if (!value || typeof value !== "object") throw new Error("无效的行情标的");
  const request = value as Record<string, unknown>;
  const kind = request.kind === "index" ? "index" : request.kind === "stock" ? "stock" : null;
  const code = typeof request.code === "string" ? request.code.trim() : "";
  const market = request.market === "SH" || request.market === "SZ" || request.market === "BJ"
    ? request.market
    : null;
  if (!kind || !market || !/^\d{6}$/.test(code)) throw new Error("无效的行情标的");

  if (kind === "index") {
    const matched = DEFAULT_MARKET_INDICES.find((item) =>
      item.code === code && item.market === market
    );
    if (!matched) throw new Error("不支持的市场指数");
    return matched;
  }

  const security = config.securities.find((item) => item.code === code && item.market === market);
  if (!security) throw new Error("股票不在当前配置中");
  return {
    key: instrumentKey("stock", market, code),
    kind: "stock",
    code,
    market,
    name: security.alias || security.name || code
  };
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
    if (captureCurrentBounds &&
        candidate && typeof candidate === "object" && "window" in candidate &&
        mainWindow && !mainWindow.isDestroyed() &&
        !mainWindow.isMaximized() && !mainWindow.isFullScreen() && !mainWindow.isMinimized()) {
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
      void refreshQuotesNow?.();
      void refreshMarketNow?.();
      void refreshNewsNow?.();
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
  syncMacDockVisibility();
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
  quickWindow.setBounds(quickWindowBounds(trayBounds, display.workArea, {
    width: 320,
    height: 380
  }), false);
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

  const settingsVisible = Boolean(settingsWindow && !settingsWindow.isDestroyed() &&
    settingsWindow.isVisible());
  if (mainWindow.isVisible() || (fromBossKey && settingsVisible)) {
    mainWindow.hide();
    if (fromBossKey) {
      settingsWindow?.hide();
      restoreConfiguredAlwaysOnTop();
    }
    syncMacDockVisibility();
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
  syncMacDockVisibility();
  runQuoteRefresh();
  runFastIndexRefresh();
}

async function persistWindowBoundsForShutdown(): Promise<void> {
  if (!settingsStore || !config || !mainWindow || mainWindow.isDestroyed() ||
      config.window.locked || mainWindow.isMaximized() ||
      mainWindow.isFullScreen() || mainWindow.isMinimized()) return;
  const bounds = mainWindow.getBounds();
  if (config.window.x === bounds.x && config.window.y === bounds.y &&
      config.window.width === bounds.width && config.window.height === bounds.height) return;
  const next = toUserSettings(config);
  next.window = { ...next.window, ...bounds };
  config = preserveRuntimeSecrets(await settingsStore.save(next), config);
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
function upsertError(errors: string[], next: string): string[] {
  const prefix = next.split(":")[0];
  return [next, ...errors.filter((error) => !error.startsWith(`${prefix}:`))].slice(0, 4);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parsePreviewPort(value: string | undefined): number {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65_535 ? port : 0;
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  if (process.platform === "win32") app.setAppUserModelId("dev.polaris.floatingStockWidget");
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
  await migrateConflictingMacDefaultShortcut();
  const settingsRecoveryMessage = settingsStore.consumeRecoveryMessage();
  if (settingsRecoveryMessage) latestErrors = upsertError(latestErrors, `settings:${settingsRecoveryMessage}`);
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
        void refreshQuotesNow?.();
        void refreshFastIndicesNow?.();
      }
    }
  });
  await localWorkWeb.start(!app.isPackaged ? parsePreviewPort(process.env.MOYU_WEB_PREVIEW_PORT) : 0);

  registerIpc();
  mainWindow = createWindow();
  createTray();
  applyWindowPreferences();
  quickWindow = createQuickWindow();
  if (!app.isPackaged &&
      (process.env.MOYU_EXCEL_PREVIEW === "1" || process.argv.includes("--excel-preview"))) {
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
  void refreshMarketNow().finally(scheduleMarketRefresh);
  void refreshNewsNow();
  newsPollTimer = setInterval(() => void refreshNewsNow?.(), config.pollIntervals.newsMs);
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
      await persistWindowBoundsForShutdown();
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
