import { contextBridge, ipcRenderer } from "electron";
import type { AiSettings, UserSettings } from "../src/config.js";
import type {
  AiRuntimeStatus,
  AppSnapshot,
  MarketDetail,
  MarketInstrumentRequest
} from "../src/domain/types.js";
import type { FloatingStockApi } from "../src/global.js";
import type { ProfileImportMode, ProfilePreview } from "../src/settings/profile.js";

const api: FloatingStockApi = {
  platform: process.platform,
  notifyOnline: () => ipcRenderer.invoke("app:online") as Promise<void>,
  getSnapshot: () => ipcRenderer.invoke("snapshot:get") as Promise<AppSnapshot>,
  getMarketDetail: (instrument: MarketInstrumentRequest) =>
    ipcRenderer.invoke("market:detail", instrument) as Promise<MarketDetail>,
  pauseAlertsToday: () => ipcRenderer.invoke("alerts:pauseToday") as Promise<void>,
  resumeAlerts: () => ipcRenderer.invoke("alerts:resume") as Promise<void>,
  onSnapshot: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot) => callback(snapshot);
    ipcRenderer.on("snapshot:update", listener);
    return () => ipcRenderer.off("snapshot:update", listener);
  },
  getSettings: () => ipcRenderer.invoke("settings:get") as Promise<UserSettings>,
  saveSettings: (settings) =>
    ipcRenderer.invoke("settings:save", settings) as Promise<UserSettings>,
  getAiStatus: () => ipcRenderer.invoke("ai:status") as Promise<AiRuntimeStatus>,
  setAiApiKey: (apiKey) =>
    ipcRenderer.invoke("ai:setApiKey", apiKey) as Promise<AiRuntimeStatus>,
  clearAiApiKey: () => ipcRenderer.invoke("ai:clearApiKey") as Promise<AiRuntimeStatus>,
  testAiConnection: (request: { ai: AiSettings; apiKey?: string }) =>
    ipcRenderer.invoke("ai:testConnection", request) as Promise<AiRuntimeStatus>,
  onAiStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: AiRuntimeStatus) =>
      callback(status);
    ipcRenderer.on("ai:statusUpdate", listener);
    return () => ipcRenderer.off("ai:statusUpdate", listener);
  },
  onSettings: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, settings: UserSettings) =>
      callback(settings);
    ipcRenderer.on("settings:update", listener);
    return () => ipcRenderer.off("settings:update", listener);
  },
  openSettings: () => ipcRenderer.invoke("settings:open") as Promise<void>,
  hideWindow: () => ipcRenderer.invoke("window:hide") as Promise<void>,
  showFullWindow: () => ipcRenderer.invoke("window:showFull") as Promise<void>,
  hideQuickView: () => ipcRenderer.invoke("quick:hide") as Promise<void>,
  openExcelWorkspace: () => ipcRenderer.invoke("excel:open") as Promise<void>,
  controlExcelWindow: (action) => ipcRenderer.invoke("excel:windowAction", action) as Promise<void>,
  setActiveTab: (tabId) =>
    ipcRenderer.invoke("navigation:setActiveTab", tabId) as Promise<UserSettings>,
  setBackgroundOpacity: (opacity) =>
    ipcRenderer.invoke("appearance:setBackgroundOpacity", opacity) as Promise<UserSettings>,
  toggleTheme: () => ipcRenderer.invoke("appearance:toggleTheme") as Promise<UserSettings>,
  openExternal: (url) => ipcRenderer.invoke("link:open", url) as Promise<void>,
  copyNewsContext: (eventId) =>
    ipcRenderer.invoke("news:copyContext", eventId) as Promise<string>,
  previewProfile: (request: { text: string; mode: ProfileImportMode }) =>
    ipcRenderer.invoke("profile:preview", request) as Promise<ProfilePreview>,
  applyProfile: (request: { text: string; mode: ProfileImportMode }) =>
    ipcRenderer.invoke("profile:apply", request) as ReturnType<FloatingStockApi["applyProfile"]>,
  copyProfilePrompt: () => ipcRenderer.invoke("profile:copyPrompt") as Promise<string>,
  copyProfileExport: () => ipcRenderer.invoke("profile:copyExport") as Promise<string>,
  hasProfileBackup: () => ipcRenderer.invoke("profile:hasBackup") as Promise<boolean>,
  restoreProfileBackup: () =>
    ipcRenderer.invoke("profile:restoreBackup") as Promise<UserSettings>,
  toggleClickThrough: (enabled) =>
    ipcRenderer.invoke("window:toggleClickThrough", enabled) as Promise<void>
};

contextBridge.exposeInMainWorld("floatingStock", api);
