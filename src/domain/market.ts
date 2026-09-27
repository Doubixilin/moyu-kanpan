import type { Security } from "../config.js";
import type { DailyCandle, MarketInstrument, MarketOverview, MarketSeries } from "./types.js";

export const DEFAULT_MARKET_INDICES: MarketInstrument[] = [
  { key: "index:SH:000001", kind: "index", code: "000001", market: "SH", name: "上证" },
  { key: "index:SZ:399001", kind: "index", code: "399001", market: "SZ", name: "深证" },
  { key: "index:SZ:399006", kind: "index", code: "399006", market: "SZ", name: "创业板" }
];

export function instrumentKey(
  kind: MarketInstrument["kind"],
  market: MarketInstrument["market"],
  code: string
): string {
  return `${kind}:${market}:${code}`;
}

export function eastmoneySecid(instrument: MarketInstrument): string {
  return `${instrument.market === "SH" ? "1" : "0"}.${instrument.code}`;
}

/**
 * `market:detail` 的 IPC 参数校验：把渲染器传来的不可信对象收窄成行情标的。
 *
 * 指数只允许默认指数表里的项，股票必须在当前配置里——否则渲染器可以借这个通道
 * 请求任意代码。此前写在 `electron/main.ts` 并直接读模块级 `config`
 * （审计报告 §6-4），现在显式传入证券列表，因此可单测。
 */
export function resolveMarketInstrument(value: unknown, securities: Security[]): MarketInstrument {
  if (!value || typeof value !== "object") throw new Error("无效的行情标的");
  const request = value as Record<string, unknown>;
  const kind = request.kind === "index" ? "index" : request.kind === "stock" ? "stock" : null;
  const code = typeof request.code === "string" ? request.code.trim() : "";
  const market =
    request.market === "SH" || request.market === "SZ" || request.market === "BJ"
      ? request.market
      : null;
  if (!kind || !market || !/^\d{6}$/.test(code)) throw new Error("无效的行情标的");

  if (kind === "index") {
    const matched = DEFAULT_MARKET_INDICES.find(
      (item) => item.code === code && item.market === market
    );
    if (!matched) throw new Error("不支持的市场指数");
    return matched;
  }

  const security = securities.find((item) => item.code === code && item.market === market);
  if (!security) throw new Error("股票不在当前配置中");
  return {
    key: instrumentKey("stock", market, code),
    kind: "stock",
    code,
    market,
    name: security.alias || security.name || code
  };
}

export function tencentSymbol(instrument: MarketInstrument): string {
  const prefix = instrument.market === "SH" ? "sh" : instrument.market === "BJ" ? "bj" : "sz";
  return prefix + instrument.code;
}

export function withBoll(candles: DailyCandle[], period = 20, multiplier = 2): DailyCandle[] {
  return candles.map((candle, index) => {
    if (index + 1 < period) return clearBoll(candle);
    const window = candles.slice(index + 1 - period, index + 1).map((item) => item.close);
    const mid = window.reduce((sum, value) => sum + value, 0) / period;
    const variance = window.reduce((sum, value) => sum + (value - mid) ** 2, 0) / period;
    const deviation = Math.sqrt(variance);
    return {
      ...candle,
      bollMid: round(mid),
      bollUpper: round(mid + multiplier * deviation),
      bollLower: round(mid - multiplier * deviation)
    };
  });
}

export function emptyMarketOverview(): MarketOverview {
  return {
    indices: [],
    breadth: { upCount: null, downCount: null, flatCount: null, amount: null },
    sectors: [],
    intraday: emptySeries(),
    source: null,
    stale: true,
    degraded: false,
    updatedAt: null,
    errors: []
  };
}

export function emptySeries<T>(): MarketSeries<T> {
  return { items: [], source: null, stale: true, updatedAt: null, error: null };
}

function clearBoll(candle: DailyCandle): DailyCandle {
  return { ...candle, bollMid: null, bollUpper: null, bollLower: null };
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
