import type { MarketCode, Quote } from "../domain/types.js";
import { fetchWithTimeout } from "./fetch.js";

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

export function buildEastmoneySecid(code: string): string {
  const normalized = code.trim();
  if (/^(5|6|9)/.test(normalized)) return `1.${normalized}`;
  if (/^(0|2|3)/.test(normalized)) return `0.${normalized}`;
  if (/^(4|8)/.test(normalized)) return `0.${normalized}`;
  return normalized;
}

export function parseEastmoneyQuoteList(payload: unknown): Quote[] {
  const data = payload as { data?: { diff?: EastmoneyDiff[] } };
  const rows = data.data?.diff;
  if (!Array.isArray(rows)) return [];

  return rows.map((row) => ({
    code: asString(row.f12),
    name: asString(row.f14),
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

export async function fetchEastmoneyQuotes(codes: string[], fetcher = fetch): Promise<Quote[]> {
  const secids = codes.map(buildEastmoneySecid).join(",");
  const url = new URL("https://push2.eastmoney.com/api/qt/ulist.np/get");
  url.searchParams.set("fltt", "2");
  url.searchParams.set("invt", "2");
  url.searchParams.set("fields", EASTMONEY_FIELDS);
  url.searchParams.set("secids", secids);

  const response = await fetchWithTimeout(fetcher, url, {
    headers: {
      Referer: "https://quote.eastmoney.com/",
      "User-Agent": "Mozilla/5.0"
    }
  });
  if (!response.ok) throw new Error(`Eastmoney quotes failed: ${response.status}`);
  return parseEastmoneyQuoteList(await response.json());
}

function marketFromEastmoney(value: unknown): MarketCode {
  if (value === 1 || value === "1") return "SH";
  if (value === 0 || value === "0") return "SZ";
  if (value === 2 || value === "2") return "BJ";
  return "UNKNOWN";
}

function asIsoFromUnixSeconds(value: unknown): string | undefined {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return new Date(seconds * 1000).toISOString();
}


function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function asNumber(value: unknown): number | null {
  if (value === "-" || value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
