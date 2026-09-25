import type {
  Holding,
  HoldingAlertRules,
  RiskSettings,
  Security,
  SecurityMarket,
  UserSettings,
  WatchlistMembership
} from "../config.js";
import {
  assertSavableSettings,
  inferSecurityMarket,
  MAX_HOLDING_COST_PRICE,
  MAX_HOLDING_QUANTITY,
  MIN_HOLDING_COST_PRICE
} from "../config.js";

export const PROFILE_VERSION = 1;
export type ProfileImportMode = "merge" | "replace";

export interface ProfileIssue {
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface ProfileDiff {
  securitiesAdded: string[];
  securitiesUpdated: string[];
  holdingsAdded: string[];
  holdingsUpdated: string[];
  holdingsRemoved: string[];
  watchlistAdded: string[];
  watchlistUpdated: string[];
  watchlistRemoved: string[];
  alertRuleChanges: number;
  riskSettingsChanged: boolean;
}

export interface ProfilePreview {
  valid: boolean;
  hasChanges: boolean;
  mode: ProfileImportMode;
  issues: ProfileIssue[];
  diff: ProfileDiff;
  nextSettings?: UserSettings;
}

interface ParsedProfile {
  securities?: Security[];
  holdings?: Holding[];
  holdingRulePresence: Set<string>;
  watchlist?: WatchlistMembership[];
  riskGroups?: RiskSettings["groups"];
  riskPatch?: RiskPatch;
  /**
   * 包是否改动了提醒相关设置（含 `risk` 任意字段、风险组、以及带提醒规则的持仓）。
   *
   * 名字此前叫 `hasRuleContent`，但它对任何 `raw.risk` 对象都成立（哪怕只改通知渠道），
   * 语义上是"包动过提醒设置"。它用于门控"强制切影子模式"这一保守行为。
   */
  touchesRiskSettings: boolean;
}

type RiskPatch = Partial<Omit<RiskSettings, "groups" | "notifications">> & {
  notifications?: Partial<RiskSettings["notifications"]>;
};

const EMPTY_ALERT_RULES: HoldingAlertRules = {
  enabled: false,
  stopLossPrice: null,
  watchPrice: null,
  priceAbove: null,
  priceBelow: null,
  risePercent: null,
  fallPercent: null,
  dailyProfitAmount: null,
  dailyLossAmount: null,
  totalProfitAmount: null,
  totalLossAmount: null
};

const ROOT_KEYS = new Set([
  "profileVersion",
  "generatedAt",
  "source",
  "securities",
  "holdings",
  "watchlist",
  "riskGroups",
  "risk"
]);
const ALERT_KEYS = new Set(Object.keys(EMPTY_ALERT_RULES));
/**
 * 集合上限，与 config.assertSavableSettings 保持一致。
 * 超限一律作为 error 报出，绝不静默截断（截断会让后续引用报出误导性错误）。
 */
const MAX_SECURITIES = 100;
const MAX_HOLDINGS = 100;
const MAX_WATCHLIST = 50;
/**
 * 类型上可为 null 的风险数值字段（null 表示关闭该约束）。
 * 注意 stopWarningPercent / hysteresisPercent / cooldownMinutes 在 RiskSettings 里是
 * `number`，不接受 null，因此单独列出。
 */
const RISK_NULLABLE_NUMBER_FIELDS = new Set([
  "accountBaseline",
  "oneR",
  "maxPositionValue",
  "maxHoldingCount",
  "maxTotalExposurePercent",
  "portfolioDailyProfitThreshold",
  "portfolioDailyLossThreshold"
]);
/** 不可为 null 的风险数值字段 → 合法区间（与 config.ts 的裁剪范围一致）。 */
const RISK_REQUIRED_NUMBER_RANGES = new Map<
  string,
  {
    min: number;
    max: number;
    integer?: boolean;
  }
>([
  ["stopWarningPercent", { min: 0.1, max: 20 }],
  ["hysteresisPercent", { min: 0.01, max: 10 }],
  // config 明确允许 0（关闭冷却），不能用"必须为正数"的校验。
  ["cooldownMinutes", { min: 0, max: 1_440, integer: true }]
]);
const RISK_BOOLEAN_FIELDS = new Set(["oncePerDay", "onlyDuringTrading"]);

export function previewProfileImport(
  current: UserSettings,
  text: string,
  mode: ProfileImportMode
): ProfilePreview {
  const issues: ProfileIssue[] = [];
  const raw = parseProfileJson(text, issues);
  const emptyDiff = createDiff(current, current);
  if (!raw) return { valid: false, hasChanges: false, mode, issues, diff: emptyDiff };
  const parsed = validateProfile(raw, current, mode, issues);
  if (!parsed || issues.some((issue) => issue.severity === "error")) {
    return { valid: false, hasChanges: false, mode, issues, diff: emptyDiff };
  }
  const nextSettings = applyParsedProfile(current, parsed, mode, issues);
  try {
    assertSavableSettings(nextSettings);
  } catch (cause) {
    issues.push(error("$", cause instanceof Error ? cause.message : "配置无法保存"));
  }
  const diff = createDiff(current, nextSettings);
  return {
    valid: !issues.some((issue) => issue.severity === "error"),
    hasChanges: hasProfileChanges(diff),
    mode,
    issues,
    diff,
    nextSettings
  };
}

export function hasProfileChanges(diff: ProfileDiff): boolean {
  return (
    diff.securitiesAdded.length > 0 ||
    diff.securitiesUpdated.length > 0 ||
    diff.holdingsAdded.length > 0 ||
    diff.holdingsUpdated.length > 0 ||
    diff.holdingsRemoved.length > 0 ||
    diff.watchlistAdded.length > 0 ||
    diff.watchlistUpdated.length > 0 ||
    diff.watchlistRemoved.length > 0 ||
    diff.alertRuleChanges > 0 ||
    diff.riskSettingsChanged
  );
}

export function exportProfile(settings: UserSettings): string {
  const referenced = new Set([
    ...settings.holdings.map((holding) => holding.securityCode),
    ...settings.watchlist.map((item) => item.securityCode)
  ]);
  const payload = {
    profileVersion: PROFILE_VERSION,
    generatedAt: new Date().toISOString(),
    source: "floating-stock-widget",
    securities: settings.securities.filter((security) => referenced.has(security.code)),
    holdings: settings.holdings.map((holding) => ({
      ...holding,
      alertRules: { ...holding.alertRules }
    })),
    watchlist: settings.watchlist.map((item) => ({ ...item })),
    riskGroups: settings.risk.groups.map((group) => ({ ...group })),
    risk: {
      mode: settings.risk.mode,
      accountBaseline: settings.risk.accountBaseline,
      oneR: settings.risk.oneR,
      maxPositionValue: settings.risk.maxPositionValue,
      maxHoldingCount: settings.risk.maxHoldingCount,
      maxTotalExposurePercent: settings.risk.maxTotalExposurePercent,
      portfolioDailyProfitThreshold: settings.risk.portfolioDailyProfitThreshold,
      portfolioDailyLossThreshold: settings.risk.portfolioDailyLossThreshold,
      stopWarningPercent: settings.risk.stopWarningPercent,
      hysteresisPercent: settings.risk.hysteresisPercent,
      cooldownMinutes: settings.risk.cooldownMinutes,
      oncePerDay: settings.risk.oncePerDay,
      onlyDuringTrading: settings.risk.onlyDuringTrading,
      notifications: { ...settings.risk.notifications }
    }
  };
  return JSON.stringify(payload, null, 2) + "\n";
}

export function profilePrompt(): string {
  const example = {
    profileVersion: 1,
    source: "coze",
    securities: [{ code: "000001", market: "SZ", name: "示例股票", alias: "" }],
    holdings: [
      {
        securityCode: "000001",
        quantity: 100,
        costPrice: 10.5,
        groupId: "all",
        note: "仅保存人工持有逻辑，不由程序解释",
        alertRules: {
          enabled: true,
          stopLossPrice: 9.5,
          watchPrice: 10,
          priceAbove: null,
          priceBelow: null,
          risePercent: 5,
          fallPercent: 5,
          dailyProfitAmount: null,
          dailyLossAmount: 300,
          totalProfitAmount: null,
          totalLossAmount: 500
        }
      }
    ],
    watchlist: [{ securityCode: "000001", visible: true, order: 0, groupId: "all" }],
    riskGroups: [],
    risk: {
      mode: "shadow",
      cooldownMinutes: 15,
      hysteresisPercent: 0.2,
      oncePerDay: false,
      onlyDuringTrading: true,
      notifications: { widget: true, tray: true, windows: false }
    }
  };
  return [
    "请根据我随后提供或你已掌握的持仓、自选和交易纪律，生成“摸鱼看盘”配置包。",
    "只输出一个 JSON 对象，不要 Markdown 代码围栏，不要解释，不要给出买卖建议。",
    "股票代码必须为 6 位；价格单位为人民币元；百分比直接填写数值 5 表示 5%；金额单位为人民币元。",
    "无法确认的数值填写 null，绝对禁止猜测数量、成本、止损价或账户数据。",
    "只把可机械判断的价格、涨跌幅和金额条件写入 alertRules；主观纪律写入 note，不能编造可执行公式。",
    "profileVersion 必须为 1；未知字段不要输出。导入后应用会强制先进入影子模式。",
    "允许字段和示例：",
    JSON.stringify(example, null, 2)
  ].join("\n");
}

function parseProfileJson(text: string, issues: ProfileIssue[]): Record<string, unknown> | null {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  if (!trimmed) {
    issues.push(error("$", "配置包为空"));
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!isRecord(parsed)) {
      issues.push(error("$", "配置包必须是 JSON 对象"));
      return null;
    }
    return parsed;
  } catch (cause) {
    issues.push(
      error("$", `JSON 无法解析：${cause instanceof Error ? cause.message : String(cause)}`)
    );
    return null;
  }
}

function validateProfile(
  raw: Record<string, unknown>,
  current: UserSettings,
  mode: ProfileImportMode,
  issues: ProfileIssue[]
): ParsedProfile | null {
  for (const key of Object.keys(raw)) {
    if (!ROOT_KEYS.has(key)) issues.push(error(`$.${key}`, "不支持的字段"));
  }
  if (raw.profileVersion !== PROFILE_VERSION) {
    issues.push(error("$.profileVersion", `只支持版本 ${PROFILE_VERSION}`));
  }
  if (raw.generatedAt !== undefined && typeof raw.generatedAt !== "string") {
    issues.push(error("$.generatedAt", "必须是字符串"));
  }
  if (raw.source !== undefined && typeof raw.source !== "string") {
    issues.push(error("$.source", "必须是字符串"));
  }
  const parsed: ParsedProfile = {
    holdingRulePresence: new Set(),
    touchesRiskSettings: false
  };
  if (raw.securities !== undefined) parsed.securities = validateSecurities(raw.securities, issues);
  const known = new Map(current.securities.map((security) => [security.code, security]));
  for (const security of parsed.securities ?? []) known.set(security.code, security);
  if (raw.riskGroups !== undefined) parsed.riskGroups = validateRiskGroups(raw.riskGroups, issues);
  const groupIds = new Set([
    "all",
    ...(mode === "merge" || !parsed.riskGroups ? current.risk.groups.map((group) => group.id) : []),
    ...(parsed.riskGroups ?? []).map((group) => group.id)
  ]);
  if (raw.holdings !== undefined) {
    const result = validateHoldings(raw.holdings, known, groupIds, issues);
    parsed.holdings = result.items;
    parsed.holdingRulePresence = result.rulePresence;
    parsed.touchesRiskSettings ||= result.rulePresence.size > 0;
  }
  if (raw.watchlist !== undefined)
    parsed.watchlist = validateWatchlist(raw.watchlist, known, groupIds, issues);
  if (raw.risk !== undefined) {
    parsed.riskPatch = validateRisk(raw.risk, issues);
    parsed.touchesRiskSettings = true;
  }
  if (parsed.riskGroups) parsed.touchesRiskSettings = true;
  if (
    !parsed.securities &&
    !parsed.holdings &&
    !parsed.watchlist &&
    !parsed.riskGroups &&
    !parsed.riskPatch
  ) {
    issues.push(error("$", "配置包没有可导入内容"));
  }
  return parsed;
}

function validateSecurities(value: unknown, issues: ProfileIssue[]): Security[] {
  if (!Array.isArray(value)) {
    issues.push(error("$.securities", "必须是数组"));
    return [];
  }
  // 超限必须报错而不是静默截断：此前 120 只会被切成 100 只且不提示，
  // 随后引用被丢弃代码的持仓还会报出误导性的"必须先在 securities 中定义"。
  if (value.length > MAX_SECURITIES) {
    issues.push(error("$.securities", `最多 ${MAX_SECURITIES} 只证券，当前 ${value.length} 只`));
  }
  const result: Security[] = [];
  const seen = new Set<string>();
  (value as unknown[]).slice(0, MAX_SECURITIES).forEach((entry, index) => {
    const path = `$.securities[${index}]`;
    if (!isRecord(entry)) return issues.push(error(path, "必须是对象"));
    rejectUnknown(entry, new Set(["code", "market", "name", "alias"]), path, issues);
    const code = validCode(entry.code, `${path}.code`, issues);
    if (!code) return;
    if (seen.has(code)) return issues.push(error(`${path}.code`, "证券代码重复"));
    seen.add(code);
    const inferred = inferMarket(code);
    const market =
      entry.market === "SH" || entry.market === "SZ" || entry.market === "BJ"
        ? entry.market
        : inferred;
    if (entry.market !== undefined && entry.market !== inferred) {
      issues.push(error(`${path}.market`, `市场与代码不匹配，应为 ${inferred}`));
      return;
    }
    result.push({
      code,
      market,
      name: shortText(entry.name, 40, `${path}.name`, issues),
      alias: shortText(entry.alias, 20, `${path}.alias`, issues)
    });
  });
  return result;
}

function validateHoldings(
  value: unknown,
  known: Map<string, Security>,
  groupIds: Set<string>,
  issues: ProfileIssue[]
): { items: Holding[]; rulePresence: Set<string> } {
  if (!Array.isArray(value)) {
    issues.push(error("$.holdings", "必须是数组"));
    return { items: [], rulePresence: new Set() };
  }
  const items: Holding[] = [];
  const seen = new Set<string>();
  const rulePresence = new Set<string>();
  if (value.length > MAX_HOLDINGS) {
    issues.push(error("$.holdings", `最多 ${MAX_HOLDINGS} 条持仓，当前 ${value.length} 条`));
  }
  (value as unknown[]).slice(0, MAX_HOLDINGS).forEach((entry, index) => {
    const path = `$.holdings[${index}]`;
    if (!isRecord(entry)) return issues.push(error(path, "必须是对象"));
    rejectUnknown(
      entry,
      new Set(["code", "securityCode", "quantity", "costPrice", "groupId", "note", "alertRules"]),
      path,
      issues
    );
    const code = validCode(entry.securityCode ?? entry.code, `${path}.securityCode`, issues);
    if (!code) return;
    if (!known.has(code))
      return issues.push(error(`${path}.securityCode`, "必须先在 securities 中定义"));
    if (seen.has(code)) return issues.push(error(`${path}.securityCode`, "持仓代码重复"));
    seen.add(code);
    const quantity = positiveNumber(
      entry.quantity,
      `${path}.quantity`,
      issues,
      true,
      1,
      MAX_HOLDING_QUANTITY
    );
    const costPrice = positiveNumber(
      entry.costPrice,
      `${path}.costPrice`,
      issues,
      false,
      MIN_HOLDING_COST_PRICE,
      MAX_HOLDING_COST_PRICE
    );
    const groupId =
      typeof entry.groupId === "string" && entry.groupId.trim() ? entry.groupId.trim() : "all";
    if (!groupIds.has(groupId)) issues.push(error(`${path}.groupId`, "风险组不存在"));
    const hasRules = entry.alertRules !== undefined;
    if (hasRules) rulePresence.add(code);
    const alertRules = hasRules
      ? validateAlertRules(entry.alertRules, `${path}.alertRules`, issues)
      : { ...EMPTY_ALERT_RULES };
    if (quantity == null || costPrice == null) return;
    items.push({
      securityCode: code,
      quantity,
      costPrice,
      groupId: groupIds.has(groupId) ? groupId : "all",
      note: shortText(entry.note, 120, `${path}.note`, issues),
      alertRules
    });
  });
  return { items, rulePresence };
}

function validateWatchlist(
  value: unknown,
  known: Map<string, Security>,
  groupIds: Set<string>,
  issues: ProfileIssue[]
): WatchlistMembership[] {
  if (!Array.isArray(value)) {
    issues.push(error("$.watchlist", "必须是数组"));
    return [];
  }
  const result: WatchlistMembership[] = [];
  const seen = new Set<string>();
  if (value.length > MAX_WATCHLIST) {
    issues.push(error("$.watchlist", `最多50只自选，当前 ${value.length} 只`));
  }
  // Array.isArray 会把类型收窄为 any[]；显式收敛为 unknown[] 以免 any 扩散。
  (value as unknown[]).slice(0, MAX_WATCHLIST).forEach((entry, index) => {
    const path = `$.watchlist[${index}]`;
    const record = typeof entry === "string" ? { securityCode: entry } : entry;
    if (!isRecord(record)) return issues.push(error(path, "必须是代码字符串或对象"));
    rejectUnknown(
      record,
      new Set(["code", "securityCode", "visible", "order", "groupId"]),
      path,
      issues
    );
    const code = validCode(record.securityCode ?? record.code, `${path}.securityCode`, issues);
    if (!code) return;
    if (!known.has(code))
      return issues.push(error(`${path}.securityCode`, "必须先在 securities 中定义"));
    if (seen.has(code)) return issues.push(error(`${path}.securityCode`, "自选代码重复"));
    seen.add(code);
    const groupId =
      typeof record.groupId === "string" && record.groupId.trim() ? record.groupId.trim() : "all";
    if (!groupIds.has(groupId)) issues.push(error(`${path}.groupId`, "风险组不存在"));
    const requestedOrder =
      record.order === undefined
        ? result.length
        : nonNegativeInteger(record.order, `${path}.order`, issues);
    result.push({
      securityCode: code,
      visible: record.visible !== false,
      order: requestedOrder ?? result.length,
      groupId: groupIds.has(groupId) ? groupId : "all"
    });
  });
  return result
    .sort((left, right) => left.order - right.order)
    .map((item, order) => ({ ...item, order }));
}

function validateRiskGroups(value: unknown, issues: ProfileIssue[]): RiskSettings["groups"] {
  if (!Array.isArray(value)) {
    issues.push(error("$.riskGroups", "必须是数组"));
    return [];
  }
  const seen = new Set<string>();
  return value.slice(0, 20).flatMap((entry, index) => {
    const path = `$.riskGroups[${index}]`;
    if (!isRecord(entry)) {
      issues.push(error(path, "必须是对象"));
      return [];
    }
    rejectUnknown(
      entry,
      new Set(["id", "name", "profitThreshold", "lossThreshold", "enabled"]),
      path,
      issues
    );
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id) || id === "all" || seen.has(id)) {
      issues.push(error(`${path}.id`, "风险组 ID 无效或重复"));
      return [];
    }
    seen.add(id);
    return [
      {
        id,
        name: shortText(entry.name, 16, `${path}.name`, issues) || "风险组",
        profitThreshold: nullablePositive(entry.profitThreshold, `${path}.profitThreshold`, issues),
        lossThreshold: nullablePositive(entry.lossThreshold, `${path}.lossThreshold`, issues),
        enabled: entry.enabled !== false
      }
    ];
  });
}

function validateAlertRules(
  value: unknown,
  path: string,
  issues: ProfileIssue[]
): HoldingAlertRules {
  if (!isRecord(value)) {
    issues.push(error(path, "必须是对象"));
    return { ...EMPTY_ALERT_RULES };
  }
  rejectUnknown(value, ALERT_KEYS, path, issues);
  const result = { ...EMPTY_ALERT_RULES };
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    issues.push(error(`${path}.enabled`, "必须是布尔值"));
  }
  result.enabled = value.enabled === true;
  for (const key of ALERT_KEYS) {
    if (key === "enabled") continue;
    result[key as keyof Omit<HoldingAlertRules, "enabled">] = nullablePositive(
      value[key],
      `${path}.${key}`,
      issues
    );
  }
  return result;
}

function validateRisk(value: unknown, issues: ProfileIssue[]): RiskPatch {
  if (!isRecord(value)) {
    issues.push(error("$.risk", "必须是对象"));
    return {};
  }
  const allowed = new Set([
    "mode",
    ...RISK_NULLABLE_NUMBER_FIELDS,
    ...RISK_REQUIRED_NUMBER_RANGES.keys(),
    ...RISK_BOOLEAN_FIELDS,
    "notifications"
  ]);
  rejectUnknown(value, allowed, "$.risk", issues);
  const patch: RiskPatch = {};
  if (value.mode !== undefined && value.mode !== "shadow" && value.mode !== "active") {
    issues.push(error("$.risk.mode", "必须是 shadow 或 active"));
  }
  if (value.mode === "active") {
    issues.push(warning("$.risk.mode", "导入不会直接启用正式提醒，已改为影子模式"));
  }
  patch.mode = "shadow";
  for (const key of RISK_NULLABLE_NUMBER_FIELDS) {
    if (value[key] === undefined) continue;
    (patch as Record<string, unknown>)[key] = nullablePositive(value[key], `$.risk.${key}`, issues);
  }
  for (const [key, range] of RISK_REQUIRED_NUMBER_RANGES) {
    if (value[key] === undefined) continue;
    const parsed = numberInRange(
      value[key],
      `$.risk.${key}`,
      range.min,
      range.max,
      range.integer === true,
      issues
    );
    if (parsed != null) (patch as Record<string, unknown>)[key] = parsed;
  }
  for (const key of RISK_BOOLEAN_FIELDS) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "boolean") issues.push(error(`$.risk.${key}`, "必须是布尔值"));
    else (patch as Record<string, unknown>)[key] = value[key];
  }
  if (value.notifications !== undefined) {
    if (!isRecord(value.notifications)) issues.push(error("$.risk.notifications", "必须是对象"));
    else {
      rejectUnknown(
        value.notifications,
        new Set(["widget", "tray", "windows"]),
        "$.risk.notifications",
        issues
      );
      const notifications: Record<string, boolean> = {};
      for (const key of ["widget", "tray", "windows"]) {
        const entry = value.notifications[key];
        if (entry !== undefined && typeof entry !== "boolean") {
          issues.push(error(`$.risk.notifications.${key}`, "必须是布尔值"));
        } else if (typeof entry === "boolean") notifications[key] = entry;
      }
      patch.notifications = notifications;
    }
  }
  return patch;
}

function applyParsedProfile(
  current: UserSettings,
  parsed: ParsedProfile,
  mode: ProfileImportMode,
  issues: ProfileIssue[]
): UserSettings {
  const next = structuredClone(current);
  if (parsed.riskGroups) {
    next.risk.groups =
      mode === "replace"
        ? parsed.riskGroups
        : mergeBy(next.risk.groups, parsed.riskGroups, (item) => item.id);
  }
  if (parsed.securities) {
    next.securities = mergeBy(next.securities, parsed.securities, (item) => item.code);
  }
  if (parsed.holdings) {
    if (mode === "replace") next.holdings = parsed.holdings;
    else {
      const existing = new Map(next.holdings.map((holding) => [holding.securityCode, holding]));
      for (const incoming of parsed.holdings) {
        const previous = existing.get(incoming.securityCode);
        existing.set(
          incoming.securityCode,
          previous && !parsed.holdingRulePresence.has(incoming.securityCode)
            ? { ...incoming, alertRules: { ...previous.alertRules } }
            : incoming
        );
      }
      next.holdings = [...existing.values()];
    }
  }
  if (parsed.watchlist) {
    next.watchlist =
      mode === "replace" ? parsed.watchlist : mergeWatchlist(next.watchlist, parsed.watchlist);
  }
  if (parsed.riskPatch) {
    const notifications = parsed.riskPatch.notifications
      ? { ...next.risk.notifications, ...parsed.riskPatch.notifications }
      : next.risk.notifications;
    next.risk = { ...next.risk, ...parsed.riskPatch, notifications };
  }
  if (parsed.touchesRiskSettings) {
    if (current.risk.mode === "active") {
      issues.push(
        warning(
          "$.risk.mode",
          "导入包含提醒设置，已强制切换为影子模式，确认无误后再手动启用正式提醒"
        )
      );
    }
    next.risk.mode = "shadow";
  }
  const knownCodes = new Set(next.securities.map((security) => security.code));
  next.holdings = next.holdings.filter((holding) => knownCodes.has(holding.securityCode));
  next.watchlist = next.watchlist
    .filter((item) => knownCodes.has(item.securityCode))
    .map((item, order) => ({ ...item, order }));
  for (const tab of next.tabs) {
    tab.securityCodes = tab.securityCodes.filter((code) => knownCodes.has(code));
  }
  return next;
}

function createDiff(before: UserSettings, after: UserSettings): ProfileDiff {
  const beforeSecurities = new Map(before.securities.map((item) => [item.code, item]));
  const afterSecurities = new Map(after.securities.map((item) => [item.code, item]));
  const beforeHoldings = new Map(before.holdings.map((item) => [item.securityCode, item]));
  const afterHoldings = new Map(after.holdings.map((item) => [item.securityCode, item]));
  const beforeWatch = new Set(before.watchlist.map((item) => item.securityCode));
  const afterWatch = new Set(after.watchlist.map((item) => item.securityCode));
  const beforeWatchRows = new Map(before.watchlist.map((item) => [item.securityCode, item]));
  const afterWatchRows = new Map(after.watchlist.map((item) => [item.securityCode, item]));
  let alertRuleChanges = 0;
  for (const [code, holding] of afterHoldings) {
    if (
      JSON.stringify(beforeHoldings.get(code)?.alertRules) !== JSON.stringify(holding.alertRules)
    ) {
      alertRuleChanges += 1;
    }
  }
  const riskBefore = { ...before.risk, groups: before.risk.groups, mode: before.risk.mode };
  const riskAfter = { ...after.risk, groups: after.risk.groups, mode: after.risk.mode };
  return {
    securitiesAdded: [...afterSecurities.keys()].filter((code) => !beforeSecurities.has(code)),
    securitiesUpdated: [...afterSecurities.keys()].filter(
      (code) =>
        beforeSecurities.has(code) &&
        JSON.stringify(beforeSecurities.get(code)) !== JSON.stringify(afterSecurities.get(code))
    ),
    holdingsAdded: [...afterHoldings.keys()].filter((code) => !beforeHoldings.has(code)),
    holdingsUpdated: [...afterHoldings.keys()].filter(
      (code) =>
        beforeHoldings.has(code) &&
        JSON.stringify(beforeHoldings.get(code)) !== JSON.stringify(afterHoldings.get(code))
    ),
    holdingsRemoved: [...beforeHoldings.keys()].filter((code) => !afterHoldings.has(code)),
    watchlistAdded: [...afterWatch].filter((code) => !beforeWatch.has(code)),
    watchlistUpdated: [...afterWatch].filter(
      (code) =>
        beforeWatch.has(code) &&
        JSON.stringify(beforeWatchRows.get(code)) !== JSON.stringify(afterWatchRows.get(code))
    ),
    watchlistRemoved: [...beforeWatch].filter((code) => !afterWatch.has(code)),
    alertRuleChanges,
    riskSettingsChanged: JSON.stringify(riskBefore) !== JSON.stringify(riskAfter)
  };
}

function mergeBy<T>(current: T[], incoming: T[], key: (item: T) => string): T[] {
  const result = new Map(current.map((item) => [key(item), item]));
  for (const item of incoming) result.set(key(item), item);
  return [...result.values()];
}

/**
 * 合并自选：包内出现的代码按包里的顺序排在前面，其余保持原有相对顺序排在后面。
 *
 * 之前用的是通用 mergeBy（基于 Map 的插入顺序），已存在代码的 `order` 变更会被丢弃，
 * 于是"只调整顺序"的包会被判定成 hasChanges=false，报出误导性的"没有差异"。
 */
function mergeWatchlist(
  current: WatchlistMembership[],
  incoming: WatchlistMembership[]
): WatchlistMembership[] {
  const seen = new Set<string>();
  const merged: WatchlistMembership[] = [];
  // 先遍历 incoming，命中冲突时以包里的行（包括可见性与别名）为准。
  for (const item of [...incoming, ...current]) {
    if (seen.has(item.securityCode)) continue;
    seen.add(item.securityCode);
    merged.push(item);
  }
  return merged.map((item, order) => ({ ...item, order }));
}

function inferMarket(code: string): SecurityMarket {
  // 与 config.ts 的统一推断保持一致（此前这里有一份规则不同、会拒绝合法 B 股的副本）。
  return inferSecurityMarket(code);
}

function validCode(value: unknown, path: string, issues: ProfileIssue[]): string | null {
  const code = typeof value === "string" ? value.trim() : "";
  if (!/^\d{6}$/.test(code)) {
    issues.push(error(path, "必须是 6 位证券代码"));
    return null;
  }
  return code;
}

function positiveNumber(
  value: unknown,
  path: string,
  issues: ProfileIssue[],
  integer: boolean,
  minimum = Number.MIN_VALUE,
  maximum = Number.MAX_SAFE_INTEGER
): number | null {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    (integer && !Number.isInteger(value))
  ) {
    issues.push(error(path, integer ? "必须是正整数" : "必须是正数"));
    return null;
  }
  if (value < minimum || value > maximum) {
    issues.push(error(path, `必须在 ${minimum} 与 ${maximum} 之间`));
    return null;
  }
  return value;
}

function nullablePositive(value: unknown, path: string, issues: ProfileIssue[]): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    issues.push(error(path, "必须是正数或 null"));
    return null;
  }
  return value;
}

/** 不可为 null 的数值字段：显式 null 也是错误（RiskSettings 里声明为 number）。 */
function numberInRange(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
  integer: boolean,
  issues: ProfileIssue[]
): number | null {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum ||
    (integer && !Number.isInteger(value))
  ) {
    issues.push(
      error(
        path,
        integer
          ? `必须是 ${minimum}–${maximum} 之间的整数`
          : `必须是 ${minimum}–${maximum} 之间的数字`
      )
    );
    return null;
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string, issues: ProfileIssue[]): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    issues.push(error(path, "必须是非负整数"));
    return null;
  }
  return value;
}

function shortText(value: unknown, max: number, path: string, issues: ProfileIssue[]): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    issues.push(error(path, "必须是字符串"));
    return "";
  }
  if (value.length > max) issues.push(error(path, `最多 ${max} 个字符`));
  return value.trim().slice(0, max);
}

function rejectUnknown(
  value: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
  issues: ProfileIssue[]
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issues.push(error(`${path}.${key}`, "不支持的字段"));
  }
}

function error(path: string, message: string): ProfileIssue {
  return { severity: "error", path, message };
}

function warning(path: string, message: string): ProfileIssue {
  return { severity: "warning", path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
