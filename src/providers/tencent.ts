import type { MarketCode, Quote, QuoteRequest } from "../domain/types.js";
import { decode } from "iconv-lite";
import { fetchWithTimeout } from "./fetch.js";
import { asNumber } from "./parseUtils.js";

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
      // 实测腾讯行情字段布局（2026-09 校验真实响应）：
      //   [37] = 成交额（万元）  [45] = 总市值（亿元）  [35] 第 3 段 = 成交额（元）
      // 此前读的是 parts[45]，会把总市值当成成交额显示（相差数个数量级）。
      amount: amountFromWan(parts[37]),
      source: "tencent" as const,
      updatedAt: parseTencentTimestamp(parts[30])
    };
  });
}

export async function fetchTencentQuotes(
  requests: QuoteRequest[],
  fetcher = fetch,
  timeoutMs = 2_500
): Promise<Quote[]> {
  const symbols = requests
    .map((request) => `${marketPrefixForCode(request.code, request.market)}${request.code}`)
    .join(",");
  const response = await fetchWithTimeout(
    fetcher,
    `https://qt.gtimg.cn/q=${symbols}`,
    {
      headers: { "User-Agent": "Mozilla/5.0" }
    },
    timeoutMs
  );
  if (!response.ok) throw new Error(`Tencent quotes failed: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return parseTencentQuoteText(decode(buffer, "gbk"));
}

/**
 * 腾讯行情前缀：`sh` / `sz` / `bj`。
 *
 * 传了 `market` 就以它为准（审计报告 §3-2），没传才按代码前缀推断。
 */
export function marketPrefixForCode(code: string, market?: MarketCode): "sh" | "sz" | "bj" {
  if (market === "SH") return "sh";
  if (market === "SZ") return "sz";
  if (market === "BJ") return "bj";
  // 北交所：43/83/87/88xxxx 老代码，以及 920xxx 新代码（实测 bj920099 有数据、
  // sh920099 无数据）。
  if (/^(4|8)/.test(code) || /^920/.test(code)) return "bj";
  // 沪市：60/68、5xxxxx 基金，以及 900xxx B 股。
  if (/^(5|6)/.test(code) || /^900/.test(code)) return "sh";
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

/** 腾讯行情的成交额字段以万元为单位，统一换算成"元"（与东财口径一致）。 */
function amountFromWan(value: unknown): number | null {
  const wan = asNumber(value);
  return wan == null ? null : wan * 10_000;
}
