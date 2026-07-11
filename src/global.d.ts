import type { AiSettings, UserSettings } from "./config.js";
import type {
  AiRuntimeStatus,
  AppSnapshot,
  MarketDetail,
  MarketInstrumentRequest
} from "./domain/types.js";
import type { ProfileImportMode, ProfilePreview } from "./settings/profile.js";

export interface ProfileApplyResult {
  settings: UserSettings;
  preview: ProfilePreview;
  backupCreated: boolean;
}

export interface FloatingStockApi {
  notifyOnline: () => Promise<void>;
  getSnapshot: () => Promise<AppSnapshot>;
  getMarketDetail: (instrument: MarketInstrumentRequest) => Promise<MarketDetail>;
  pauseAlertsToday: () => Promise<void>;
  resumeAlerts: () => Promise<void>;
  onSnapshot: (callback: (snapshot: AppSnapshot) => void) => () => void;
  getSettings: () => Promise<UserSettings>;
  saveSettings: (settings: UserSettings) => Promise<UserSettings>;
  getAiStatus: () => Promise<AiRuntimeStatus>;
  setAiApiKey: (apiKey: string) => Promise<AiRuntimeStatus>;
  clearAiApiKey: () => Promise<AiRuntimeStatus>;
  testAiConnection: (request: {
    ai: AiSettings;
    apiKey?: string;
  }) => Promise<AiRuntimeStatus>;
  onAiStatus: (callback: (status: AiRuntimeStatus) => void) => () => void;
  onSettings: (callback: (settings: UserSettings) => void) => () => void;
  openSettings: () => Promise<void>;
  hideWindow: () => Promise<void>;
  setActiveTab: (tabId: string) => Promise<UserSettings>;
  setBackgroundOpacity: (opacity: number) => Promise<UserSettings>;
  toggleTheme: () => Promise<UserSettings>;
  openExternal: (url: string) => Promise<void>;
  copyNewsContext: (eventId: string) => Promise<string>;
  previewProfile: (request: { text: string; mode: ProfileImportMode }) => Promise<ProfilePreview>;
  applyProfile: (request: { text: string; mode: ProfileImportMode }) => Promise<ProfileApplyResult>;
  copyProfilePrompt: () => Promise<string>;
  copyProfileExport: () => Promise<string>;
  hasProfileBackup: () => Promise<boolean>;
  restoreProfileBackup: () => Promise<UserSettings>;
  toggleClickThrough: (enabled: boolean) => Promise<void>;
}

declare global {
  interface Window {
    floatingStock?: FloatingStockApi;
  }
}
