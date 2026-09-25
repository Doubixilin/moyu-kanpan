import type { NewsItem } from "../domain/types.js";
import { shanghaiDateKey } from "../domain/marketClock.js";
import { fetchWithTimeout } from "./fetch.js";

interface SseRow {
  SECURITY_CODE?: string;
  TITLE?: string;
  URL?: string;
  SSEDATE?: string;
  BULLETIN_TYPE?: string;
}

interface SzseRow {
  id?: string;
  annId?: string | number;
  title?: string;
  publishTime?: string;
  attachPath?: string;
  content?: string | null;
  secCode?: string[];
}

export function parseSseAnnouncements(
  payload: unknown,
  fetchedAt = new Date().toISOString()
): NewsItem[] {
  const value = typeof payload === "string" ? unwrapJsonp(payload) : payload;
  const object = value as { result?: SseRow[]; pageHelp?: { data?: SseRow[] } };
  const rows = Array.isArray(object?.result) ? object.result : object?.pageHelp?.data;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row, index) => {
    const code = row.SECURITY_CODE?.trim();
    const title = stripTags(row.TITLE ?? "").trim();
    const url = row.URL?.trim();
    if (!code || !title || !url) return [];
    return [
      {
        id: `sse-${code}-${row.SSEDATE ?? index}-${url}`,
        title,
        url: new URL(url, "https://static.sse.com.cn/").href,
        source: "sse",
        sourceTier: "official" as const,
        documentType: "announcement" as const,
        materialStatus: "title_only" as const,
        publishedAt: parseShanghaiDate(row.SSEDATE, fetchedAt),
        fetchedAt,
        relatedCodes: [code]
      }
    ];
  });
}

export function parseSzseAnnouncements(
  payload: unknown,
  fetchedAt = new Date().toISOString()
): NewsItem[] {
  const rows = (payload as { data?: SzseRow[] })?.data;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row, index) => {
    const code = row.secCode?.[0]?.trim();
    const title = stripTags(row.title ?? "").trim();
    const attachPath = row.attachPath?.trim();
    if (!code || !title || !attachPath) return [];
    const summary = row.content?.trim() || undefined;
    return [
      {
        id: String(row.annId ?? row.id ?? `szse-${code}-${index}`),
        title,
        url: new URL(attachPath, "https://disc.static.szse.cn/").href,
        source: "szse",
        sourceTier: "official" as const,
        documentType: "announcement" as const,
        materialStatus:
          summary && summary.replace(/\s+/g, "").length >= 40
            ? ("full" as const)
            : ("title_only" as const),
        publishedAt: parseShanghaiDate(row.publishTime, fetchedAt),
        fetchedAt,
        summary,
        relatedCodes: [code]
      }
    ];
  });
}

export async function fetchSseAnnouncements(
  code: string,
  fetcher = fetch,
  options: { now?: Date; days?: number; pageSize?: number } = {}
): Promise<NewsItem[]> {
  const now = options.now ?? new Date();
  const start = new Date(now.getTime() - Math.max(1, options.days ?? 7) * 24 * 60 * 60_000);
  const url = new URL("https://query.sse.com.cn/security/stock/queryCompanyBulletin.do");
  const params: Record<string, string> = {
    jsonCallBack: "jsonpCallback",
    isPagination: "true",
    "pageHelp.pageSize": String(Math.max(1, Math.min(30, options.pageSize ?? 10))),
    "pageHelp.pageNo": "1",
    "pageHelp.beginPage": "1",
    "pageHelp.endPage": "5",
    productId: code,
    securityType: "0101,120100,020100,020200,120200",
    reportType2: "ALL",
    reportType: "ALL",
    beginDate: datePart(start),
    endDate: datePart(now),
    _: String(now.getTime())
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetchWithTimeout(
    fetcher,
    url,
    {
      headers: {
        Accept: "application/json, text/plain, */*",
        Referer: "https://www.sse.com.cn/",
        "User-Agent": "Mozilla/5.0"
      }
    },
    10_000
  );
  if (!response.ok) throw new Error(`SSE announcements failed: ${response.status}`);
  return parseSseAnnouncements(await response.text(), now.toISOString());
}

export async function fetchSzseAnnouncements(
  code: string,
  fetcher = fetch,
  options: { now?: Date; days?: number; pageSize?: number } = {}
): Promise<NewsItem[]> {
  const now = options.now ?? new Date();
  const start = new Date(now.getTime() - Math.max(1, options.days ?? 7) * 24 * 60 * 60_000);
  const response = await fetchWithTimeout(
    fetcher,
    new URL("https://www.szse.cn/api/disc/announcement/annList"),
    {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        Referer: "https://www.szse.cn/disclosure/listed/notice/",
        "User-Agent": "Mozilla/5.0"
      },
      body: JSON.stringify({
        seDate: [datePart(start), datePart(now)],
        stock: [code],
        channelCode: ["listedNotice_disc"],
        pageSize: Math.max(1, Math.min(30, options.pageSize ?? 10)),
        pageNum: 1
      })
    },
    10_000
  );
  if (!response.ok) throw new Error(`SZSE announcements failed: ${response.status}`);
  return parseSzseAnnouncements(await response.json(), now.toISOString());
}

function unwrapJsonp(value: string): unknown {
  const start = value.indexOf("(");
  const end = value.lastIndexOf(")");
  if (start < 0 || end <= start) return JSON.parse(value);
  return JSON.parse(value.slice(start + 1, end));
}

function parseShanghaiDate(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const normalized = value.trim().replace(/\./g, "-").replace(" ", "T");
  const hasTime = /T\d{2}:\d{2}/.test(normalized);
  const parsed = new Date(`${normalized}${hasTime ? "+08:00" : "T00:00:00+08:00"}`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function datePart(value: Date): string {
  // 查询窗口用上海日期，不能用 UTC 日期（见 shanghaiDateKey 的说明）。
  return shanghaiDateKey(value);
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}
