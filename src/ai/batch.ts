import { readFile } from "node:fs/promises";
import type { NewsAnalysis, NewsItem } from "../domain/types.js";
import { stableDigest } from "../domain/digest.js";
import { atomicWriteText } from "../services/atomicFile.js";

export type NewsBatchAnalyzer = (items: NewsItem[]) => Promise<NewsAnalysis[]>;

interface CacheEntry {
  analysis: NewsAnalysis;
  expiresAt: string;
}

interface CachePayload {
  version: 1;
  entries: Record<string, CacheEntry>;
}

/**
 * 超出上限时按到期时间淘汰最早的条目。
 *
 * 不能用 `Object.entries(...).slice(-n)`：对象会把"看起来像数组下标"的键（全数字的
 * 十六进制摘要）排到最前，于是裁剪顺序与写入顺序无关，甚至可能先裁掉刚写入的新条目。
 */
function trimToMax(
  entries: Record<string, CacheEntry>,
  maxEntries: number
): Record<string, CacheEntry> {
  const list = Object.entries(entries);
  if (list.length <= maxEntries) return entries;
  const kept = list
    .sort((left, right) => Date.parse(left[1].expiresAt) - Date.parse(right[1].expiresAt))
    .slice(-maxEntries);
  return Object.fromEntries(kept);
}

export class JsonNewsAnalysisCache {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly maxEntries = 1_000
  ) {}

  /** 持久化条目上限，供调用方在内存里同步裁剪同一份表。 */
  get capacity(): number {
    return this.maxEntries;
  }

  async read(): Promise<Record<string, CacheEntry>> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<CachePayload>;
      if (parsed.version !== 1 || !parsed.entries || typeof parsed.entries !== "object") return {};
      const now = Date.now();
      return trimToMax(
        Object.fromEntries(
          Object.entries(parsed.entries).filter(
            ([, entry]) =>
              entry &&
              typeof entry === "object" &&
              Date.parse(entry.expiresAt) > now &&
              entry.analysis?.provider === "ai"
          )
        ),
        this.maxEntries
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
        return {};
      }
      throw error;
    }
  }

  async write(entries: Record<string, CacheEntry>): Promise<void> {
    const trimmed = trimToMax(entries, this.maxEntries);
    const operation = this.writeQueue.then(async () => {
      const payload: CachePayload = { version: 1, entries: trimmed };
      await atomicWriteText(this.filePath, JSON.stringify(payload, null, 2) + "\n");
    });
    this.writeQueue = operation.catch(() => undefined);
    await operation;
  }
}

export class CachedNewsAnalyzer {
  // 与持久缓存同样的"上限 + TTL"策略：此前这份内存表既无上限也无过期，
  // 常驻运行会累积数千条分析，且 namespace 编在 key 里，切换模型后旧条目还会留着。
  private readonly memory = new Map<string, CacheEntry>();
  private persistentEntries: Record<string, CacheEntry> | null = null;

  constructor(
    private readonly analyzer: NewsBatchAnalyzer,
    private readonly persistentCache?: JsonNewsAnalysisCache,
    private readonly batchSize = 5,
    private readonly ttlMs = 7 * 24 * 60 * 60_000,
    private readonly memoryMaxEntries = 1_000
  ) {}

  async analyze(items: NewsItem[], namespace: string): Promise<NewsAnalysis[]> {
    if (items.length === 0) return [];
    await this.ensurePersistentLoaded();

    const results = new Array<NewsAnalysis>(items.length);
    const missing: Array<{ item: NewsItem; index: number; key: string }> = [];

    items.forEach((item, index) => {
      const key = analysisFingerprint(item, namespace);
      const fromMemory = this.readMemory(key);
      const fromPersistent = this.persistentEntries?.[key];
      const cached = fromMemory ?? fromPersistent?.analysis;
      if (cached) {
        // 只在缺失时回填，并沿用持久缓存的到期时间，避免命中即刷新 TTL。
        if (!fromMemory) this.writeMemory(key, cached, fromPersistent?.expiresAt);
        results[index] = cached;
      } else {
        missing.push({ item, index, key });
      }
    });

    let persistentChanged = false;
    const safeBatchSize = Math.max(1, Math.min(5, Math.floor(this.batchSize)));
    for (let offset = 0; offset < missing.length; offset += safeBatchSize) {
      const chunk = missing.slice(offset, offset + safeBatchSize);
      const analyzed = await this.analyzer(chunk.map((entry) => entry.item));
      const byId = new Map(analyzed.map((analysis) => [analysis.newsId, analysis]));

      for (const entry of chunk) {
        const analysis = byId.get(entry.item.id);
        if (!analysis) throw new Error("AI 批处理结果与输入不匹配");
        results[entry.index] = analysis;
        if (analysis.provider === "ai" && analysis.status === "analyzed") {
          this.writeMemory(entry.key, analysis);
          // 注意：`persistentEntries` 在无持久缓存时是 `{}`（真值），所以这里必须
          // 同时判断 `persistentCache` 是否存在——否则它会变成第二份无上限的内存缓存。
          if (this.persistentCache && this.persistentEntries) {
            this.persistentEntries[entry.key] = {
              analysis,
              expiresAt: new Date(Date.now() + this.ttlMs).toISOString()
            };
            persistentChanged = true;
          }
        }
      }
    }

    if (persistentChanged && this.persistentCache && this.persistentEntries) {
      this.persistentEntries = trimToMax(this.persistentEntries, this.persistentCache.capacity);
      await this.persistentCache.write(this.persistentEntries);
    }
    return results;
  }

  clearMemory(): void {
    this.memory.clear();
  }

  private readMemory(key: string): NewsAnalysis | undefined {
    const entry = this.memory.get(key);
    if (!entry) return undefined;
    if (Date.parse(entry.expiresAt) <= Date.now()) {
      this.memory.delete(key);
      return undefined;
    }
    return entry.analysis;
  }

  private writeMemory(key: string, analysis: NewsAnalysis, expiresAt?: string): void {
    this.memory.set(key, {
      analysis,
      expiresAt: expiresAt ?? new Date(Date.now() + this.ttlMs).toISOString()
    });
    // Map 保持插入顺序，超出上限时从最早写入的条目开始淘汰。
    while (this.memory.size > this.memoryMaxEntries) {
      const oldest = this.memory.keys().next();
      if (oldest.done) break;
      this.memory.delete(oldest.value);
    }
  }

  private async ensurePersistentLoaded(): Promise<void> {
    if (this.persistentEntries) return;
    this.persistentEntries = this.persistentCache ? await this.persistentCache.read() : {};
  }
}

export function analysisFingerprint(item: NewsItem, namespace: string): string {
  const input = [
    namespace,
    item.id,
    item.title,
    item.summary ?? "",
    item.source,
    item.publishedAt,
    ...(item.relatedCodes ?? [])
  ].join("\u001f");
  return stableDigest(input);
}
