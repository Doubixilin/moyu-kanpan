import {
  DEFAULT_BOSS_KEY_ACCELERATOR,
  LEGACY_DEFAULT_BOSS_KEY_ACCELERATORS,
  normalizeBossKeyAccelerator,
  parseBossKeyAccelerator
} from "./shortcut.js";
import { isSecureApiBaseUrl } from "./domain/runtimeSecurity.js";

export const SETTINGS_SCHEMA_VERSION = 8;
const BOSS_KEY_SCHEMA_VERSION = 5;
const WINDOW_BOUNDS_SCHEMA_VERSION = 5;
const MARKET_TAB_SCHEMA_VERSION = 6;

export const QUOTE_FIELDS = [
  "price", "change", "changePercent", "open", "previousClose",
  "high", "low", "volume", "amount", "mainInflow"
] as const;

export const TAB_TYPES = [
  "holdings", "watchlist", "market", "drivers", "combined", "stock-list"
] as const;

export type QuoteField = (typeof QUOTE_FIELDS)[number];
export type QuoteSort = "manual" | "changePercentDesc" | "changePercentAbs";
export type NewsMode = "all" | "watchlist_related" | "important";
export type ThemeMode = "standard" | "stealth";
export type SecurityMarket = "SH" | "SZ" | "BJ";
export type TabType = (typeof TAB_TYPES)[number];

export interface Security {
  code: string;
  market: SecurityMarket;
  name: string;
  alias: string;
}

export type AlertMode = "shadow" | "active";
export type AiProvider = "deepseek" | "custom";

export interface AiSettings {
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  timeoutSeconds: number;
}

export interface HoldingAlertRules {
  enabled: boolean;
  stopLossPrice: number | null;
  watchPrice: number | null;
  priceAbove: number | null;
  priceBelow: number | null;
  risePercent: number | null;
  fallPercent: number | null;
  dailyProfitAmount: number | null;
  dailyLossAmount: number | null;
  totalProfitAmount: number | null;
  totalLossAmount: number | null;
}

export interface RiskGroupSettings {
  id: string;
  name: string;
  profitThreshold: number | null;
  lossThreshold: number | null;
  enabled: boolean;
}

export interface RiskNotificationSettings {
  widget: boolean;
  tray: boolean;
  windows: boolean;
}

export interface RiskSettings {
  mode: AlertMode;
  accountBaseline: number | null;
  oneR: number | null;
  maxPositionValue: number | null;
  maxHoldingCount: number | null;
  maxTotalExposurePercent: number | null;
  portfolioDailyProfitThreshold: number | null;
  portfolioDailyLossThreshold: number | null;
  stopWarningPercent: number;
  hysteresisPercent: number;
  cooldownMinutes: number;
  oncePerDay: boolean;
  onlyDuringTrading: boolean;
  notifications: RiskNotificationSettings;
  groups: RiskGroupSettings[];
}
export interface Holding {
  securityCode: string;
  quantity: number;
  costPrice: number;
  groupId: string;
  note: string;
  alertRules: HoldingAlertRules;
}

export interface WatchlistMembership {
  securityCode: string;
  visible: boolean;
  order: number;
  groupId: string;
}

export interface TabConfig {
  id: string;
  type: TabType;
  title: string;
  builtIn: boolean;
  visible: boolean;
  order: number;
  securityCodes: string[];
  maxItems: number;
  newsMode: NewsMode;
}

export interface NavigationSettings {
  defaultTabId: string;
  rememberLastTab: boolean;
  lastActiveTabId: string;
}

export interface WindowSettings {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
  alwaysOnTop: boolean;
  trayOnly: boolean;
  bossKeyEnabled: boolean;
  bossKeyAccelerator: string;
  clickThrough: boolean;
  locked: boolean;
}

export interface UserSettings {
  schemaVersion: number;
  personalSeedVersion: number;
  securities: Security[];
  holdings: Holding[];
  watchlist: WatchlistMembership[];
  tabs: TabConfig[];
  navigation: NavigationSettings;
  quotes: {
    fields: QuoteField[];
    sort: QuoteSort;
  };
  news: {
    mode: NewsMode;
    maxItems: number;
  };
  appearance: {
    theme: ThemeMode;
    backgroundOpacity: number;
  };
  ai: AiSettings;
  risk: RiskSettings;
  window: WindowSettings;
}

export interface AppConfig extends UserSettings {
  pollIntervals: {
    quotesMs: number;
    newsMs: number;
  };
  providers: {
    quote: "eastmoney" | "tencent";
    news: "eastmoney";
  };
  ai: AiSettings & {
    apiKey: string;
  };
}

export type RawConfig = Record<string, unknown>;

const DEFAULT_CODES = ["000001", "600519", "300750"];

const BUILT_IN_TABS: TabConfig[] = [
  {
    id: "holdings", type: "holdings", title: "持仓", builtIn: true,
    visible: true, order: 0, securityCodes: [], maxItems: 8,
    newsMode: "watchlist_related"
  },
  {
    id: "watchlist", type: "watchlist", title: "自选", builtIn: true,
    visible: true, order: 1, securityCodes: [], maxItems: 20,
    newsMode: "watchlist_related"
  },
  {
    id: "market", type: "market", title: "市场", builtIn: true,
    visible: true, order: 2, securityCodes: [], maxItems: 8,
    newsMode: "all"
  },
  {
    id: "drivers", type: "drivers", title: "AI驱动", builtIn: true,
    visible: true, order: 3, securityCodes: [], maxItems: 5,
    newsMode: "important"
  },
  {
    id: "combined", type: "combined", title: "综合", builtIn: true,
    visible: false, order: 4, securityCodes: [], maxItems: 2,
    newsMode: "important"
  }
];

export function createDefaultTabs(): TabConfig[] {
  return BUILT_IN_TABS.map((tab) => ({ ...tab, securityCodes: [...tab.securityCodes] }));
}

export function loadAppConfigFromObject(
  raw: RawConfig,
  env: Record<string, string | undefined> = process.env
): AppConfig {
  const apiKey = env.AI_API_KEY ?? "";
  const rawPollIntervals = asRecord(raw.pollIntervals);
  const rawProviders = asRecord(raw.providers);
  const rawWindow = asRecord(raw.window);
  const sourceSchemaVersion = clampInteger(asNumber(raw.schemaVersion) ?? 0, 0, 1_000_000);
  const rawQuotes = asRecord(raw.quotes);
  const rawNews = asRecord(raw.news);
  const rawAppearance = asRecord(raw.appearance);
  const rawAi = asRecord(raw.ai);
  const rawNavigation = asRecord(raw.navigation);
  const rawRisk = asRecord(raw.risk);
  const legacyOpacity = asNumber(rawWindow.opacity);
  const aiProvider: AiProvider = rawAi.provider === "custom" ? "custom" : "deepseek";

  const securityMap = normalizeSecurities(raw.securities);
  const legacyWatchlist = legacyWatchlistRows(raw.watchlist);
  for (const row of legacyWatchlist) {
    ensureSecurity(securityMap, row.code, { name: row.name, alias: row.alias });
  }
  for (const item of arrayRecords(raw.holdings)) {
    ensureSecurity(securityMap, readCode(item));
  }
  for (const tab of arrayRecords(raw.tabs)) {
    for (const code of normalizeCodeArray(tab.securityCodes)) ensureSecurity(securityMap, code);
  }
  if (securityMap.size === 0) {
    for (const code of DEFAULT_CODES) ensureSecurity(securityMap, code);
  }

  const securities = [...securityMap.values()];
  const knownCodes = new Set(securities.map((security) => security.code));
  const risk = normalizeRiskSettings(rawRisk);
  const holdings = normalizeHoldings(
    raw.holdings,
    knownCodes,
    new Set(risk.groups.map((group) => group.id))
  );
  const watchlist = normalizeWatchlist(raw.watchlist, knownCodes, securities);
  const tabs = normalizeTabs(raw.tabs, knownCodes, sourceSchemaVersion);
  const navigation = normalizeNavigation(rawNavigation, tabs, holdings.length > 0);
  const windowBounds = migrateWindowBounds(rawWindow, sourceSchemaVersion);

  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    personalSeedVersion: clampInteger(asNumber(raw.personalSeedVersion) ?? 0, 0, 1_000_000),
    securities,
    holdings,
    watchlist,
    tabs,
    navigation,
    quotes: {
      fields: normalizeQuoteFields(rawQuotes.fields),
      sort: asQuoteSort(rawQuotes.sort)
    },
    news: {
      mode: asNewsMode(rawNews.mode),
      maxItems: clampInteger(asNumber(rawNews.maxItems) ?? 5, 1, 30)
    },
    appearance: {
      theme: asTheme(rawAppearance.theme),
      backgroundOpacity: clamp(
        asNumber(rawAppearance.backgroundOpacity) ?? legacyOpacity ?? 0.82,
        0.15,
        0.98
      )
    },
    ai: {
      enabled: rawAi.enabled === true || (rawAi.enabled === undefined && Boolean(apiKey)),
      provider: aiProvider,
      apiKey,
      baseUrl: normalizeAiBaseUrl(
        env.AI_API_BASE_URL ?? rawAi.baseUrl,
        aiProvider
      ),
      model: normalizeAiModel(env.AI_MODEL ?? rawAi.model, aiProvider),
      timeoutSeconds: clampInteger(asNumber(rawAi.timeoutSeconds) ?? 20, 5, 120)
    },
    risk,
    window: {
      ...windowBounds,
      alwaysOnTop: rawWindow.alwaysOnTop !== false,
      trayOnly: rawWindow.trayOnly !== false,
      bossKeyEnabled: rawWindow.bossKeyEnabled !== false,
      bossKeyAccelerator: migrateBossKeyAccelerator(
        rawWindow.bossKeyAccelerator,
        sourceSchemaVersion
      ),
      clickThrough: rawWindow.clickThrough === true,
      locked: rawWindow.locked === true
    },
    pollIntervals: {
      quotesMs: clampInteger(asNumber(rawPollIntervals.quotesMs) ?? 8_000, 5_000, 300_000),
      newsMs: clampInteger(asNumber(rawPollIntervals.newsMs) ?? 60_000, 15_000, 600_000)
    },
    providers: {
      quote: rawProviders.quote === "tencent" ? "tencent" : "eastmoney",
      news: "eastmoney"
    }
  };
}

export function mergeRawConfig(defaults: RawConfig, user: RawConfig): RawConfig {
  return {
    ...defaults,
    ...user,
    pollIntervals: { ...asRecord(defaults.pollIntervals), ...asRecord(user.pollIntervals) },
    providers: { ...asRecord(defaults.providers), ...asRecord(user.providers) },
    window: { ...asRecord(defaults.window), ...asRecord(user.window) },
    navigation: { ...asRecord(defaults.navigation), ...asRecord(user.navigation) },
    quotes: { ...asRecord(defaults.quotes), ...asRecord(user.quotes) },
    news: { ...asRecord(defaults.news), ...asRecord(user.news) },
    appearance: { ...asRecord(defaults.appearance), ...asRecord(user.appearance) },
    ai: { ...asRecord(defaults.ai), ...asRecord(user.ai) },
    risk: {
      ...asRecord(defaults.risk),
      ...asRecord(user.risk),
      notifications: {
        ...asRecord(asRecord(defaults.risk).notifications),
        ...asRecord(asRecord(user.risk).notifications)
      }
    }
  };
}

export function toUserSettings(config: AppConfig): UserSettings {
  return {
    schemaVersion: config.schemaVersion,
    personalSeedVersion: config.personalSeedVersion,
    securities: config.securities.map((item) => ({ ...item })),
    holdings: config.holdings.map((item) => ({ ...item, alertRules: { ...item.alertRules } })),
    watchlist: config.watchlist.map((item) => ({ ...item })),
    tabs: config.tabs.map((tab) => ({ ...tab, securityCodes: [...tab.securityCodes] })),
    navigation: { ...config.navigation },
    quotes: { fields: [...config.quotes.fields], sort: config.quotes.sort },
    news: { ...config.news },
    appearance: { ...config.appearance },
    ai: {
      enabled: config.ai.enabled,
      provider: config.ai.provider,
      baseUrl: config.ai.baseUrl,
      model: config.ai.model,
      timeoutSeconds: config.ai.timeoutSeconds
    },
    risk: {
      ...config.risk,
      notifications: { ...config.risk.notifications },
      groups: config.risk.groups.map((group) => ({ ...group }))
    },
    window: { ...config.window }
  };
}

export function preserveRuntimeSecrets(saved: AppConfig, current: AppConfig): AppConfig {
  return {
    ...saved,
    ai: {
      ...saved.ai,
      apiKey: current.ai.apiKey
    }
  };
}

export function activeSecurityCodes(
  config: Pick<AppConfig, "holdings" | "watchlist" | "tabs">
): string[] {
  const codes = new Set<string>();
  for (const holding of config.holdings) codes.add(holding.securityCode);
  for (const item of config.watchlist) {
    if (item.visible) codes.add(item.securityCode);
  }
  for (const tab of config.tabs) {
    if (!tab.visible) continue;
    for (const code of tab.securityCodes) codes.add(code);
  }
  return [...codes];
}

export const activeWatchlistCodes = activeSecurityCodes;

export function securityForCode(
  settings: Pick<UserSettings, "securities">,
  code: string
): Security | undefined {
  return settings.securities.find((security) => security.code === code);
}

export function displayNameForCode(
  settings: Pick<UserSettings, "securities">,
  code: string,
  fallback = code
): string {
  const security = securityForCode(settings, code);
  return security?.alias || security?.name || fallback;
}

export function inferSecurityMarket(code: string): SecurityMarket {
  if (/^[48]/.test(code)) return "BJ";
  if (/^[569]/.test(code)) return "SH";
  return "SZ";
}

export function assertSavableSettings(value: unknown): asserts value is UserSettings {
  const raw = asRecord(value);
  const securities = arrayRecords(raw.securities);
  if (securities.length === 0) throw new Error("至少保留一只证券");
  if (securities.length > 100) throw new Error("证券资料最多100只");

  const securityCodes = new Set<string>();
  for (const item of securities) {
    const code = readCode(item);
    if (!code) throw new Error("证券代码无效");
    if (securityCodes.has(code)) throw new Error("证券代码重复：" + code);
    securityCodes.add(code);
  }

  const watchlist = arrayRecords(raw.watchlist);
  if (watchlist.length === 0) throw new Error("至少保留一只自选股");
  if (watchlist.length > 50) throw new Error("自选股最多50只");
  const watchCodes = new Set<string>();
  for (const item of watchlist) {
    const code = readCode(item);
    if (!code || !securityCodes.has(code)) throw new Error("自选代码无效：" + (code || "空值"));
    if (watchCodes.has(code)) throw new Error("自选代码重复：" + code);
    watchCodes.add(code);
  }

  const rawAi = asRecord(raw.ai);
  if (typeof rawAi.apiKey === "string" && rawAi.apiKey.trim()) {
    throw new Error("API Key 不能写入普通设置");
  }
  if (rawAi.provider !== "deepseek" && rawAi.provider !== "custom") {
    throw new Error("AI 服务类型无效");
  }
  assertAiBaseUrl(rawAi.baseUrl);
  if (!asText(rawAi.model, 100)) throw new Error("AI 模型名称不能为空");
  const aiTimeout = asNumber(rawAi.timeoutSeconds);
  if (aiTimeout == null || aiTimeout < 5 || aiTimeout > 120) {
    throw new Error("AI 请求超时必须为 5–120 秒");
  }

  const rawRisk = asRecord(raw.risk);
  if (rawRisk.mode !== "shadow" && rawRisk.mode !== "active") {
    throw new Error("提醒模式无效");
  }
  const riskNumbers = [
    "accountBaseline", "oneR", "maxPositionValue", "maxHoldingCount",
    "maxTotalExposurePercent", "portfolioDailyProfitThreshold",
    "portfolioDailyLossThreshold", "stopWarningPercent", "hysteresisPercent"
  ];
  for (const key of riskNumbers) {
    const value = rawRisk[key];
    if (value != null && (asNumber(value) == null || Number(value) <= 0)) {
      throw new Error("风险参数无效：" + key);
    }
  }
  if (asNumber(rawRisk.cooldownMinutes) == null || Number(rawRisk.cooldownMinutes) < 0) {
    throw new Error("提醒冷却时间无效");
  }
  const riskGroupIds = new Set<string>();
  for (const group of arrayRecords(rawRisk.groups)) {
    const id = asIdentifier(group.id, "");
    if (!id || id === "all" || riskGroupIds.has(id)) throw new Error("风险组标识无效");
    riskGroupIds.add(id);
  }

  const holdingCodes = new Set<string>();
  for (const item of arrayRecords(raw.holdings)) {
    const code = readCode(item);
    const quantity = asNumber(item.quantity);
    const costPrice = asNumber(item.costPrice);
    if (!code || !securityCodes.has(code)) throw new Error("持仓代码无效：" + (code || "空值"));
    if (holdingCodes.has(code)) throw new Error("持仓代码重复：" + code);
    if (quantity == null || quantity <= 0) throw new Error("持仓数量无效：" + code);
    if (costPrice == null || costPrice <= 0) throw new Error("持仓成本无效：" + code);
    const groupId = asIdentifier(item.groupId, "all");
    if (groupId !== "all" && !riskGroupIds.has(groupId)) {
      throw new Error("持仓风险组无效：" + code);
    }
    const alertRules = asRecord(item.alertRules);
    for (const key of [
      "stopLossPrice", "watchPrice", "priceAbove", "priceBelow",
      "risePercent", "fallPercent", "dailyProfitAmount", "dailyLossAmount",
      "totalProfitAmount", "totalLossAmount"
    ]) {
      const value = alertRules[key];
      if (value != null && value !== "" && (asNumber(value) == null || Number(value) <= 0)) {
        throw new Error("持仓提醒参数无效：" + code + "/" + key);
      }
    }
    holdingCodes.add(code);
  }

  const tabs = arrayRecords(raw.tabs);
  if (tabs.length === 0 || !tabs.some((tab) => tab.visible !== false)) {
    throw new Error("至少显示一个页面");
  }

  const rawWindow = asRecord(raw.window);
  if (rawWindow.bossKeyEnabled !== false && !parseBossKeyAccelerator(rawWindow.bossKeyAccelerator)) {
    throw new Error("老板键无效、被禁止或不受支持");
  }
}

function migrateBossKeyAccelerator(value: unknown, sourceSchemaVersion: number): string {
  const parsed = parseBossKeyAccelerator(value);
  if (sourceSchemaVersion < BOSS_KEY_SCHEMA_VERSION &&
      parsed != null &&
      LEGACY_DEFAULT_BOSS_KEY_ACCELERATORS.includes(
        parsed as (typeof LEGACY_DEFAULT_BOSS_KEY_ACCELERATORS)[number]
      )) {
    return DEFAULT_BOSS_KEY_ACCELERATOR;
  }
  return normalizeBossKeyAccelerator(value);
}

function migrateWindowBounds(
  rawWindow: Record<string, unknown>,
  sourceSchemaVersion: number
): { width: number; height: number; x: number | null; y: number | null } {
  const width = clampInteger(asNumber(rawWindow.width) ?? 380, 260, 1_000);
  const height = clampInteger(asNumber(rawWindow.height) ?? 520, 180, 1_200);
  if (sourceSchemaVersion < WINDOW_BOUNDS_SCHEMA_VERSION && width >= 900 && height >= 800) {
    return { width: 380, height: 520, x: null, y: null };
  }
  return {
    width,
    height,
    x: nullableInteger(rawWindow.x),
    y: nullableInteger(rawWindow.y)
  };
}
function normalizeSecurities(value: unknown): Map<string, Security> {
  const result = new Map<string, Security>();
  for (const item of arrayRecords(value)) {
    const code = readCode(item);
    if (!code || result.has(code)) continue;
    result.set(code, {
      code,
      market: asSecurityMarket(item.market, code),
      name: asText(item.name, 24),
      alias: asText(item.alias, 16)
    });
  }
  return result;
}

function ensureSecurity(
  map: Map<string, Security>,
  code: string,
  patch: { name?: string; alias?: string } = {}
): void {
  if (!isSecurityCode(code)) return;
  const current = map.get(code);
  if (current) {
    if (!current.name && patch.name) current.name = asText(patch.name, 24);
    if (!current.alias && patch.alias) current.alias = asText(patch.alias, 16);
    return;
  }
  map.set(code, {
    code,
    market: inferSecurityMarket(code),
    name: asText(patch.name, 24),
    alias: asText(patch.alias, 16)
  });
}

function normalizeHoldings(
  value: unknown,
  knownCodes: Set<string>,
  riskGroupIds: Set<string>
): Holding[] {
  const result: Holding[] = [];
  const seen = new Set<string>();
  for (const item of arrayRecords(value)) {
    const securityCode = readCode(item);
    const quantity = asNumber(item.quantity);
    const costPrice = asNumber(item.costPrice);
    if (!securityCode || !knownCodes.has(securityCode) || seen.has(securityCode) ||
        quantity == null || quantity <= 0 || costPrice == null || costPrice <= 0) {
      continue;
    }
    seen.add(securityCode);
    result.push({
      securityCode,
      quantity: Math.round(quantity),
      costPrice: round(costPrice, 4),
      groupId: riskGroupIds.has(asIdentifier(item.groupId, "all"))
        ? asIdentifier(item.groupId, "all")
        : "all",
      note: asText(item.note, 120),
      alertRules: normalizeHoldingAlertRules(item.alertRules)
    });
  }
  return result;
}

function normalizeHoldingAlertRules(value: unknown): HoldingAlertRules {
  const raw = asRecord(value);
  return {
    enabled: raw.enabled === true,
    stopLossPrice: positiveOrNull(raw.stopLossPrice, 10_000_000),
    watchPrice: positiveOrNull(raw.watchPrice, 10_000_000),
    priceAbove: positiveOrNull(raw.priceAbove, 10_000_000),
    priceBelow: positiveOrNull(raw.priceBelow, 10_000_000),
    risePercent: positiveOrNull(raw.risePercent, 100),
    fallPercent: positiveOrNull(raw.fallPercent, 100),
    dailyProfitAmount: positiveOrNull(raw.dailyProfitAmount, 1_000_000_000),
    dailyLossAmount: positiveOrNull(raw.dailyLossAmount, 1_000_000_000),
    totalProfitAmount: positiveOrNull(raw.totalProfitAmount, 1_000_000_000),
    totalLossAmount: positiveOrNull(raw.totalLossAmount, 1_000_000_000)
  };
}

function normalizeRiskSettings(raw: Record<string, unknown>): RiskSettings {
  const groups: RiskGroupSettings[] = [];
  const seen = new Set<string>();
  for (const item of arrayRecords(raw.groups)) {
    const id = asIdentifier(item.id, "");
    if (!id || id === "all" || seen.has(id)) continue;
    seen.add(id);
    groups.push({
      id,
      name: asText(item.name, 16) || "风险组",
      profitThreshold: positiveOrNull(item.profitThreshold, 1_000_000_000),
      lossThreshold: positiveOrNull(item.lossThreshold, 1_000_000_000),
      enabled: item.enabled !== false
    });
  }
  const notifications = asRecord(raw.notifications);
  return {
    mode: raw.mode === "active" ? "active" : "shadow",
    accountBaseline: positiveOrNull(raw.accountBaseline, 100_000_000_000),
    oneR: positiveOrNull(raw.oneR, 1_000_000_000),
    maxPositionValue: positiveOrNull(raw.maxPositionValue, 100_000_000_000),
    maxHoldingCount: positiveIntegerOrNull(raw.maxHoldingCount, 100),
    maxTotalExposurePercent: positiveOrNull(raw.maxTotalExposurePercent, 1_000),
    portfolioDailyProfitThreshold: positiveOrNull(
      raw.portfolioDailyProfitThreshold,
      1_000_000_000
    ),
    portfolioDailyLossThreshold: positiveOrNull(
      raw.portfolioDailyLossThreshold,
      1_000_000_000
    ),
    stopWarningPercent: clamp(asNumber(raw.stopWarningPercent) ?? 2, 0.1, 20),
    hysteresisPercent: clamp(asNumber(raw.hysteresisPercent) ?? 0.2, 0.01, 10),
    cooldownMinutes: clampInteger(asNumber(raw.cooldownMinutes) ?? 15, 0, 1_440),
    oncePerDay: raw.oncePerDay === true,
    onlyDuringTrading: raw.onlyDuringTrading !== false,
    notifications: {
      widget: notifications.widget !== false,
      tray: notifications.tray !== false,
      windows: notifications.windows === true
    },
    groups: groups.slice(0, 20)
  };
}
function normalizeWatchlist(
  value: unknown,
  knownCodes: Set<string>,
  securities: Security[]
): WatchlistMembership[] {
  const rows = legacyWatchlistRows(value);
  const source = rows.length > 0
    ? rows
    : securities.map((security, order) => ({
        code: security.code,
        alias: security.alias,
        name: security.name,
        visible: true,
        order,
        groupId: "all"
      }));

  const result: WatchlistMembership[] = [];
  const seen = new Set<string>();
  for (const row of source) {
    if (!knownCodes.has(row.code) || seen.has(row.code)) continue;
    seen.add(row.code);
    result.push({
      securityCode: row.code,
      visible: row.visible,
      order: row.order,
      groupId: row.groupId
    });
  }
  return result.sort((a, b) => a.order - b.order)
    .map((item, order) => ({ ...item, order }));
}

function legacyWatchlistRows(value: unknown): Array<{
  code: string;
  alias: string;
  name: string;
  visible: boolean;
  order: number;
  groupId: string;
}> {
  if (!Array.isArray(value)) return [];
  const result: Array<{
    code: string;
    alias: string;
    name: string;
    visible: boolean;
    order: number;
    groupId: string;
  }> = [];
  const seen = new Set<string>();

  value.forEach((entry, index) => {
    const item = typeof entry === "string" ? { code: entry } : asRecord(entry);
    const code = readCode(item);
    if (!code || seen.has(code)) return;
    seen.add(code);
    result.push({
      code,
      alias: asText(item.alias, 16),
      name: asText(item.name, 24),
      visible: item.visible !== false,
      order: Number.isInteger(item.order) ? Number(item.order) : index,
      groupId: asIdentifier(item.groupId, "all")
    });
  });
  return result;
}

function normalizeTabs(
  value: unknown,
  knownCodes: Set<string>,
  sourceSchemaVersion: number
): TabConfig[] {
  const rawTabs = arrayRecords(value);
  const byId = new Map<string, Record<string, unknown>>();
  for (const item of rawTabs) {
    const id = asIdentifier(item.id, "");
    if (id && !byId.has(id)) byId.set(id, item);
  }

  const tabs = createDefaultTabs().map((defaults) => {
    const raw = byId.get(defaults.id);
    if (!raw) return defaults;
    return {
      ...defaults,
      visible: defaults.id === "market" && sourceSchemaVersion < MARKET_TAB_SCHEMA_VERSION
        ? true
        : raw.visible !== false,
      order: Number.isInteger(raw.order) ? Number(raw.order) : defaults.order,
      securityCodes: normalizeCodeArray(raw.securityCodes).filter((code) => knownCodes.has(code)),
      maxItems: clampInteger(asNumber(raw.maxItems) ?? defaults.maxItems, 1, 30),
      newsMode: asNewsMode(raw.newsMode)
    };
  });

  const builtInIds = new Set(BUILT_IN_TABS.map((tab) => tab.id));
  for (const raw of rawTabs) {
    const id = asIdentifier(raw.id, "");
    if (!id || builtInIds.has(id) || tabs.some((tab) => tab.id === id)) continue;
    tabs.push({
      id,
      type: asCustomTabType(raw.type),
      title: asText(raw.title, 12) || "自定义",
      builtIn: false,
      visible: raw.visible !== false,
      order: Number.isInteger(raw.order) ? Number(raw.order) : tabs.length,
      securityCodes: normalizeCodeArray(raw.securityCodes).filter((code) => knownCodes.has(code)),
      maxItems: clampInteger(asNumber(raw.maxItems) ?? 8, 1, 30),
      newsMode: asNewsMode(raw.newsMode)
    });
  }

  const sorted = tabs.sort((a, b) => a.order - b.order);
  if (!sorted.some((tab) => tab.visible)) {
    const watchlist = sorted.find((tab) => tab.id === "watchlist");
    if (watchlist) watchlist.visible = true;
  }
  return sorted.map((tab, order) => ({ ...tab, order }));
}

function normalizeNavigation(
  raw: Record<string, unknown>,
  tabs: TabConfig[],
  hasHoldings: boolean
): NavigationSettings {
  const visibleIds = new Set(tabs.filter((tab) => tab.visible).map((tab) => tab.id));
  const fallback = hasHoldings && visibleIds.has("holdings") ? "holdings" : "watchlist";
  const requestedDefault = asIdentifier(raw.defaultTabId, "");
  const defaultTabId = visibleIds.has(requestedDefault) ? requestedDefault : fallback;
  const requestedLast = asIdentifier(raw.lastActiveTabId, "");
  return {
    defaultTabId,
    rememberLastTab: raw.rememberLastTab === true,
    lastActiveTabId: visibleIds.has(requestedLast) ? requestedLast : defaultTabId
  };
}

function normalizeQuoteFields(value: unknown): QuoteField[] {
  if (!Array.isArray(value)) return ["price", "changePercent"];
  const allowed = new Set<string>(QUOTE_FIELDS);
  const fields = [...new Set(value.filter((field): field is QuoteField =>
    typeof field === "string" && allowed.has(field)
  ))];
  return fields.length > 0 ? fields.slice(0, 5) : ["price", "changePercent"];
}

function normalizeCodeArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => typeof item === "string" ? item.trim() : "")
    .filter(isSecurityCode))];
}

function asQuoteSort(value: unknown): QuoteSort {
  if (value === "changePercentDesc" || value === "changePercentAbs") return value;
  return "manual";
}

function asNewsMode(value: unknown): NewsMode {
  if (value === "watchlist_related" || value === "important") return value;
  return "all";
}

function asTheme(value: unknown): ThemeMode {
  return value === "stealth" ? "stealth" : "standard";
}

function normalizeAiBaseUrl(value: unknown, provider: AiProvider): string {
  const fallback = provider === "deepseek"
    ? "https://api.deepseek.com"
    : "https://api.openai.com/v1";
  const candidate = asText(value, 300) || fallback;
  try {
    const url = new URL(candidate);
    if (!isSecureApiBaseUrl(candidate)) {
      return fallback;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

function normalizeAiModel(value: unknown, provider: AiProvider): string {
  return asText(value, 100) ||
    (provider === "deepseek" ? "deepseek-v4-flash" : "gpt-4.1-mini");
}

function assertAiBaseUrl(value: unknown): void {
  const candidate = asText(value, 300);
  if (!candidate) throw new Error("AI API 地址不能为空");
  try {
    if (!isSecureApiBaseUrl(candidate)) {
      throw new Error();
    }
  } catch {
    throw new Error("AI API 地址无效");
  }
}

function asCustomTabType(value: unknown): TabType {
  if (value === "holdings" || value === "market" || value === "drivers" || value === "combined") {
    return value;
  }
  return "stock-list";
}

function asSecurityMarket(value: unknown, code: string): SecurityMarket {
  if (value === "SH" || value === "SZ" || value === "BJ") return value;
  return inferSecurityMarket(code);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.map(asRecord).filter((item) => Object.keys(item).length > 0)
    : [];
}

function readCode(item: Record<string, unknown>): string {
  const value = typeof item.securityCode === "string"
    ? item.securityCode
    : typeof item.code === "string"
      ? item.code
      : "";
  const code = value.trim();
  return isSecurityCode(code) ? code : "";
}

function isSecurityCode(value: string): boolean {
  return /^\d{6}$/.test(value);
}

function asText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function asIdentifier(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  return normalized || fallback;
}

function positiveOrNull(value: unknown, maximum: number): number | null {
  const number = asNumber(value);
  return number != null && number > 0 ? round(clamp(number, 0, maximum), 4) : null;
}

function positiveIntegerOrNull(value: unknown, maximum: number): number | null {
  const number = asNumber(value);
  return number != null && number > 0 ? clampInteger(number, 1, maximum) : null;
}
function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableInteger(value: unknown): number | null {
  const number = asNumber(value);
  return number == null ? null : clampInteger(number, -100_000, 100_000);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max));
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
