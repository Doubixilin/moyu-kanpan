import { readFile } from "node:fs/promises";
import type { NewsAnalysis, NewsItem } from "../domain/types.js";
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

export class JsonNewsAnalysisCache {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly maxEntries = 1_000
  ) {}

  async read(): Promise<Record<string, CacheEntry>> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<CachePayload>;
      if (parsed.version !== 1 || !parsed.entries || typeof parsed.entries !== "object") return {};
      const now = Date.now();
      return Object.fromEntries(
        Object.entries(parsed.entries)
          .filter(([, entry]) =>
            entry && typeof entry === "object" &&
            Date.parse(entry.expiresAt) > now &&
            entry.analysis?.provider === "ai"
          )
          .slice(-this.maxEntries)
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
        return {};
      }
      throw error;
    }
  }

  async write(entries: Record<string, CacheEntry>): Promise<void> {
    const trimmed = Object.fromEntries(Object.entries(entries).slice(-this.maxEntries));
    const operation = this.writeQueue.then(async () => {
      const payload: CachePayload = { version: 1, entries: trimmed };
      await atomicWriteText(this.filePath, JSON.stringify(payload, null, 2) + "\n");
    });
    this.writeQueue = operation.catch(() => undefined);
    await operation;
  }
}

export class CachedNewsAnalyzer {
  private readonly memory = new Map<string, NewsAnalysis>();
  private persistentEntries: Record<string, CacheEntry> | null = null;

  constructor(
    private readonly analyzer: NewsBatchAnalyzer,
    private readonly persistentCache?: JsonNewsAnalysisCache,
    private readonly batchSize = 5,
    private readonly ttlMs = 7 * 24 * 60 * 60_000
  ) {}

  async analyze(items: NewsItem[], namespace: string): Promise<NewsAnalysis[]> {
    if (items.length === 0) return [];
    await this.ensurePersistentLoaded();

    const results = new Array<NewsAnalysis>(items.length);
    const missing: Array<{ item: NewsItem; index: number; key: string }> = [];

    items.forEach((item, index) => {
      const key = analysisFingerprint(item, namespace);
      const cached = this.memory.get(key) ?? this.persistentEntries?.[key]?.analysis;
      if (cached) {
        this.memory.set(key, cached);
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
          this.memory.set(entry.key, analysis);
          if (this.persistentEntries) {
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
      await this.persistentCache.write(this.persistentEntries);
    }
    return results;
  }

  clearMemory(): void {
    this.memory.clear();
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
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
