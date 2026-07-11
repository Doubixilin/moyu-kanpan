import type { NewsAnalysis, NewsItem } from "../domain/types.js";
import { fetchCninfoAnnouncements } from "../providers/cninfo.js";
import { fetchCsrcPolicyNews } from "../providers/csrc.js";
import { fetchEastmoneyFastNews } from "../providers/eastmoneyNews.js";
import { fetchSseAnnouncements, fetchSzseAnnouncements } from "../providers/exchangeAnnouncements.js";
import { SqliteNewsEventStore } from "./newsEvents.js";

export interface NewsProviderSet {
  media: () => Promise<NewsItem[]>;
  fallbackMedia?: () => Promise<NewsItem[]>;
  cninfo: (code: string, now: Date) => Promise<NewsItem[]>;
  sse: (code: string, now: Date) => Promise<NewsItem[]>;
  szse: (code: string, now: Date) => Promise<NewsItem[]>;
  policy: () => Promise<NewsItem[]>;
}

export interface NewsRefreshResult {
  items: Array<NewsItem & { analysis?: NewsAnalysis }>;
  errors: string[];
  sources: string[];
  degraded: boolean;
  attempted: boolean;
  liveSuccess: boolean;
  fetchedAt: string;
}

export class NewsDataCoordinator {
  private lastOfficialAttemptAt = 0;
  private lastPolicyAttemptAt = 0;
  private lastMaintenanceAt = 0;

  constructor(
    private readonly store: SqliteNewsEventStore,
    private readonly providers: NewsProviderSet = defaultProviders(),
    private readonly intervals = { officialMs: 5 * 60_000, policyMs: 15 * 60_000 }
  ) {}

  async refresh(codes: string[], options: {
    now?: Date;
    limit?: number;
    analysisNamespace?: string;
  } = {}): Promise<NewsRefreshResult> {
    const now = options.now ?? new Date();
    const errors: string[] = [];
    const sources = new Set<string>();
    const attemptedSources = new Set<string>();
    const documents: NewsItem[] = [];

    await this.fetchMedia(documents, errors, sources, attemptedSources, now);
    if (now.getTime() - this.lastOfficialAttemptAt >= this.intervals.officialMs) {
      this.lastOfficialAttemptAt = now.getTime();
      await this.fetchOfficial(
        [...new Set(codes)].slice(0, 50), documents, errors, sources, attemptedSources, now
      );
    }
    if (now.getTime() - this.lastPolicyAttemptAt >= this.intervals.policyMs &&
        this.store.sourceDue("csrc", now)) {
      this.lastPolicyAttemptAt = now.getTime();
      await this.fetchPolicy(documents, errors, sources, attemptedSources, now);
    }

    if (documents.length) this.store.ingest(documents, now);
    if (now.getTime() - this.lastMaintenanceAt >= 24 * 60 * 60_000) {
      this.lastMaintenanceAt = now.getTime();
      this.store.pruneBefore(new Date(now.getTime() - 30 * 24 * 60 * 60_000));
    }
    const since = new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString();
    const items = this.store.listEvents({
      limit: options.limit ?? 200,
      since,
      analysisNamespace: options.analysisNamespace
    });
    if (!items.length && errors.length) throw new Error(errors.join(" | "));
    return {
      items,
      errors,
      sources: [...sources],
      degraded: errors.length > 0,
      attempted: attemptedSources.size > 0,
      liveSuccess: sources.size > 0,
      fetchedAt: now.toISOString()
    };
  }

  private async fetchMedia(
    documents: NewsItem[], errors: string[], sources: Set<string>,
    attempted: Set<string>, now: Date
  ): Promise<void> {
    if (!this.store.sourceDue("eastmoney", now)) return;
    attempted.add("eastmoney");
    try {
      const items = await this.providers.media();
      if (!items.length) throw new Error("empty response");
      documents.push(...items);
      sources.add("eastmoney");
      this.store.recordSourceSuccess("eastmoney", now);
    } catch (error) {
      this.store.recordSourceFailure("eastmoney", error, now);
      errors.push(`eastmoney:${message(error)}`);
      if (!this.providers.fallbackMedia) return;
      attempted.add("media-fallback");
      try {
        const items = await this.providers.fallbackMedia();
        if (!items.length) throw new Error("empty response");
        documents.push(...items);
        sources.add("media-fallback");
        this.store.recordSourceSuccess("media-fallback", now);
      } catch (fallbackError) {
        this.store.recordSourceFailure("media-fallback", fallbackError, now);
        errors.push(`media-fallback:${message(fallbackError)}`);
      }
    }
  }

  private async fetchOfficial(
    codes: string[], documents: NewsItem[], errors: string[], sources: Set<string>,
    attempted: Set<string>, now: Date
  ): Promise<void> {
    if (!codes.length || !this.store.sourceDue("cninfo", now)) return;
    attempted.add("cninfo");
    let cninfoSuccesses = 0;
    const results = await mapLimit(codes, 4, async (code) => {
      try {
        const items = await this.providers.cninfo(code, now);
        cninfoSuccesses += 1;
        return items;
      } catch (error) {
        errors.push(`cninfo:${code}:${message(error)}`);
        try {
          if (code.startsWith("6")) {
            const items = await this.providers.sse(code, now);
            sources.add("sse");
            return items;
          }
          if (code.startsWith("0") || code.startsWith("3")) {
            const items = await this.providers.szse(code, now);
            sources.add("szse");
            return items;
          }
        } catch (fallbackError) {
          errors.push(`exchange:${code}:${message(fallbackError)}`);
        }
        return [];
      }
    });
    documents.push(...results.flat());
    if (cninfoSuccesses > 0) {
      sources.add("cninfo");
      this.store.recordSourceSuccess("cninfo", now);
    } else {
      this.store.recordSourceFailure("cninfo", new Error("all tracked-code requests failed"), now);
    }
  }

  private async fetchPolicy(
    documents: NewsItem[], errors: string[], sources: Set<string>,
    attempted: Set<string>, now: Date
  ): Promise<void> {
    attempted.add("csrc");
    try {
      const items = await this.providers.policy();
      if (!items.length) throw new Error("empty response");
      documents.push(...items);
      sources.add("csrc");
      this.store.recordSourceSuccess("csrc", now);
    } catch (error) {
      this.store.recordSourceFailure("csrc", error, now);
      errors.push(`csrc:${message(error)}`);
    }
  }
}

function defaultProviders(): NewsProviderSet {
  return {
    media: () => fetchEastmoneyFastNews(),
    cninfo: (code, now) => fetchCninfoAnnouncements(code, fetch, { now }),
    sse: (code, now) => fetchSseAnnouncements(code, fetch, { now }),
    szse: (code, now) => fetchSzseAnnouncements(code, fetch, { now }),
    policy: () => fetchCsrcPolicyNews()
  };
}

async function mapLimit<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const result = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      result[index] = await run(items[index]!);
    }
  });
  await Promise.all(workers);
  return result;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
