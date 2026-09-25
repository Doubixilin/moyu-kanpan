import type { NewsItem } from "../domain/types.js";
import { fetchWithTimeout } from "./fetch.js";

interface EastmoneyFastNewsItem {
  code?: string;
  title?: string;
  summary?: string;
  showTime?: string;
  realSort?: string;
  stockList?: string[];
}

interface EastmoneyFastNewsPayload {
  data?: {
    fastNewsList?: EastmoneyFastNewsItem[];
  };
}

export function parseEastmoneyFastNews(payload: unknown): NewsItem[] {
  const rows = (payload as EastmoneyFastNewsPayload).data?.fastNewsList;
  if (!Array.isArray(rows)) return [];

  return rows
    .filter((row) => row.code && row.title)
    .map((row) => ({
      id: row.code ?? row.realSort ?? row.title ?? crypto.randomUUID(),
      title: row.title ?? "",
      summary: row.summary,
      url: buildEastmoneyFastNewsUrl(row.code),
      source: "eastmoney",
      sourceTier: "media" as const,
      documentType: "fast_news" as const,
      materialStatus:
        (row.summary?.replace(/\s+/g, "").length ?? 0) >= 40
          ? ("full" as const)
          : ("title_only" as const),
      publishedAt: parseEastmoneyTime(row.showTime),
      fetchedAt: new Date().toISOString(),
      relatedCodes: normalizeRelatedCodes(row.stockList)
    }));
}

function normalizeRelatedCodes(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values.flatMap((value) => {
        const normalized = String(value).trim();
        if (/^\d{6}$/.test(normalized)) return [normalized];
        const secid = normalized.match(/^[01]\.(\d{6})$/);
        return secid ? [secid[1]!] : [];
      })
    )
  ];
}

export async function fetchEastmoneyFastNews(fetcher = fetch, pageSize = 30): Promise<NewsItem[]> {
  const url = new URL("https://np-weblist.eastmoney.com/comm/web/getFastNewsList");
  url.searchParams.set("client", "web");
  url.searchParams.set("biz", "web_724");
  url.searchParams.set("fastColumn", "102");
  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("sortEnd", "0");
  url.searchParams.set("req_trace", "fontendmask");

  const response = await fetchWithTimeout(
    fetcher,
    url,
    {
      headers: {
        Referer: "https://kuaixun.eastmoney.com/",
        "User-Agent": "Mozilla/5.0"
      }
    },
    10_000
  );
  if (!response.ok) throw new Error(`Eastmoney fast news failed: ${response.status}`);
  return parseEastmoneyFastNews(await response.json());
}

function buildEastmoneyFastNewsUrl(code?: string): string {
  if (!code) return "https://kuaixun.eastmoney.com/";
  return `https://finance.eastmoney.com/a/${code}.html`;
}

function parseEastmoneyTime(value?: string): string {
  if (!value) return new Date().toISOString();
  const normalized = value.replace(" ", "T");
  const parsed = new Date(`${normalized}+08:00`);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}
