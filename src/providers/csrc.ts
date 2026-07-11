import type { NewsItem } from "../domain/types.js";
import { fetchWithTimeout } from "./fetch.js";

const CSRC_LIST_URL = "https://www.csrc.gov.cn/csrc/c100028/common_list.shtml";

export function parseCsrcPolicyList(
  html: string,
  fetchedAt = new Date().toISOString(),
  limit = 20
): NewsItem[] {
  const items: NewsItem[] = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']*\/csrc\/c100028\/c\d+\/content\.shtml)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const title = decodeHtml(match[2]!.replace(/<[^>]*>/g, "").replace(/\s+/g, " ")).trim();
    if (!title) continue;
    const tail = html.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 200);
    const date = tail.match(/20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/)?.[0];
    const url = new URL(match[1]!, CSRC_LIST_URL).href;
    items.push({
      id: `csrc-${url.match(/c(\d+)\/content/)?.[1] ?? url}`,
      title,
      url,
      source: "csrc",
      sourceTier: "regulatory",
      documentType: "policy",
      materialStatus: "title_only",
      publishedAt: parseDate(date, fetchedAt),
      fetchedAt,
      relatedCodes: []
    });
    if (items.length >= limit) break;
  }
  return items;
}

export async function fetchCsrcPolicyNews(fetcher = fetch, limit = 20): Promise<NewsItem[]> {
  const fetchedAt = new Date().toISOString();
  const response = await fetchWithTimeout(fetcher, new URL(CSRC_LIST_URL), {
    headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "Mozilla/5.0" }
  }, 10_000);
  if (!response.ok) throw new Error(`CSRC policy news failed: ${response.status}`);
  return parseCsrcPolicyList(await response.text(), fetchedAt, limit);
}

function parseDate(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const normalized = value.replace(/[/.]/g, "-");
  const parsed = new Date(`${normalized}T00:00:00+08:00`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function decodeHtml(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"");
}
