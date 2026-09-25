import type { UserSettings } from "../config.js";

export type MarketCode = "SH" | "SZ" | "BJ" | "UNKNOWN";
export type DataSource = "eastmoney" | "tencent" | "official" | "mixed" | "local";
export type LiveQuoteSource = "eastmoney" | "tencent";
export type QuoteQualityState = "fresh" | "fallback" | "stale" | "retained" | "conflict";
export type MarketSessionState = "trading" | "preopen" | "lunch" | "closed" | "holiday" | "weekend";

export interface QuoteQuality {
  state: QuoteQualityState;
  receivedAt: string;
  reasons: string[];
  originalSource?: LiveQuoteSource;
}

export interface ProviderHealth {
  provider: LiveQuoteSource;
  successRate: number;
  completenessRate: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  freshnessRate: number;
  parseFailureRate: number;
  conflictRate: number;
  consecutiveFailures: number;
  circuitState: "closed" | "open" | "half-open";
}

export interface Quote {
  code: string;
  name: string;
  market: MarketCode;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  previousClose: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  amount: number | null;
  mainInflow?: number | null;
  source: DataSource;
  updatedAt?: string;
  quality?: QuoteQuality;
}

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary?: string;
  relatedCodes?: string[];
  sourceTier?: NewsSourceTier;
  documentType?: NewsDocumentType;
  materialStatus?: NewsMaterialStatus;
  fetchedAt?: string;
  eventId?: string;
  documentCount?: number;
  sources?: string[];
  firstSeenAt?: string;
  lastUpdatedAt?: string;
}

export type NewsSourceTier = "official" | "regulatory" | "media";
export type NewsDocumentType = "announcement" | "policy" | "fast_news";
export type NewsMaterialStatus = "full" | "title_only" | "unavailable";

export interface NewsSourceState {
  source: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  nextRetryAt: string | null;
}

export type AlertPriority = "low" | "medium" | "high";
export type NewsEventType =
  "earnings" | "policy" | "order" | "management" | "capital" | "industry" | "market" | "other";
export type NewsRelation = "direct" | "industry" | "market" | "uncertain";
export type NewsDirection = "positive" | "negative" | "neutral" | "mixed";
export type NewsHorizon = "intraday" | "short" | "medium" | "long";
export type NewsAnalysisStatus = "analyzed" | "rule_fallback";

export interface NewsAnalysis {
  newsId: string;
  priority: AlertPriority;
  status: NewsAnalysisStatus;
  useful: boolean;
  eventType: NewsEventType;
  relatedCodes: string[];
  sourceRelatedCodes: string[];
  inferredRelatedCodes: string[];
  relation: NewsRelation;
  direction: NewsDirection;
  horizon: NewsHorizon;
  importance: number;
  confidence: number;
  modelConfidence: number | null;
  materialLimited: boolean;
  summary: string;
  mechanism: string;
  evidence: string[];
  counterFactors: string[];
  missingInformation: string[];
  matchedKeywords: string[];
  analyzedAt: string;
  provider: "rules" | "ai";
  model?: string;
  failureReason?: string;
}

export type AiConnectionState = "unconfigured" | "ready" | "testing" | "success" | "error";
export type AiCredentialSource = "secure" | "environment" | "none";

export interface AiRuntimeStatus {
  enabled: boolean;
  configured: boolean;
  secureStorageAvailable: boolean;
  credentialSource: AiCredentialSource;
  state: AiConnectionState;
  provider: UserSettings["ai"]["provider"];
  model: string;
  lastTestedAt: string | null;
  lastSuccessAt: string | null;
  message: string;
}

export interface FeedStatus {
  lastSuccessAt: string | null;
  dataUpdatedAt: string | null;
  lastChangedAt: string | null;
  stale: boolean;
  stalled: boolean;
  source: DataSource | null;
  coverage: number | null;
  degraded: boolean;
  conflictCount: number;
  retainedCount: number;
  missingCount: number;
  alertSafe: boolean;
  providerHealth: ProviderHealth[];
  marketState: MarketSessionState | null;
}

export type MarketInstrumentKind = "index" | "stock";

export interface MarketInstrumentRequest {
  kind: MarketInstrumentKind;
  code: string;
  market: Exclude<MarketCode, "UNKNOWN">;
}

export interface MarketInstrument extends MarketInstrumentRequest {
  key: string;
  name: string;
}

export interface MarketIndexQuote {
  instrument: MarketInstrument;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  amount: number | null;
  upCount: number | null;
  downCount: number | null;
  flatCount: number | null;
  updatedAt: string | null;
  source: LiveQuoteSource;
}

export interface MarketSector {
  code: string;
  name: string;
  price: number | null;
  changePercent: number | null;
  amount: number | null;
  source: LiveQuoteSource;
}

export interface MarketBreadth {
  upCount: number | null;
  downCount: number | null;
  flatCount: number | null;
  amount: number | null;
}

export interface IntradayPoint {
  time: string;
  price: number;
  average: number | null;
  /**
   * 当日**累计**成交量（手），不是该分钟的成交量。
   *
   * 两个来源的原始口径不同，解析时必须对齐（已实测确认）：
   * 东财 `trends2` 的 `parts[5]` 是每分钟成交量（全天求和恰好等于当日总量），
   * 需要在解析时累加；腾讯 `minute/query` 的 `parts[2]` 本身已是累计值，直接用。
   * 两边最终都必须是累计值，图表成交量才不随 fallback 换源而变化。
   */
  volume: number | null;
  /** 当日**累计**成交额（元），口径同上。 */
  amount: number | null;
}

export interface DailyCandle {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number | null;
  bollMid: number | null;
  bollUpper: number | null;
  bollLower: number | null;
}

export interface MarketSeries<T> {
  items: T[];
  source: DataSource | null;
  stale: boolean;
  updatedAt: string | null;
  error: string | null;
}

export interface MarketOverview {
  indices: MarketIndexQuote[];
  breadth: MarketBreadth;
  sectors: MarketSector[];
  intraday: MarketSeries<IntradayPoint>;
  source: DataSource | null;
  stale: boolean;
  degraded: boolean;
  updatedAt: string | null;
  errors: string[];
}

export interface MarketDetail {
  instrument: MarketInstrument;
  intraday: MarketSeries<IntradayPoint>;
  daily: MarketSeries<DailyCandle>;
  fetchedAt: string;
}
export type RiskViolationSeverity = "warning" | "breach";

export interface RiskViolation {
  id: string;
  severity: RiskViolationSeverity;
  title: string;
  message: string;
  securityCode?: string;
  groupId?: string;
}

export interface HoldingRiskMetrics {
  securityCode: string;
  name: string;
  price: number | null;
  changePercent: number | null;
  marketValue: number | null;
  dailyPnl: number | null;
  totalPnl: number | null;
  totalPnlPercent: number | null;
  totalPnlR: number | null;
  plannedRiskAmount: number | null;
  plannedRiskR: number | null;
  stopDistancePercent: number | null;
  watchDistancePercent: number | null;
  groupId: string;
  dataSafe: boolean;
  violations: RiskViolation[];
}

export interface RiskGroupMetrics {
  id: string;
  name: string;
  memberCount: number;
  marketValue: number | null;
  dailyPnl: number | null;
  totalPnl: number | null;
  dataSafe: boolean;
  violations: RiskViolation[];
}

export interface PortfolioRiskMetrics {
  holdingCount: number;
  marketValue: number | null;
  dailyPnl: number | null;
  totalPnl: number | null;
  dailyPnlR: number | null;
  totalPnlR: number | null;
  exposurePercent: number | null;
  dataSafe: boolean;
  violations: RiskViolation[];
}

export type AlertRuleType =
  | "stop_loss"
  | "watch_price"
  | "price_above"
  | "price_below"
  | "rise_percent"
  | "fall_percent"
  | "daily_profit"
  | "daily_loss"
  | "total_profit"
  | "total_loss"
  | "near_stop"
  | "position_value"
  | "holding_count"
  | "exposure"
  | "portfolio_daily_profit"
  | "portfolio_daily_loss"
  | "group_profit"
  | "group_loss";

export interface AlertEvent {
  id: string;
  ruleId: string;
  type: AlertRuleType;
  title: string;
  message: string;
  securityCode?: string;
  groupId?: string;
  value: number;
  threshold: number;
  triggeredAt: string;
  mode: "shadow" | "active";
}

export interface RiskSnapshot {
  mode: "shadow" | "active";
  paused: boolean;
  pausedThroughDate: string | null;
  dataSafe: boolean;
  holdings: HoldingRiskMetrics[];
  groups: RiskGroupMetrics[];
  portfolio: PortfolioRiskMetrics;
  recentEvents: AlertEvent[];
  updatedAt: string;
}
export interface AppSnapshot {
  quotes: Quote[];
  news: Array<NewsItem & { analysis?: NewsAnalysis }>;
  market: MarketOverview;
  risk: RiskSnapshot;
  ai: AiRuntimeStatus;
  errors: string[];
  updatedAt: string;
  settings: UserSettings;
  feeds: {
    quotes: FeedStatus;
    news: FeedStatus;
  };
  ui: {
    clickThrough: boolean;
  };
}
