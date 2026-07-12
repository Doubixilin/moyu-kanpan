import type { MarketCode, Quote } from "../domain/types.js";
import { decode } from "iconv-lite";
import { fetchWithTimeout } from "./fetch.js";

export function parseTencentQuoteText(text: string): Quote[] {
  const rows = text.matchAll(/v_([a-z]{2})(\d{6})="([^"]*)";/gi);
  return Array.from(rows, ([, marketPrefix, code, body]) => {
    const parts = body.split("~");
    return {
      code,
      name: parts[1] ?? "",
      market: marketFromPrefix(marketPrefix),
      price: asNumber(parts[3]),
      change: asNumber(parts[31]),
      changePercent: asNumber(parts[32]),
      open: asNumber(parts[5]),
      previousClose: asNumber(parts[4]),
      high: asNumber(parts[33]),
      low: asNumber(parts[34]),
      volume: asNumber(parts[36] ?? parts[6]),
      amount: asNumber(parts[45]),
      source: "tencent" as const,
      updatedAt: parseTencentTimestamp(parts[30])
    };
  });
}

export async function fetchTencentQuotes(
  codes: string[],
  fetcher = fetch,
  timeoutMs = 2_500
): Promise<Quote[]> {
  const symbols = codes.map((code) => `${marketPrefixForCode(code)}${code}`).join(",");
  const response = await fetchWithTimeout(fetcher, `https://qt.gtimg.cn/q=${symbols}`, {
    headers: { "User-Agent": "Mozilla/5.0" }
  }, timeoutMs);
  if (!response.ok) throw new Error(`Tencent quotes failed: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return parseTencentQuoteText(decode(buffer, "gbk"));
}

export function marketPrefixForCode(code: string): "sh" | "sz" | "bj" {
  if (/^(5|6|9)/.test(code)) return "sh";
  if (/^(4|8)/.test(code)) return "bj";
  return "sz";
}

function marketFromPrefix(prefix: string): MarketCode {
  if (prefix.toLowerCase() === "sh") return "SH";
  if (prefix.toLowerCase() === "sz") return "SZ";
  if (prefix.toLowerCase() === "bj") return "BJ";
  return "UNKNOWN";
}

function parseTencentTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match;
  const utcMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour) - 8,
    Number(minute),
    Number(second)
  );
  return new Date(utcMs).toISOString();
}


function asNumber(value: unknown): number | null {
  if (value === "-" || value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
