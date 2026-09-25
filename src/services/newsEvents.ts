import { existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import {
  documentFingerprint,
  preferredRootDocument,
  shouldClusterDocuments
} from "../domain/events.js";
import type { NewsAnalysis, NewsItem, NewsSourceState } from "../domain/types.js";

/** listEvents 在需要按 relatedCodes 过滤时的分页参数与扫描上限。 */
const EVENT_SCAN_PAGE = 200;
const EVENT_SCAN_MAX_ROWS = 5_000;

interface DocumentRow {
  id: string;
  external_id: string;
  title: string;
  url: string;
  source: string;
  source_tier: string;
  document_type: string;
  material_status: string;
  published_at: string;
  fetched_at: string;
  summary: string | null;
  related_codes_json: string;
}

interface EventRow {
  id: string;
  root_document_id: string;
  related_codes_json: string;
  sources_json: string;
  first_seen_at: string;
  last_updated_at: string;
  document_count: number;
  analysis_json: string | null;
  analysis_namespace: string | null;
}

export class SqliteNewsEventStore {
  private readonly database: DatabaseSync;
  private readonly documentById: StatementSync;
  private readonly eventByDocument: StatementSync;

  constructor(private readonly filePath: string) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    const database = new DatabaseSync(filePath);
    try {
      database.exec(
        "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;"
      );
      database.exec(`
      CREATE TABLE IF NOT EXISTS news_documents (
        id TEXT PRIMARY KEY,
        external_id TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        source TEXT NOT NULL,
        source_tier TEXT NOT NULL,
        document_type TEXT NOT NULL,
        material_status TEXT NOT NULL,
        published_at TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        summary TEXT,
        related_codes_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_news_documents_published
        ON news_documents(published_at DESC);
      CREATE TABLE IF NOT EXISTS news_events (
        id TEXT PRIMARY KEY,
        root_document_id TEXT NOT NULL REFERENCES news_documents(id),
        related_codes_json TEXT NOT NULL,
        sources_json TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_updated_at TEXT NOT NULL,
        document_count INTEGER NOT NULL DEFAULT 1,
        analysis_json TEXT,
        analysis_namespace TEXT,
        analysis_status TEXT NOT NULL DEFAULT 'pending',
        analysis_retry_count INTEGER NOT NULL DEFAULT 0,
        analysis_next_retry_at TEXT,
        analysis_last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS news_event_documents (
        event_id TEXT NOT NULL REFERENCES news_events(id) ON DELETE CASCADE,
        document_id TEXT NOT NULL REFERENCES news_documents(id) ON DELETE CASCADE,
        PRIMARY KEY(event_id, document_id)
      );
      CREATE TABLE IF NOT EXISTS news_source_state (
        source TEXT PRIMARY KEY,
        last_success_at TEXT,
        last_error TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT
      );
      `);
      const eventColumns = database
        .prepare("PRAGMA table_info(news_events)")
        .all() as unknown as Array<{ name: string }>;
      if (!eventColumns.some((column) => column.name === "analysis_namespace")) {
        database.exec("ALTER TABLE news_events ADD COLUMN analysis_namespace TEXT");
      }
      // 摘要算法由 32 位 FNV 换成 128 位 SHA-256（见 domain/digest.ts），
      // news_documents.id 因此全部改变：旧行会在 30 天保留期内与新行并存成重复文档。
      // 这份库是可重建缓存，直接清空重来，避免长期重复与事件合并错乱。
      // news_source_state（来源退避状态）与文档 id 无关，保留。
      const idSchemeVersion = 2;
      const versionRow = database.prepare("PRAGMA user_version").get() as
        { user_version?: number } | undefined;
      if ((versionRow?.user_version ?? 0) < idSchemeVersion) {
        database.exec(`
          DELETE FROM news_event_documents;
          DELETE FROM news_events;
          DELETE FROM news_documents;
          PRAGMA user_version = ${idSchemeVersion};
        `);
      }
      this.database = database;
      this.documentById = database.prepare("SELECT * FROM news_documents WHERE id = ?");
      this.eventByDocument = database.prepare(
        "SELECT event_id FROM news_event_documents WHERE document_id = ?"
      );
    } catch (error) {
      database.close();
      throw error;
    }
  }

  /**
   * 入库（幂等 upsert）。
   * 返回 `void`：此前它顺带返回 `listEvents(...)`，而对外的唯一调用方（NewsDataCoordinator）
   * 直接丢弃了返回值，等于每次刷新都白跑一次 JOIN + SELECT（最多 100 行）。
   */
  ingest(items: NewsItem[], now = new Date()): void {
    const nowIso = now.toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const raw of items) this.ingestOne(normalizeDocument(raw, nowIso), nowIso);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listEvents(
    options: {
      limit?: number;
      since?: string;
      relatedCodes?: ReadonlySet<string>;
      analysisNamespace?: string;
    } = {}
  ): Array<NewsItem & { analysis?: NewsAnalysis }> {
    const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 100)));
    const statement = this.database.prepare(`
      SELECT e.* FROM news_events e
      JOIN news_documents d ON d.id = e.root_document_id
      WHERE (? IS NULL OR d.published_at >= ?)
      ORDER BY d.published_at DESC, e.last_updated_at DESC
      LIMIT ? OFFSET ?
    `);
    const query = (
      pageSize: number,
      offset: number
    ): Array<NewsItem & { analysis?: NewsAnalysis }> => {
      const rows = statement.all(
        options.since ?? null,
        options.since ?? null,
        pageSize,
        offset
      ) as unknown as EventRow[];
      return rows.map((row) => this.eventToItem(row, options.analysisNamespace));
    };

    const relatedCodes = options.relatedCodes;
    if (!relatedCodes) return query(limit, 0);

    // 有 relatedCodes 时不能只取"最新 limit 行再过滤"：LIMIT 会先于过滤生效，
    // 导致窗口之内、排序靠后的匹配事件永远取不到。改为逐页扫描，直到取满 limit 条
    // 匹配项或翻到表尾（`since` 已经把范围限制在保留期内）。
    const matches = (item: NewsItem & { analysis?: NewsAnalysis }): boolean =>
      (item.relatedCodes ?? []).some((code) => relatedCodes.has(code)) ||
      (item.relatedCodes?.length ?? 0) === 0;
    const result: Array<NewsItem & { analysis?: NewsAnalysis }> = [];
    for (let offset = 0; offset < EVENT_SCAN_MAX_ROWS; offset += EVENT_SCAN_PAGE) {
      const page = query(EVENT_SCAN_PAGE, offset);
      for (const item of page) {
        if (!matches(item)) continue;
        result.push(item);
        if (result.length >= limit) return result;
      }
      if (page.length < EVENT_SCAN_PAGE) break;
    }
    return result;
  }

  saveAnalysis(eventId: string, analysis: NewsAnalysis, namespace = "legacy"): void {
    this.database
      .prepare(
        `
      UPDATE news_events SET
        analysis_json = ?, analysis_namespace = ?, analysis_status = 'complete', analysis_retry_count = 0,
        analysis_next_retry_at = NULL, analysis_last_error = NULL
      WHERE id = ?
    `
      )
      .run(JSON.stringify(analysis), namespace, eventId);
  }

  markAnalysisFailure(eventId: string, message: string, now = new Date()): void {
    const current = this.database
      .prepare("SELECT analysis_retry_count FROM news_events WHERE id = ?")
      .get(eventId) as { analysis_retry_count: number } | undefined;
    if (!current) return;
    const count = current.analysis_retry_count + 1;
    const delayMs = Math.min(30 * 60_000, 30_000 * 2 ** Math.min(6, count - 1));
    this.database
      .prepare(
        `
      UPDATE news_events SET analysis_status = 'retry', analysis_retry_count = ?,
        analysis_next_retry_at = ?, analysis_last_error = ? WHERE id = ?
    `
      )
      .run(count, new Date(now.getTime() + delayMs).toISOString(), message.slice(0, 500), eventId);
  }

  analysisDue(eventId: string, at = new Date(), namespace?: string): boolean {
    const row = this.database
      .prepare(
        `
      SELECT analysis_status, analysis_next_retry_at, analysis_namespace FROM news_events WHERE id = ?
    `
      )
      .get(eventId) as
      | {
          analysis_status: string;
          analysis_next_retry_at: string | null;
          analysis_namespace: string | null;
        }
      | undefined;
    if (!row || row.analysis_status === "pending") return true;
    if (namespace && row.analysis_namespace !== namespace) return true;
    if (row.analysis_status === "complete") return false;
    return !row.analysis_next_retry_at || Date.parse(row.analysis_next_retry_at) <= at.getTime();
  }

  recordSourceSuccess(source: string, at = new Date()): void {
    this.database
      .prepare(
        `
      INSERT INTO news_source_state(source, last_success_at, last_error, consecutive_failures, next_retry_at)
      VALUES (?, ?, NULL, 0, NULL)
      ON CONFLICT(source) DO UPDATE SET last_success_at=excluded.last_success_at,
        last_error=NULL, consecutive_failures=0, next_retry_at=NULL
    `
      )
      .run(source, at.toISOString());
  }

  recordSourceFailure(source: string, error: unknown, at = new Date()): void {
    const state = this.sourceState(source);
    const count = (state?.consecutiveFailures ?? 0) + 1;
    const delayMs = Math.min(30 * 60_000, 15_000 * 2 ** Math.min(7, count - 1));
    const message = error instanceof Error ? error.message : String(error);
    this.database
      .prepare(
        `
      INSERT INTO news_source_state(source, last_success_at, last_error, consecutive_failures, next_retry_at)
      VALUES (?, NULL, ?, ?, ?)
      ON CONFLICT(source) DO UPDATE SET last_error=excluded.last_error,
        consecutive_failures=excluded.consecutive_failures, next_retry_at=excluded.next_retry_at
    `
      )
      .run(source, message.slice(0, 500), count, new Date(at.getTime() + delayMs).toISOString());
  }

  sourceState(source: string): NewsSourceState | null {
    const row = this.database
      .prepare("SELECT * FROM news_source_state WHERE source = ?")
      .get(source) as
      | {
          source: string;
          last_success_at: string | null;
          last_error: string | null;
          consecutive_failures: number;
          next_retry_at: string | null;
        }
      | undefined;
    return row
      ? {
          source: row.source,
          lastSuccessAt: row.last_success_at,
          lastError: row.last_error,
          consecutiveFailures: row.consecutive_failures,
          nextRetryAt: row.next_retry_at
        }
      : null;
  }

  sourceDue(source: string, at = new Date()): boolean {
    const state = this.sourceState(source);
    return !state?.nextRetryAt || Date.parse(state.nextRetryAt) <= at.getTime();
  }

  pruneBefore(cutoff: Date): void {
    const cutoffIso = cutoff.toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          `
        DELETE FROM news_events WHERE id IN (
          SELECT e.id FROM news_events e
          JOIN news_documents d ON d.id = e.root_document_id
          WHERE d.published_at < ?
        )
      `
        )
        .run(cutoffIso);
      this.database
        .prepare(
          `
        DELETE FROM news_documents
        WHERE published_at < ? AND NOT EXISTS (
          SELECT 1 FROM news_event_documents link WHERE link.document_id = news_documents.id
        )
      `
        )
        .run(cutoffIso);
      this.database.exec("COMMIT");
      this.database.exec("PRAGMA wal_checkpoint(PASSIVE)");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    try {
      // 退出前做一次 checkpoint：pruneBefore 每天才跑一次，托盘长期运行会让 -wal 偏大。
      this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      // checkpoint 失败不应阻止关闭。
    }
    this.database.close();
  }

  private ingestOne(item: NewsItem, nowIso: string): void {
    const id = documentFingerprint(item);
    this.database
      .prepare(
        `
      INSERT INTO news_documents(
        id, external_id, title, url, source, source_tier, document_type,
        material_status, published_at, fetched_at, last_seen_at, summary, related_codes_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at,
        summary=COALESCE(excluded.summary, news_documents.summary),
        material_status=CASE WHEN excluded.material_status='full' THEN 'full'
          ELSE news_documents.material_status END
    `
      )
      .run(
        id,
        item.id,
        item.title,
        item.url,
        item.source,
        item.sourceTier ?? "media",
        item.documentType ?? "fast_news",
        item.materialStatus ?? "title_only",
        item.publishedAt,
        item.fetchedAt ?? nowIso,
        nowIso,
        item.summary ?? null,
        JSON.stringify(item.relatedCodes ?? [])
      );
    if (this.eventByDocument.get(id)) return;

    const eventId = this.matchEvent(item) ?? `event-${id}`;
    const existing = this.database
      .prepare("SELECT * FROM news_events WHERE id = ?")
      .get(eventId) as unknown as EventRow | undefined;
    if (!existing) {
      this.database
        .prepare(
          `
        INSERT INTO news_events(
          id, root_document_id, related_codes_json, sources_json,
          first_seen_at, last_updated_at, document_count
        ) VALUES (?, ?, ?, ?, ?, ?, 1)
      `
        )
        .run(
          eventId,
          id,
          JSON.stringify(item.relatedCodes ?? []),
          JSON.stringify([item.source]),
          nowIso,
          nowIso
        );
    } else {
      const currentRoot = this.rowToItem(
        this.documentById.get(existing.root_document_id) as unknown as DocumentRow
      );
      const root = preferredRootDocument([currentRoot, item]);
      const relatedCodes = unionJson(existing.related_codes_json, item.relatedCodes ?? []);
      const sources = unionJson(existing.sources_json, [item.source]);
      this.database
        .prepare(
          `
        UPDATE news_events SET root_document_id=?, related_codes_json=?, sources_json=?,
          last_updated_at=?, document_count=document_count+1,
          analysis_status='pending', analysis_json=NULL, analysis_namespace=NULL
        WHERE id=?
      `
        )
        .run(
          root.id === item.id ? id : existing.root_document_id,
          JSON.stringify(relatedCodes),
          JSON.stringify(sources),
          nowIso,
          eventId
        );
    }
    this.database
      .prepare("INSERT OR IGNORE INTO news_event_documents(event_id, document_id) VALUES (?, ?)")
      .run(eventId, id);
  }

  private matchEvent(item: NewsItem): string | null {
    const earliest = new Date(Date.parse(item.publishedAt) - 72 * 60 * 60_000).toISOString();
    const rows = this.database
      .prepare(
        `
      SELECT e.id, e.root_document_id, d.published_at FROM news_events e
      JOIN news_documents d ON d.id=e.root_document_id
      WHERE d.published_at >= ? ORDER BY d.published_at DESC LIMIT 200
    `
      )
      .all(earliest) as unknown as Array<{
      id: string;
      root_document_id: string;
      published_at: string;
    }>;
    for (const row of rows) {
      if (
        Math.abs(Date.parse(row.published_at) - Date.parse(item.publishedAt)) >
        72 * 60 * 60_000
      ) {
        continue;
      }
      const root = this.documentById.get(row.root_document_id) as unknown as
        DocumentRow | undefined;
      if (root && shouldClusterDocuments(item, this.rowToItem(root))) return row.id;
    }
    return null;
  }

  private eventToItem(row: EventRow, namespace?: string): NewsItem & { analysis?: NewsAnalysis } {
    const root = this.documentById.get(row.root_document_id) as unknown as DocumentRow;
    const item = this.rowToItem(root);
    let analysis: NewsAnalysis | undefined;
    try {
      analysis =
        row.analysis_json && (!namespace || row.analysis_namespace === namespace)
          ? (JSON.parse(row.analysis_json) as NewsAnalysis)
          : undefined;
    } catch {
      analysis = undefined;
    }
    return {
      ...item,
      id: row.id,
      eventId: row.id,
      relatedCodes: parseStringArray(row.related_codes_json),
      sources: parseStringArray(row.sources_json),
      documentCount: row.document_count,
      firstSeenAt: row.first_seen_at,
      lastUpdatedAt: row.last_updated_at,
      ...(analysis ? { analysis: { ...analysis, newsId: row.id } } : {})
    };
  }

  private rowToItem(row: DocumentRow): NewsItem {
    return {
      id: row.external_id,
      title: row.title,
      url: row.url,
      source: row.source,
      sourceTier: row.source_tier as NewsItem["sourceTier"],
      documentType: row.document_type as NewsItem["documentType"],
      materialStatus: row.material_status as NewsItem["materialStatus"],
      publishedAt: row.published_at,
      fetchedAt: row.fetched_at,
      summary: row.summary ?? undefined,
      relatedCodes: parseStringArray(row.related_codes_json)
    };
  }
}

export function openRecoveringNewsEventStore(filePath: string): {
  store: SqliteNewsEventStore;
  recovered: boolean;
} {
  try {
    return { store: new SqliteNewsEventStore(filePath), recovered: false };
  } catch (error) {
    if (!isCorruptDatabaseError(error)) throw error;
    const suffix = `.corrupt-${Date.now()}`;
    for (const candidate of [filePath, `${filePath}-wal`, `${filePath}-shm`]) {
      if (existsSync(candidate)) renameSync(candidate, candidate + suffix);
    }
    return { store: new SqliteNewsEventStore(filePath), recovered: true };
  }
}

function isCorruptDatabaseError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("file is not a database") ||
    message.includes("database disk image is malformed") ||
    message.includes("database malformed")
  );
}

function normalizeDocument(item: NewsItem, nowIso: string): NewsItem {
  return {
    ...item,
    title: item.title.trim(),
    sourceTier: item.sourceTier ?? "media",
    documentType: item.documentType ?? "fast_news",
    materialStatus:
      item.materialStatus ??
      ((item.summary?.replace(/\s+/g, "").length ?? 0) >= 40 ? "full" : "title_only"),
    fetchedAt: item.fetchedAt ?? nowIso,
    relatedCodes: [...new Set((item.relatedCodes ?? []).map((code) => code.trim()).filter(Boolean))]
  };
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function unionJson(value: string, next: string[]): string[] {
  return [...new Set([...parseStringArray(value), ...next])];
}
