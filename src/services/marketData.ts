import { readFile } from "node:fs/promises";
import { atomicWriteText } from "./atomicFile.js";
import {
  DEFAULT_MARKET_INDICES,
  emptyMarketOverview,
  emptySeries,
  withBoll
} from "../domain/market.js";
import type {
  DailyCandle,
  DataSource,
  IntradayPoint,
  LiveQuoteSource,
  MarketBreadth,
  MarketDetail,
  MarketIndexQuote,
  MarketInstrument,
  MarketOverview,
  MarketSector,
  MarketSeries
} from "../domain/types.js";
import {
  fetchEastmoneyDaily,
  fetchEastmoneyIntraday,
  fetchEastmoneyMarketIndices,
  fetchEastmoneySectors,
  fetchTencentDaily,
  fetchTencentIntraday,
  fetchTencentMarketIndices,
  type DailyProviderResult,
  type IntradayProviderResult
} from "../providers/market.js";

export interface MarketFetchContext {
  marketOpen: boolean;
  nowMs?: number;
  maxSourceAgeMs?: number;
}

export interface MarketProviderSet {
  eastmoneyIndices: (instruments: MarketInstrument[]) => Promise<MarketIndexQuote[]>;
  tencentIndices: (instruments: MarketInstrument[]) => Promise<MarketIndexQuote[]>;
  eastmoneySectors: (limit: number) => Promise<MarketSector[]>;
  eastmoneyIntraday: (instrument: MarketInstrument) => Promise<IntradayProviderResult>;
  tencentIntraday: (instrument: MarketInstrument) => Promise<IntradayProviderResult>;
  eastmoneyDaily: (instrument: MarketInstrument, limit: number) => Promise<DailyProviderResult>;
  tencentDaily: (instrument: MarketInstrument, limit: number) => Promise<DailyProviderResult>;
}

export interface CachedValue<T> {
  savedAt: string;
  value: T;
}

export interface CachedMarketDetail {
  name: string;
  intraday?: CachedValue<MarketSeries<IntradayPoint>>;
  daily?: CachedValue<MarketSeries<DailyCandle>>;
}

export interface MarketCacheData {
  version: 1;
  overview?: CachedValue<MarketOverview>;
  details: Record<string, CachedMarketDetail>;
}

export interface MarketCacheStore {
  read: () => Promise<MarketCacheData | null>;
  write: (value: MarketCacheData) => Promise<void>;
}

export interface MarketDataOptions {
  overviewSectorLimit?: number;
  intradayTtlMs?: number;
  dailyTtlMs?: number;
}

const defaultProviders: MarketProviderSet = {
  eastmoneyIndices: (instruments) => fetchEastmoneyMarketIndices(instruments),
  tencentIndices: (instruments) => fetchTencentMarketIndices(instruments),
  eastmoneySectors: (limit) => fetchEastmoneySectors(limit),
  eastmoneyIntraday: (instrument) => fetchEastmoneyIntraday(instrument),
  tencentIntraday: (instrument) => fetchTencentIntraday(instrument),
  eastmoneyDaily: (instrument, limit) => fetchEastmoneyDaily(instrument, limit),
  tencentDaily: (instrument, limit) => fetchTencentDaily(instrument, limit)
};

export class JsonMarketCache implements MarketCacheStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<MarketCacheData | null> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as unknown;
      return isCacheData(parsed) ? parsed : null;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return null;
      return null;
    }
  }

  async write(value: MarketCacheData): Promise<void> {
    await atomicWriteText(this.filePath, JSON.stringify(value));
  }
}

export class MarketDataCoordinator {
  private cache: MarketCacheData | null = null;
  private cacheLoad: Promise<MarketCacheData> | null = null;
  private persistQueue: Promise<void> = Promise.resolve();
  private sectorItems: MarketSector[] | null = null;
  private sectorFetchedAt = 0;

  constructor(
    private readonly providers: MarketProviderSet = defaultProviders,
    private readonly cacheStore: MarketCacheStore | null = null,
    private readonly options: MarketDataOptions = {}
  ) {}

  async fetchOverview(
    preferred: LiveQuoteSource,
    context: MarketFetchContext
  ): Promise<MarketOverview> {
    const cache = await this.ensureCache();
    const cached = cache.overview?.value;
    const errors: string[] = [];
    const indicesOutcome = await this.fetchIndices(preferred, context);
    errors.push(...indicesOutcome.errors);

    let indices = indicesOutcome.items;
    let indicesSource = indicesOutcome.source;
    let indicesCached = false;
    if (indices.length === 0 && cached?.indices.length) {
      indices = cached.indices;
      indicesSource = "local";
      indicesCached = true;
    }

    const sectorLimit = this.options.overviewSectorLimit ?? 5;
    const nowMs = context.nowMs ?? Date.now();
    if (!this.sectorItems && cached?.sectors.length) {
      this.sectorItems = cached.sectors;
      this.sectorFetchedAt = Date.parse(cache.overview?.savedAt ?? "") || 0;
    }
    let sectors: MarketSector[] = [];
    let sectorsCached = false;
    if (this.sectorItems && nowMs - this.sectorFetchedAt < 2 * 60_000) {
      sectors = this.sectorItems;
    } else {
      try {
        sectors = await this.providers.eastmoneySectors(sectorLimit);
        if (sectors.length === 0) throw new Error("empty sectors");
        this.sectorItems = sectors;
        this.sectorFetchedAt = nowMs;
      } catch (error) {
        errors.push(`sectors:${errorMessage(error)}`);
        if (this.sectorItems?.length) {
          sectors = this.sectorItems;
          sectorsCached = true;
        }
      }
    }

    const previewInstrument = DEFAULT_MARKET_INDICES[0]!;
    const intradayOutcome = await this.loadIntraday(
      previewInstrument,
      preferred,
      context,
      true
    );
    if (intradayOutcome.series.error) {
      errors.push(`intraday:${intradayOutcome.series.error}`);
    }

    const currentBreadth = buildBreadth(indices);
    const breadth = mergeBreadth(currentBreadth, cached?.breadth);
    const breadthCached = currentBreadth.upCount == null && cached?.breadth.upCount != null;
    const sources: DataSource[] = [
      indicesSource,
      sectorsCached ? "local" : sectors.length > 0 ? "eastmoney" : null,
      intradayOutcome.series.source
    ].filter((source): source is DataSource => source != null);
    const source = aggregateSources(sources);
    const stale = indicesCached || indices.length < DEFAULT_MARKET_INDICES.length;
    const degraded = stale || sectorsCached || breadthCached ||
      intradayOutcome.series.stale || sources.some((item) => item === "local") ||
      errors.length > 0 || source === "mixed";
    const updatedAt = newestTimestamp([
      ...indices.map((item) => item.updatedAt),
      intradayOutcome.series.updatedAt
    ]);

    const overview: MarketOverview = {
      indices,
      breadth,
      sectors,
      intraday: intradayOutcome.series,
      source,
      stale,
      degraded,
      updatedAt,
      errors: unique(errors)
    };

    if (!indicesCached && indices.length > 0) {
      cache.overview = { savedAt: new Date().toISOString(), value: overview };
      await this.persistCache();
    }
    return overview;
  }

  async fetchDetail(
    instrument: MarketInstrument,
    preferred: LiveQuoteSource,
    context: MarketFetchContext
  ): Promise<MarketDetail> {
    await this.ensureCache();
    const [intraday, daily] = await Promise.all([
      this.loadIntraday(instrument, preferred, context, true),
      this.loadDaily(instrument, preferred, context)
    ]);
    const name = intraday.name || daily.name || instrument.name;
    await this.persistCache();
    return {
      instrument: { ...instrument, name },
      intraday: intraday.series,
      daily: daily.series,
      fetchedAt: new Date(context.nowMs ?? Date.now()).toISOString()
    };
  }

  private async fetchIndices(
    preferred: LiveQuoteSource,
    context: MarketFetchContext
  ): Promise<{ items: MarketIndexQuote[]; source: DataSource | null; errors: string[] }> {
    const order: LiveQuoteSource[] = preferred === "eastmoney"
      ? ["eastmoney", "tencent"]
      : ["tencent", "eastmoney"];
    const errors: string[] = [];
    const selected = new Map<string, MarketIndexQuote>();
    const usedSources = new Set<LiveQuoteSource>();

    for (const source of order) {
      const missing = DEFAULT_MARKET_INDICES.filter((item) => !selected.has(item.key));
      if (missing.length === 0) break;
      try {
        const items = source === "eastmoney"
          ? await this.providers.eastmoneyIndices(missing)
          : await this.providers.tencentIndices(missing);
        for (const item of items) {
          if (!missing.some((instrument) => instrument.key === item.instrument.key) ||
              !validIndex(item, context)) continue;
          selected.set(item.instrument.key, item);
          usedSources.add(source);
        }
        if (items.length < missing.length) {
          errors.push(`${source}:indices ${items.length}/${missing.length}`);
        }
      } catch (error) {
        errors.push(`${source}:indices ${errorMessage(error)}`);
      }
    }

    return {
      items: DEFAULT_MARKET_INDICES.flatMap((instrument) => {
        const item = selected.get(instrument.key);
        return item ? [item] : [];
      }),
      source: aggregateSources([...usedSources]),
      errors
    };
  }

  private async loadIntraday(
    instrument: MarketInstrument,
    preferred: LiveQuoteSource,
    context: MarketFetchContext,
    allowFreshCache: boolean
  ): Promise<{ name: string; series: MarketSeries<IntradayPoint> }> {
    const cache = await this.ensureCache();
    const cachedDetail = cache.details[instrument.key];
    const cached = cachedDetail?.intraday;
    const nowMs = context.nowMs ?? Date.now();
    if (allowFreshCache && cached &&
        nowMs - Date.parse(cached.savedAt) < (this.options.intradayTtlMs ?? 25_000)) {
      return { name: cachedDetail.name, series: cached.value };
    }

    const outcome = await this.fetchSeries<IntradayPoint, IntradayProviderResult>(
      preferred,
      (source) => source === "eastmoney"
        ? this.providers.eastmoneyIntraday(instrument)
        : this.providers.tencentIntraday(instrument),
      (result) => result.items.length > 0 && validIntraday(result, context),
      (result, source, error) => ({
        items: result.items,
        source,
        stale: false,
        updatedAt: result.updatedAt,
        error
      })
    );

    if (outcome) {
      const detail = cache.details[instrument.key] ?? { name: instrument.name };
      detail.name = outcome.result.name || detail.name;
      detail.intraday = { savedAt: new Date(nowMs).toISOString(), value: outcome.series };
      cache.details[instrument.key] = detail;
      return { name: detail.name, series: outcome.series };
    }

    if (cached) {
      return {
        name: cachedDetail.name,
        series: { ...cached.value, source: "local", stale: true, error: "双源不可用，显示缓存" }
      };
    }
    return { name: instrument.name, series: { ...emptySeries(), error: "分时双源不可用" } };
  }

  private async loadDaily(
    instrument: MarketInstrument,
    preferred: LiveQuoteSource,
    context: MarketFetchContext
  ): Promise<{ name: string; series: MarketSeries<DailyCandle> }> {
    const cache = await this.ensureCache();
    const cachedDetail = cache.details[instrument.key];
    const cached = cachedDetail?.daily;
    const nowMs = context.nowMs ?? Date.now();
    if (cached && nowMs - Date.parse(cached.savedAt) < (this.options.dailyTtlMs ?? 5 * 60_000)) {
      return { name: cachedDetail.name, series: cached.value };
    }

    const outcome = await this.fetchSeries<DailyCandle, DailyProviderResult>(
      preferred,
      (source) => source === "eastmoney"
        ? this.providers.eastmoneyDaily(instrument, 120)
        : this.providers.tencentDaily(instrument, 120),
      (result) => result.items.length >= 20,
      (result, source, error) => ({
        items: withBoll(result.items),
        source,
        stale: false,
        updatedAt: result.updatedAt,
        error
      })
    );

    if (outcome) {
      const detail = cache.details[instrument.key] ?? { name: instrument.name };
      detail.name = outcome.result.name || detail.name;
      detail.daily = { savedAt: new Date(nowMs).toISOString(), value: outcome.series };
      cache.details[instrument.key] = detail;
      return { name: detail.name, series: outcome.series };
    }

    if (cached) {
      return {
        name: cachedDetail.name,
        series: { ...cached.value, source: "local", stale: true, error: "双源不可用，显示缓存" }
      };
    }
    return { name: instrument.name, series: { ...emptySeries(), error: "日K双源不可用" } };
  }

  private async fetchSeries<T, TResult>(
    preferred: LiveQuoteSource,
    fetcher: (source: LiveQuoteSource) => Promise<TResult>,
    validator: (result: TResult) => boolean,
    toSeries: (
      result: TResult,
      source: LiveQuoteSource,
      error: string | null
    ) => MarketSeries<T>
  ): Promise<{ result: TResult; series: MarketSeries<T> } | null> {
    const order: LiveQuoteSource[] = preferred === "eastmoney"
      ? ["eastmoney", "tencent"]
      : ["tencent", "eastmoney"];
    const failures: string[] = [];
    for (const source of order) {
      try {
        const result = await fetcher(source);
        if (!validator(result)) throw new Error("invalid or incomplete data");
        return {
          result,
          series: toSeries(result, source, failures.length > 0 ? failures.join("; ") : null)
        };
      } catch (error) {
        failures.push(`${source}:${errorMessage(error)}`);
      }
    }
    return null;
  }

  private async ensureCache(): Promise<MarketCacheData> {
    if (this.cache) return this.cache;
    if (!this.cacheLoad) {
      this.cacheLoad = (async () => {
        let loaded: MarketCacheData | null = null;
        try {
          loaded = await this.cacheStore?.read() ?? null;
        } catch {
          loaded = null;
        }
        this.cache = loaded ?? { version: 1, details: {} };
        return this.cache;
      })();
    }
    return this.cacheLoad;
  }

  private async persistCache(): Promise<void> {
    if (!this.cacheStore || !this.cache) return;
    const snapshot = structuredClone(this.cache);
    this.persistQueue = this.persistQueue
      .then(() => this.cacheStore!.write(snapshot))
      .catch(() => {
        // Cache failures must never take down live market data.
      });
    await this.persistQueue;
  }
}

function validIndex(item: MarketIndexQuote, context: MarketFetchContext): boolean {
  if (item.price == null || item.price <= 0 || item.changePercent == null) return false;
  if (!context.marketOpen) return true;
  if (!item.updatedAt) return false;
  const timestamp = Date.parse(item.updatedAt);
  const maxAge = context.maxSourceAgeMs ?? 120_000;
  return Number.isFinite(timestamp) && (context.nowMs ?? Date.now()) - timestamp <= maxAge;
}

function validIntraday(
  result: IntradayProviderResult,
  context: MarketFetchContext
): boolean {
  if (result.items.length === 0) return false;
  if (!context.marketOpen) return true;
  if (!result.updatedAt) return false;
  const timestamp = Date.parse(result.updatedAt);
  const maxAge = context.maxSourceAgeMs ?? 180_000;
  return Number.isFinite(timestamp) && (context.nowMs ?? Date.now()) - timestamp <= maxAge;
}

function buildBreadth(indices: MarketIndexQuote[]): MarketBreadth {
  const broad = indices.filter((item) =>
    item.instrument.key === "index:SH:000001" ||
    item.instrument.key === "index:SZ:399001"
  );
  return {
    upCount: sumNullable(broad.map((item) => item.upCount)),
    downCount: sumNullable(broad.map((item) => item.downCount)),
    flatCount: sumNullable(broad.map((item) => item.flatCount)),
    amount: sumNullable(broad.map((item) => item.amount))
  };
}

function mergeBreadth(current: MarketBreadth, cached: MarketBreadth | undefined): MarketBreadth {
  return {
    upCount: current.upCount ?? cached?.upCount ?? null,
    downCount: current.downCount ?? cached?.downCount ?? null,
    flatCount: current.flatCount ?? cached?.flatCount ?? null,
    amount: current.amount ?? cached?.amount ?? null
  };
}

function sumNullable(values: Array<number | null>): number | null {
  const available = values.filter((value): value is number => value != null);
  return available.length === values.length && available.length > 0
    ? available.reduce((sum, value) => sum + value, 0)
    : null;
}

function aggregateSources(sources: DataSource[]): DataSource | null {
  const unique = new Set(sources);
  if (unique.size === 0) return null;
  if (unique.size === 1) return [...unique][0]!;
  return "mixed";
}

function newestTimestamp(values: Array<string | null>): string | null {
  const timestamps = values
    .filter((value): value is string => value != null)
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  return timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isCacheData(value: unknown): value is MarketCacheData {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.version === 1 && Boolean(record.details) && typeof record.details === "object";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
