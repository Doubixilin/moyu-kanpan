import { decode } from "iconv-lite";
import type {
  DailyCandle,
  IntradayPoint,
  MarketIndexQuote,
  MarketInstrument,
  MarketSector
} from "../domain/types.js";
import { eastmoneySecid, tencentSymbol } from "../domain/market.js";
import { fetchWithTimeout } from "./fetch.js";
import {
  asInteger,
  asNumber,
  asRecord,
  asText,
  isoFromUnixSeconds,
  marketFromEastmoneyFlag
} from "./parseUtils.js";

export interface IntradayProviderResult {
  name: string;
  previousClose: number | null;
  items: IntradayPoint[];
  updatedAt: string | null;
}

export interface DailyProviderResult {
  name: string;
  items: DailyCandle[];
  updatedAt: string | null;
}

export async function fetchEastmoneyMarketIndices(
  instruments: MarketInstrument[],
  fetcher = fetch
): Promise<MarketIndexQuote[]> {
  const url = new URL("https://push2.eastmoney.com/api/qt/ulist.np/get");
  url.searchParams.set("fltt", "2");
  url.searchParams.set("invt", "2");
  url.searchParams.set("fields", "f2,f3,f4,f6,f12,f13,f14,f104,f105,f106,f124");
  url.searchParams.set("secids", instruments.map(eastmoneySecid).join(","));
  const response = await fetchWithTimeout(fetcher, url, marketHeaders());
  if (!response.ok) throw new Error(`Eastmoney market indices failed: ${response.status}`);
  return parseEastmoneyMarketIndices(await response.json(), instruments);
}

export async function fetchTencentMarketIndices(
  instruments: MarketInstrument[],
  fetcher = fetch
): Promise<MarketIndexQuote[]> {
  const symbols = instruments.map(tencentSymbol).join(",");
  const response = await fetchWithTimeout(
    fetcher,
    `https://qt.gtimg.cn/q=${symbols}`,
    tencentHeaders()
  );
  if (!response.ok) throw new Error(`Tencent market indices failed: ${response.status}`);
  const text = decode(Buffer.from(await response.arrayBuffer()), "gbk");
  return parseTencentMarketIndices(text, instruments);
}

export async function fetchEastmoneySectors(limit = 5, fetcher = fetch): Promise<MarketSector[]> {
  const url = new URL("https://push2.eastmoney.com/api/qt/clist/get");
  url.searchParams.set("pn", "1");
  url.searchParams.set("pz", String(Math.max(limit * 3, 15)));
  url.searchParams.set("po", "1");
  url.searchParams.set("np", "1");
  url.searchParams.set("fltt", "2");
  url.searchParams.set("invt", "2");
  url.searchParams.set("fid", "f3");
  url.searchParams.set("fs", "m:90+t:2");
  url.searchParams.set("fields", "f12,f14,f2,f3,f6");
  const response = await fetchWithTimeout(fetcher, url, marketHeaders());
  if (!response.ok) throw new Error(`Eastmoney sectors failed: ${response.status}`);
  return parseEastmoneySectors(await response.json(), limit);
}

export async function fetchEastmoneyIntraday(
  instrument: MarketInstrument,
  fetcher = fetch
): Promise<IntradayProviderResult> {
  const url = new URL("https://push2his.eastmoney.com/api/qt/stock/trends2/get");
  url.searchParams.set("secid", eastmoneySecid(instrument));
  url.searchParams.set("fields1", "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13");
  url.searchParams.set("fields2", "f51,f52,f53,f54,f55,f56,f57,f58");
  url.searchParams.set("ndays", "1");
  url.searchParams.set("iscr", "0");
  url.searchParams.set("iscca", "0");
  const response = await fetchWithTimeout(fetcher, url, marketHeaders());
  if (!response.ok) throw new Error(`Eastmoney intraday failed: ${response.status}`);
  return parseEastmoneyIntraday(await response.json());
}

export async function fetchTencentIntraday(
  instrument: MarketInstrument,
  fetcher = fetch
): Promise<IntradayProviderResult> {
  const url = new URL("https://web.ifzq.gtimg.cn/appstock/app/minute/query");
  url.searchParams.set("code", tencentSymbol(instrument));
  const response = await fetchWithTimeout(fetcher, url, tencentHeaders());
  if (!response.ok) throw new Error(`Tencent intraday failed: ${response.status}`);
  return parseTencentIntraday(await response.json(), instrument);
}

export async function fetchEastmoneyDaily(
  instrument: MarketInstrument,
  limit = 120,
  fetcher = fetch
): Promise<DailyProviderResult> {
  const url = new URL("https://push2his.eastmoney.com/api/qt/stock/kline/get");
  url.searchParams.set("secid", eastmoneySecid(instrument));
  url.searchParams.set("klt", "101");
  url.searchParams.set("fqt", instrument.kind === "stock" ? "1" : "0");
  url.searchParams.set("lmt", String(limit));
  url.searchParams.set("end", "20500101");
  url.searchParams.set("fields1", "f1,f2,f3,f4,f5,f6");
  url.searchParams.set("fields2", "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61");
  const response = await fetchWithTimeout(fetcher, url, marketHeaders());
  if (!response.ok) throw new Error(`Eastmoney daily failed: ${response.status}`);
  return parseEastmoneyDaily(await response.json());
}

export async function fetchTencentDaily(
  instrument: MarketInstrument,
  limit = 120,
  fetcher = fetch
): Promise<DailyProviderResult> {
  const adjustment = instrument.kind === "stock" ? "qfq" : "";
  const url = new URL("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get");
  url.searchParams.set("param", `${tencentSymbol(instrument)},day,,,${limit},${adjustment}`);
  const response = await fetchWithTimeout(fetcher, url, tencentHeaders());
  if (!response.ok) throw new Error(`Tencent daily failed: ${response.status}`);
  return parseTencentDaily(await response.json(), instrument);
}

export function parseEastmoneyMarketIndices(
  payload: unknown,
  instruments: MarketInstrument[]
): MarketIndexQuote[] {
  const rows = asRecord(asRecord(payload).data).diff;
  if (!Array.isArray(rows)) return [];
  const byKey = new Map(
    instruments.map((instrument) => [`${instrument.market}:${instrument.code}`, instrument])
  );
  // f13 无法区分深市与北交所（实测北交所也是 0），因此回退到按代码查找，
  // 否则北交所标的会因为 key 变成 "SZ:..." 而查不到、被静默丢弃。
  const byCode = new Map(instruments.map((instrument) => [instrument.code, instrument]));
  const result: MarketIndexQuote[] = [];
  for (const value of rows) {
    const row = asRecord(value);
    const code = asText(row.f12);
    const instrument = byKey.get(`${marketFromEastmoneyFlag(row.f13)}:${code}`) ?? byCode.get(code);
    if (!instrument) continue;
    result.push({
      instrument: { ...instrument, name: asText(row.f14) || instrument.name },
      price: asNumber(row.f2),
      change: asNumber(row.f4),
      changePercent: asNumber(row.f3),
      amount: asNumber(row.f6),
      upCount: asInteger(row.f104),
      downCount: asInteger(row.f105),
      flatCount: asInteger(row.f106),
      updatedAt: isoFromUnixSeconds(row.f124),
      source: "eastmoney"
    });
  }
  return result;
}

export function parseTencentMarketIndices(
  text: string,
  instruments: MarketInstrument[]
): MarketIndexQuote[] {
  const bySymbol = new Map(
    instruments.map((instrument) => [tencentSymbol(instrument), instrument])
  );
  const result: MarketIndexQuote[] = [];
  for (const match of text.matchAll(/v_([a-z]{2}\d{6})="([^"]*)";/gi)) {
    const symbol = match[1]!.toLowerCase();
    const instrument = bySymbol.get(symbol);
    if (!instrument) continue;
    const parts = match[2]!.split("~");
    const composite = (parts[35] ?? "").split("/");
    result.push({
      instrument: { ...instrument, name: parts[1] || instrument.name },
      price: asNumber(parts[3]),
      change: asNumber(parts[31]),
      changePercent: asNumber(parts[32]),
      amount: asNumber(composite[2]),
      upCount: null,
      downCount: null,
      flatCount: null,
      updatedAt: isoFromTencentTimestamp(parts[30]),
      source: "tencent"
    });
  }
  return result;
}

export function parseEastmoneySectors(payload: unknown, limit = 5): MarketSector[] {
  const rows = asRecord(asRecord(payload).data).diff;
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const result: MarketSector[] = [];
  for (const value of rows) {
    const row = asRecord(value);
    const name = normalizeSectorName(asText(row.f14));
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push({
      code: asText(row.f12),
      name,
      price: asNumber(row.f2),
      changePercent: asNumber(row.f3),
      amount: asNumber(row.f6),
      source: "eastmoney"
    });
    if (result.length >= limit) break;
  }
  return result;
}

export function parseEastmoneyIntraday(payload: unknown): IntradayProviderResult {
  const data = asRecord(asRecord(payload).data);
  const rows = Array.isArray(data.trends) ? data.trends : [];
  // 东财给的是"每分钟"成交量/额（实测全天求和等于当日总量），必须累加成当日累计，
  // 否则图表成交量会随主备源切换而改变口径（腾讯那边本身就是累计值）。
  let cumulativeVolume = 0;
  let cumulativeAmount = 0;
  const items: IntradayPoint[] = [];
  for (const value of rows) {
    if (typeof value !== "string") continue;
    const parts = value.split(",");
    const price = asNumber(parts[2]);
    const time = isoFromEastmoneyMinute(parts[0]);
    if (price == null || price <= 0 || !time) continue;
    cumulativeVolume += asNumber(parts[5]) ?? 0;
    cumulativeAmount += asNumber(parts[6]) ?? 0;
    items.push({
      time,
      price,
      average: asNumber(parts[7]),
      volume: cumulativeVolume,
      amount: cumulativeAmount
    });
  }
  return {
    name: asText(data.name),
    previousClose: asNumber(data.preClose),
    items,
    updatedAt: items.at(-1)?.time ?? null
  };
}

export function parseTencentIntraday(
  payload: unknown,
  instrument: MarketInstrument
): IntradayProviderResult {
  const symbolData = asRecord(asRecord(asRecord(payload).data)[tencentSymbol(instrument)]);
  const minuteData = asRecord(symbolData.data);
  const date = asText(minuteData.date);
  const rows = Array.isArray(minuteData.data) ? minuteData.data : [];
  const items: IntradayPoint[] = [];
  for (const value of rows) {
    if (typeof value !== "string") continue;
    const parts = value.trim().split(/\s+/);
    const price = asNumber(parts[1]);
    const time = isoFromTencentMinute(date, parts[0]);
    if (price == null || price <= 0 || !time) continue;
    items.push({
      time,
      price,
      average: null,
      // 腾讯的 volume/amount 已是当日累计值，与东财累加后的口径一致（实测确认）。
      volume: asNumber(parts[2]),
      amount: asNumber(parts[3])
    });
  }
  const quote = asRecord(symbolData.qt)[tencentSymbol(instrument)];
  const quoteParts = Array.isArray(quote) ? quote.map(String) : [];
  return {
    name: quoteParts[1] || instrument.name,
    previousClose: asNumber(quoteParts[4]),
    items,
    updatedAt: items.at(-1)?.time ?? null
  };
}

export function parseEastmoneyDaily(payload: unknown): DailyProviderResult {
  const data = asRecord(asRecord(payload).data);
  const rows = Array.isArray(data.klines) ? data.klines : [];
  const items = rows.flatMap((value): DailyCandle[] => {
    if (typeof value !== "string") return [];
    return parseDailyParts(value.split(","));
  });
  return {
    name: asText(data.name),
    items,
    updatedAt: items.at(-1)?.date ?? null
  };
}

export function parseTencentDaily(
  payload: unknown,
  instrument: MarketInstrument
): DailyProviderResult {
  const symbolData = asRecord(asRecord(asRecord(payload).data)[tencentSymbol(instrument)]);
  const rawRows = Array.isArray(symbolData.qfqday)
    ? symbolData.qfqday
    : Array.isArray(symbolData.day)
      ? symbolData.day
      : [];
  const items = rawRows.flatMap((value): DailyCandle[] => {
    if (!Array.isArray(value)) return [];
    return parseDailyParts(value.map(String));
  });
  const quote = asRecord(symbolData.qt)[tencentSymbol(instrument)];
  const quoteParts = Array.isArray(quote) ? quote.map(String) : [];
  return {
    name: quoteParts[1] || instrument.name,
    items,
    updatedAt: items.at(-1)?.date ?? null
  };
}

function parseDailyParts(parts: string[]): DailyCandle[] {
  const date = parts[0] ?? "";
  const open = asNumber(parts[1]);
  const close = asNumber(parts[2]);
  const high = asNumber(parts[3]);
  const low = asNumber(parts[4]);
  const volume = asNumber(parts[5]);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    open == null ||
    close == null ||
    high == null ||
    low == null ||
    volume == null ||
    open <= 0 ||
    close <= 0 ||
    high < Math.max(open, close, low) ||
    low > Math.min(open, close, high) ||
    volume < 0
  ) {
    return [];
  }
  return [
    {
      date,
      open,
      close,
      high,
      low,
      volume,
      amount: asNumber(parts[6]),
      bollMid: null,
      bollUpper: null,
      bollLower: null
    }
  ];
}

function marketHeaders(): RequestInit {
  return {
    headers: {
      Referer: "https://quote.eastmoney.com/",
      "User-Agent": "Mozilla/5.0"
    }
  };
}

/**
 * 腾讯行情（qt.gtimg.cn / web.ifzq.gtimg.cn）只用 User-Agent。
 * 此前分时与日 K 复用了 marketHeaders()，把东财的 Referer 发给了腾讯域名。
 */
function tencentHeaders(): RequestInit {
  return { headers: { "User-Agent": "Mozilla/5.0" } };
}

function normalizeSectorName(value: string): string {
  return value.replace(/[ⅠⅡⅢ]+$/u, "").trim();
}

function isoFromTencentTimestamp(value: unknown): string | null {
  const text = asText(value);
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(text);
  if (!match) return null;
  return new Date(
    `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+08:00`
  ).toISOString();
}

function isoFromEastmoneyMinute(value: unknown): string | null {
  const text = asText(value);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text)) return null;
  return new Date(text.replace(" ", "T") + ":00+08:00").toISOString();
}

function isoFromTencentMinute(date: string, time: unknown): string | null {
  const hhmm = asText(time);
  if (!/^\d{8}$/.test(date) || !/^\d{4}$/.test(hhmm)) return null;
  return new Date(
    `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00+08:00`
  ).toISOString();
}
