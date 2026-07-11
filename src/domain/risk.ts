import type { Holding, RiskSettings, UserSettings } from "../config.js";
import type {
  AlertRuleType,
  HoldingRiskMetrics,
  PortfolioRiskMetrics,
  Quote,
  RiskGroupMetrics,
  RiskSnapshot,
  RiskViolation
} from "./types.js";

export interface RiskCalculationInput {
  settings: Pick<UserSettings, "holdings" | "securities" | "risk">;
  quotes: Quote[];
  feedHealthy: boolean;
  now?: Date;
}

export interface AlertCandidate {
  ruleId: string;
  type: AlertRuleType;
  title: string;
  message: string;
  securityCode?: string;
  groupId?: string;
  value: number;
  threshold: number;
  direction: "above" | "below";
  hysteresis: number;
  safe: boolean;
}

export function calculateRiskSnapshot(input: RiskCalculationInput): RiskSnapshot {
  const { settings } = input;
  const quoteMap = new Map(input.quotes.map((quote) => [quote.code, quote]));
  const nameMap = new Map(settings.securities.map((security) => [
    security.code,
    security.alias || security.name || security.code
  ]));
  const holdings = settings.holdings.map((holding) => calculateHolding(
    holding,
    nameMap.get(holding.securityCode) ?? holding.securityCode,
    quoteMap.get(holding.securityCode),
    settings.risk,
    input.feedHealthy
  ));
  const groups = calculateGroups(holdings, settings.risk);
  const portfolio = calculatePortfolio(holdings, settings.risk);
  return {
    mode: settings.risk.mode,
    paused: false,
    pausedThroughDate: null,
    dataSafe: portfolio.dataSafe,
    holdings,
    groups,
    portfolio,
    recentEvents: [],
    updatedAt: (input.now ?? new Date()).toISOString()
  };
}

export function buildAlertCandidates(
  settings: Pick<UserSettings, "holdings" | "risk">,
  snapshot: RiskSnapshot
): AlertCandidate[] {
  const candidates: AlertCandidate[] = [];
  const metricMap = new Map(snapshot.holdings.map((item) => [item.securityCode, item]));
  for (const holding of settings.holdings) {
    const metric = metricMap.get(holding.securityCode);
    if (!metric) continue;
    if (holding.alertRules.enabled) {
      addHoldingCandidates(candidates, holding, metric, settings.risk);
    }
    addCandidate(candidates, settings.risk.maxPositionValue, {
      ruleId: `holding:${holding.securityCode}:position`, type: "position_value",
      title: `${metric.name}超过单一持仓上限`, message: moneyMessage("当前市值", metric.marketValue),
      securityCode: holding.securityCode, value: metric.marketValue, direction: "above",
      safe: metric.dataSafe,
      hysteresis: moneyHysteresis(settings.risk.maxPositionValue, settings.risk)
    });
  }

  const portfolio = snapshot.portfolio;
  addCandidate(candidates, settings.risk.portfolioDailyProfitThreshold, {
    ruleId: "portfolio:daily-profit",
    type: "portfolio_daily_profit",
    title: "持仓合计今日盈利达到阈值",
    message: moneyMessage("持仓今日盈亏", portfolio.dailyPnl),
    value: portfolio.dailyPnl,
    direction: "above",
    safe: portfolio.dataSafe,
    hysteresis: moneyHysteresis(settings.risk.portfolioDailyProfitThreshold, settings.risk)
  });
  addCandidate(candidates, settings.risk.portfolioDailyLossThreshold, {
    ruleId: "portfolio:daily-loss",
    type: "portfolio_daily_loss",
    title: "持仓合计今日亏损达到停手阈值",
    message: moneyMessage("持仓今日盈亏", portfolio.dailyPnl),
    value: portfolio.dailyPnl,
    thresholdTransform: (value) => -value,
    direction: "below",
    safe: portfolio.dataSafe,
    hysteresis: moneyHysteresis(settings.risk.portfolioDailyLossThreshold, settings.risk)
  });
  addCandidate(candidates, settings.risk.maxHoldingCount, {
    ruleId: "portfolio:holding-count",
    type: "holding_count",
    title: "持仓数量超过上限",
    message: `当前 ${portfolio.holdingCount} 只持仓`,
    value: portfolio.holdingCount,
    direction: "above",
    safe: true,
    hysteresis: 1
  });
  addCandidate(candidates, settings.risk.maxTotalExposurePercent, {
    ruleId: "portfolio:exposure",
    type: "exposure",
    title: "总持仓比例超过上限",
    message: percentMessage("总持仓比例", portfolio.exposurePercent),
    value: portfolio.exposurePercent,
    direction: "above",
    safe: portfolio.dataSafe,
    hysteresis: Math.max(0.2, (settings.risk.maxTotalExposurePercent ?? 0) * 0.02)
  });

  const groupMap = new Map(snapshot.groups.map((group) => [group.id, group]));
  for (const group of settings.risk.groups.filter((item) => item.enabled)) {
    const metric = groupMap.get(group.id);
    if (!metric) continue;
    addCandidate(candidates, group.profitThreshold, {
      ruleId: `group:${group.id}:profit`,
      type: "group_profit",
      title: `${group.name}合计盈利达到阈值`,
      message: moneyMessage(`${group.name}浮盈亏`, metric.totalPnl),
      groupId: group.id,
      value: metric.totalPnl,
      direction: "above",
      safe: metric.dataSafe,
      hysteresis: moneyHysteresis(group.profitThreshold, settings.risk)
    });
    addCandidate(candidates, group.lossThreshold, {
      ruleId: `group:${group.id}:loss`,
      type: "group_loss",
      title: `${group.name}合计亏损达到阈值`,
      message: moneyMessage(`${group.name}浮盈亏`, metric.totalPnl),
      groupId: group.id,
      value: metric.totalPnl,
      thresholdTransform: (value) => -value,
      direction: "below",
      safe: metric.dataSafe,
      hysteresis: moneyHysteresis(group.lossThreshold, settings.risk)
    });
  }
  return candidates;
}

export function emptyRiskSnapshot(mode: "shadow" | "active" = "shadow"): RiskSnapshot {
  return {
    mode,
    paused: false,
    pausedThroughDate: null,
    dataSafe: false,
    holdings: [],
    groups: [],
    portfolio: {
      holdingCount: 0,
      marketValue: null,
      dailyPnl: null,
      totalPnl: null,
      dailyPnlR: null,
      totalPnlR: null,
      exposurePercent: null,
      dataSafe: false,
      violations: []
    },
    recentEvents: [],
    updatedAt: new Date(0).toISOString()
  };
}

function calculateHolding(
  holding: Holding,
  name: string,
  quote: Quote | undefined,
  risk: RiskSettings,
  feedHealthy: boolean
): HoldingRiskMetrics {
  const price = finitePositive(quote?.price) ? quote.price : null;
  const previousClose = finitePositive(quote?.previousClose) ? quote.previousClose : null;
  const quoteSafe = isQuoteAlertSafe(quote);
  const dataSafe = feedHealthy && quoteSafe && price != null && previousClose != null;
  const marketValue = price == null ? null : price * holding.quantity;
  const dailyPnl = price == null || previousClose == null
    ? null
    : (price - previousClose) * holding.quantity;
  const totalPnl = price == null ? null : (price - holding.costPrice) * holding.quantity;
  const totalPnlPercent = price == null
    ? null
    : (price - holding.costPrice) / holding.costPrice * 100;
  const stop = holding.alertRules.stopLossPrice;
  const plannedRiskAmount = stop != null && stop < holding.costPrice
    ? (holding.costPrice - stop) * holding.quantity
    : null;
  const stopDistancePercent = price != null && stop != null
    ? (price - stop) / price * 100
    : null;
  const watchDistancePercent = price != null && holding.alertRules.watchPrice != null
    ? (holding.alertRules.watchPrice - price) / price * 100
    : null;
  const violations: RiskViolation[] = [];
  if (dataSafe && marketValue != null && risk.maxPositionValue != null &&
      marketValue > risk.maxPositionValue) {
    violations.push(violation(
      `holding:${holding.securityCode}:position`,
      "breach",
      `${name}超过单一持仓上限`,
      `${formatMoney(marketValue)} > ${formatMoney(risk.maxPositionValue)}`,
      holding.securityCode
    ));
  }
  if (dataSafe && stopDistancePercent != null && stopDistancePercent <= 0) {
    violations.push(violation(
      `holding:${holding.securityCode}:stop`,
      "breach",
      `${name}触及止损线`,
      `现价 ${formatNumber(price)}，止损 ${formatNumber(stop)}`,
      holding.securityCode
    ));
  } else if (dataSafe && stopDistancePercent != null &&
      stopDistancePercent <= risk.stopWarningPercent) {
    violations.push(violation(
      `holding:${holding.securityCode}:near-stop`,
      "warning",
      `${name}接近止损线`,
      `距离 ${formatNumber(stopDistancePercent)}%`,
      holding.securityCode
    ));
  }
  return {
    securityCode: holding.securityCode,
    name,
    price,
    changePercent: quote?.changePercent ?? null,
    marketValue,
    dailyPnl,
    totalPnl,
    totalPnlPercent,
    totalPnlR: ratio(totalPnl, risk.oneR),
    plannedRiskAmount,
    plannedRiskR: ratio(plannedRiskAmount, risk.oneR),
    stopDistancePercent,
    watchDistancePercent,
    groupId: holding.groupId,
    dataSafe,
    violations
  };
}

function calculatePortfolio(
  holdings: HoldingRiskMetrics[],
  risk: RiskSettings
): PortfolioRiskMetrics {
  const dataSafe = holdings.length > 0 && holdings.every((item) => item.dataSafe);
  const marketValue = sumComplete(holdings.map((item) => item.marketValue));
  const dailyPnl = sumComplete(holdings.map((item) => item.dailyPnl));
  const totalPnl = sumComplete(holdings.map((item) => item.totalPnl));
  const exposurePercent = marketValue != null && risk.accountBaseline != null
    ? marketValue / risk.accountBaseline * 100
    : null;
  const violations = holdings.flatMap((item) => item.violations);
  if (risk.maxHoldingCount != null && holdings.length > risk.maxHoldingCount) {
    violations.push(violation(
      "portfolio:holding-count",
      "breach",
      "持仓数量超过上限",
      `${holdings.length} > ${risk.maxHoldingCount}`
    ));
  }
  if (dataSafe && exposurePercent != null && risk.maxTotalExposurePercent != null &&
      exposurePercent > risk.maxTotalExposurePercent) {
    violations.push(violation(
      "portfolio:exposure",
      "breach",
      "总持仓比例超过上限",
      `${formatNumber(exposurePercent)}% > ${formatNumber(risk.maxTotalExposurePercent)}%`
    ));
  }
  if (dataSafe && dailyPnl != null && risk.portfolioDailyLossThreshold != null &&
      dailyPnl <= -risk.portfolioDailyLossThreshold) {
    violations.push(violation(
      "portfolio:daily-loss",
      "breach",
      "持仓合计今日亏损达到停手阈值",
      formatMoney(dailyPnl)
    ));
  }
  return {
    holdingCount: holdings.length,
    marketValue,
    dailyPnl,
    totalPnl,
    dailyPnlR: ratio(dailyPnl, risk.oneR),
    totalPnlR: ratio(totalPnl, risk.oneR),
    exposurePercent,
    dataSafe,
    violations
  };
}

function calculateGroups(
  holdings: HoldingRiskMetrics[],
  risk: RiskSettings
): RiskGroupMetrics[] {
  return risk.groups.map((group) => {
    const members = holdings.filter((holding) => holding.groupId === group.id);
    const dataSafe = members.length > 0 && members.every((item) => item.dataSafe);
    const marketValue = sumComplete(members.map((item) => item.marketValue));
    const dailyPnl = sumComplete(members.map((item) => item.dailyPnl));
    const totalPnl = sumComplete(members.map((item) => item.totalPnl));
    const violations: RiskViolation[] = [];
    if (group.enabled && dataSafe && totalPnl != null && group.profitThreshold != null &&
        totalPnl >= group.profitThreshold) {
      violations.push(groupViolation(group.id, group.name, "profit", totalPnl));
    }
    if (group.enabled && dataSafe && totalPnl != null && group.lossThreshold != null &&
        totalPnl <= -group.lossThreshold) {
      violations.push(groupViolation(group.id, group.name, "loss", totalPnl));
    }
    return {
      id: group.id,
      name: group.name,
      memberCount: members.length,
      marketValue,
      dailyPnl,
      totalPnl,
      dataSafe,
      violations
    };
  });
}

function addHoldingCandidates(
  candidates: AlertCandidate[],
  holding: Holding,
  metric: HoldingRiskMetrics,
  risk: RiskSettings
): void {
  const rules = holding.alertRules;
  const code = holding.securityCode;
  const priceHysteresis = (threshold: number | null) =>
    Math.max(0.01, (threshold ?? 0) * risk.hysteresisPercent / 100);
  addCandidate(candidates, rules.stopLossPrice, {
    ruleId: `holding:${code}:stop-loss`, type: "stop_loss",
    title: `${metric.name}跌破止损线`, message: priceMessage(metric, rules.stopLossPrice),
    securityCode: code, value: metric.price, direction: "below", safe: metric.dataSafe,
    hysteresis: priceHysteresis(rules.stopLossPrice)
  });
  if (rules.stopLossPrice != null && metric.stopDistancePercent != null) {
    addCandidate(candidates, risk.stopWarningPercent, {
      ruleId: `holding:${code}:near-stop`, type: "near_stop",
      title: `${metric.name}进入止损预警区`,
      message: `距止损线 ${formatNumber(metric.stopDistancePercent)}%`,
      securityCode: code, value: metric.stopDistancePercent, direction: "below",
      safe: metric.dataSafe, hysteresis: Math.max(0.1, risk.stopWarningPercent * 0.1)
    });
  }
  if (rules.watchPrice != null) {
    const direction = rules.watchPrice >= holding.costPrice ? "above" : "below";
    addCandidate(candidates, rules.watchPrice, {
      ruleId: `holding:${code}:watch`, type: "watch_price",
      title: `${metric.name}到达观察线`, message: priceMessage(metric, rules.watchPrice),
      securityCode: code, value: metric.price, direction, safe: metric.dataSafe,
      hysteresis: priceHysteresis(rules.watchPrice)
    });
  }
  for (const definition of [
    [rules.priceAbove, "price-above", "price_above", "价格向上突破", metric.price, "above"],
    [rules.priceBelow, "price-below", "price_below", "价格向下跌破", metric.price, "below"],
    [rules.risePercent, "rise", "rise_percent", "今日涨幅达到阈值", metric.changePercent, "above"],
    [rules.fallPercent, "fall", "fall_percent", "今日跌幅达到阈值", metric.changePercent, "below", true],
    [rules.dailyProfitAmount, "daily-profit", "daily_profit", "今日盈利达到阈值", metric.dailyPnl, "above"],
    [rules.dailyLossAmount, "daily-loss", "daily_loss", "今日亏损达到阈值", metric.dailyPnl, "below", true],
    [rules.totalProfitAmount, "total-profit", "total_profit", "累计盈利达到阈值", metric.totalPnl, "above"],
    [rules.totalLossAmount, "total-loss", "total_loss", "累计亏损达到阈值", metric.totalPnl, "below", true]
  ] as const) {
    const [threshold, suffix, type, label, value, direction, negate] = definition;
    addCandidate(candidates, threshold, {
      ruleId: `holding:${code}:${suffix}`,
      type,
      title: `${metric.name}${label}`,
      message: type.includes("price") ? priceMessage(metric, threshold) :
        type.includes("percent") ? percentMessage("今日涨跌", metric.changePercent) :
          moneyMessage("盈亏", value),
      securityCode: code,
      value,
      thresholdTransform: negate ? (item) => -item : undefined,
      direction,
      safe: metric.dataSafe,
      hysteresis: type.includes("price")
        ? priceHysteresis(threshold)
        : type.includes("percent")
          ? Math.max(0.1, (threshold ?? 0) * 0.05)
          : moneyHysteresis(threshold, risk)
    });
  }
}

interface CandidateInput {
  ruleId: string;
  type: AlertRuleType;
  title: string;
  message: string;
  securityCode?: string;
  groupId?: string;
  value: number | null;
  thresholdTransform?: (value: number) => number;
  direction: "above" | "below";
  hysteresis: number;
  safe: boolean;
}

function addCandidate(
  target: AlertCandidate[],
  threshold: number | null,
  input: CandidateInput
): void {
  if (threshold == null || input.value == null || !Number.isFinite(input.value)) return;
  target.push({
    ruleId: input.ruleId,
    type: input.type,
    title: input.title,
    message: input.message,
    ...(input.securityCode ? { securityCode: input.securityCode } : {}),
    ...(input.groupId ? { groupId: input.groupId } : {}),
    value: input.value,
    threshold: input.thresholdTransform ? input.thresholdTransform(threshold) : threshold,
    direction: input.direction,
    hysteresis: input.hysteresis,
    safe: input.safe
  });
}

function isQuoteAlertSafe(quote: Quote | undefined): boolean {
  if (!quote || quote.source === "local") return false;
  const state = quote.quality?.state;
  return state == null || state === "fresh" || state === "fallback";
}

function sumComplete(values: Array<number | null>): number | null {
  return values.length > 0 && values.every((value) => value != null)
    ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
}

function ratio(value: number | null, denominator: number | null): number | null {
  return value != null && denominator != null && denominator > 0 ? value / denominator : null;
}

function finitePositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function violation(
  id: string,
  severity: "warning" | "breach",
  title: string,
  message: string,
  securityCode?: string
): RiskViolation {
  return { id, severity, title, message, ...(securityCode ? { securityCode } : {}) };
}

function groupViolation(
  id: string,
  name: string,
  direction: "profit" | "loss",
  value: number
): RiskViolation {
  return {
    id: `group:${id}:${direction}`,
    severity: "breach",
    title: `${name}合计${direction === "profit" ? "盈利" : "亏损"}达到阈值`,
    message: formatMoney(value),
    groupId: id
  };
}

function moneyHysteresis(threshold: number | null, risk: RiskSettings): number {
  return Math.max(1, (threshold ?? 0) * 0.05, (risk.oneR ?? 0) * 0.02);
}

function priceMessage(metric: HoldingRiskMetrics, threshold: number | null): string {
  return `现价 ${formatNumber(metric.price)}，阈值 ${formatNumber(threshold)}`;
}

function moneyMessage(label: string, value: number | null): string {
  return `${label} ${formatMoney(value)}`;
}

function percentMessage(label: string, value: number | null): string {
  return `${label} ${formatNumber(value)}%`;
}

function formatMoney(value: number | null): string {
  return value == null ? "--" : new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 0,
    signDisplay: "exceptZero"
  }).format(value);
}

function formatNumber(value: number | null): string {
  return value == null ? "--" : value.toFixed(Math.abs(value) >= 100 ? 2 : 3);
}
