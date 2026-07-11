import type {
  DailyCandle,
  MarketInstrument,
  MarketOverview,
  MarketSeries
} from "./types.js";

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

export function tencentSymbol(instrument: MarketInstrument): string {
  const prefix = instrument.market === "SH" ? "sh" :
    instrument.market === "BJ" ? "bj" : "sz";
  return prefix + instrument.code;
}

export function withBoll(
  candles: DailyCandle[],
  period = 20,
  multiplier = 2
): DailyCandle[] {
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