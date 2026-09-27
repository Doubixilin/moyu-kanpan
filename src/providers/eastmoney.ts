import type { MarketCode, Quote, QuoteRequest } from "../domain/types.js";
import { fetchWithTimeout } from "./fetch.js";
import { asNumber, asText, isoFromUnixSeconds, marketFromEastmoneyFlag } from "./parseUtils.js";

type EastmoneyDiff = Record<string, unknown>;

const EASTMONEY_FIELDS = [
  "f2",
  "f3",
  "f4",
  "f5",
  "f6",
  "f12",
  "f13",
  "f14",
  "f15",
  "f16",
  "f17",
  "f18",
  "f62",
  "f124"
].join(",");

/**
 * 东财 secid：`1.` 沪市 / `0.` 深市与北交所。
 *
 * 传了 `market` 就以它为准（审计报告 §3-2：显式市场必须能贯穿到 provider），
 * 没传才按代码前缀推断——回退路径保留给测试与直接调用方。
 */
export function buildEastmoneySecid(code: string, market?: MarketCode): string {
  const normalized = code.trim();
  if (market === "SH") return `1.${normalized}`;
  if (market === "SZ" || market === "BJ") return `0.${normalized}`;
  // 北交所（43/83/87/88xxxx 与 920xxx）在东财沿用 0. 前缀。
  if (/^(4|8)/.test(normalized) || /^920/.test(normalized)) return `0.${normalized}`;
  // 沪市：60/68、5xxxxx 基金，以及 900xxx B 股。
  if (/^(5|6)/.test(normalized) || /^900/.test(normalized)) return `1.${normalized}`;
  if (/^(0|2|3)/.test(normalized)) return `0.${normalized}`;
  return normalized;
}

export function parseEastmoneyQuoteList(payload: unknown): Quote[] {
  const data = payload as { data?: { diff?: EastmoneyDiff[] } };
  const rows = data.data?.diff;
  if (!Array.isArray(rows)) return [];

  return rows.map((row) => ({
    code: asText(row.f12),
    name: asText(row.f14),
    market: marketFromEastmoney(row.f13),
    price: asNumber(row.f2),
    change: asNumber(row.f4),
    changePercent: asNumber(row.f3),
    open: asNumber(row.f17),
    previousClose: asNumber(row.f18),
    high: asNumber(row.f15),
    low: asNumber(row.f16),
    volume: asNumber(row.f5),
    amount: asNumber(row.f6),
    mainInflow: asNumber(row.f62),
    source: "eastmoney" as const,
    updatedAt: asIsoFromUnixSeconds(row.f124)
  }));
}

export async function fetchEastmoneyQuotes(
  requests: QuoteRequest[],
  fetcher = fetch,
  timeoutMs = 2_500
): Promise<Quote[]> {
  const secids = requests
    .map((request) => buildEastmoneySecid(request.code, request.market))
    .join(",");
  const url = new URL("https://push2.eastmoney.com/api/qt/ulist.np/get");
  url.searchParams.set("fltt", "2");
  url.searchParams.set("invt", "2");
  url.searchParams.set("fields", EASTMONEY_FIELDS);
  url.searchParams.set("secids", secids);

  const response = await fetchWithTimeout(
    fetcher,
    url,
    {
      headers: {
        Referer: "https://quote.eastmoney.com/",
        "User-Agent": "Mozilla/5.0"
      }
    },
    timeoutMs
  );
  if (!response.ok) throw new Error(`Eastmoney quotes failed: ${response.status}`);
  return parseEastmoneyQuoteList(await response.json());
}

function marketFromEastmoney(value: unknown): MarketCode {
  return marketFromEastmoneyFlag(value);
}

function asIsoFromUnixSeconds(value: unknown): string | undefined {
  return isoFromUnixSeconds(value) ?? undefined;
}
