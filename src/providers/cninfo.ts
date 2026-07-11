import type { NewsItem } from "../domain/types.js";
import { fetchWithTimeout } from "./fetch.js";

interface CninfoAnnouncement {
  announcementId?: string;
  announcementTitle?: string;
  announcementTime?: number;
  adjunctUrl?: string;
  secCode?: string;
}

interface CninfoPayload {
  announcements?: CninfoAnnouncement[] | null;
}

export function parseCninfoAnnouncements(payload: unknown, fetchedAt = new Date().toISOString()): NewsItem[] {
  const rows = (payload as CninfoPayload)?.announcements;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const code = row.secCode?.trim();
    const title = decodeHtml(stripTags(row.announcementTitle ?? "")).trim();
    const relativeUrl = row.adjunctUrl?.trim();
    if (!code || !title || !relativeUrl) return [];
    const publishedAt = typeof row.announcementTime === "number"
      ? new Date(row.announcementTime).toISOString()
      : fetchedAt;
    return [{
      id: row.announcementId ?? `${code}-${row.announcementTime ?? title}`,
      title,
      url: new URL(relativeUrl, "https://static.cninfo.com.cn/").href,
      source: "cninfo",
      sourceTier: "official" as const,
      documentType: "announcement" as const,
      materialStatus: "title_only" as const,
      publishedAt,
      fetchedAt,
      relatedCodes: [code]
    }];
  });
}

export async function fetchCninfoAnnouncements(
  code: string,
  fetcher = fetch,
  options: { now?: Date; days?: number; pageSize?: number } = {}
): Promise<NewsItem[]> {
  const now = options.now ?? new Date();
  const days = Math.max(1, Math.min(30, Math.floor(options.days ?? 7)));
  const start = new Date(now.getTime() - days * 24 * 60 * 60_000);
  const market = cninfoMarket(code);
  const body = new URLSearchParams({
    pageNum: "1",
    pageSize: String(Math.max(1, Math.min(30, options.pageSize ?? 10))),
    column: market.column,
    tabName: "fulltext",
    plate: market.plate,
    stock: `${code},${market.orgId}`,
    searchkey: "",
    secid: "",
    category: "",
    trade: "",
    seDate: `${datePart(start)}~${datePart(now)}`,
    sortName: "",
    sortType: "",
    isHLtitle: "true"
  });
  const response = await fetchWithTimeout(fetcher, new URL(
    "https://www.cninfo.com.cn/new/hisAnnouncement/query"
  ), {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: `https://www.cninfo.com.cn/new/disclosure/stock?stockCode=${code}&orgId=${market.orgId}`,
      "User-Agent": "Mozilla/5.0"
    },
    body
  }, 10_000);
  if (!response.ok) throw new Error(`Cninfo announcements failed: ${response.status}`);
  return parseCninfoAnnouncements(await response.json(), now.toISOString());
}

function cninfoMarket(code: string): { column: string; plate: string; orgId: string } {
  if (code.startsWith("6")) return { column: "sse", plate: "sh", orgId: `gssh0${code}` };
  if (code.startsWith("0") || code.startsWith("3")) {
    return { column: "szse", plate: "sz", orgId: `gssz0${code}` };
  }
  return { column: "bse", plate: "bj", orgId: code };
}

function datePart(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}
