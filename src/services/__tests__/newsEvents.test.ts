import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import type { NewsAnalysis, NewsItem } from "../../domain/types";
import { openRecoveringNewsEventStore, SqliteNewsEventStore } from "../newsEvents";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function store(): SqliteNewsEventStore {
  const directory = mkdtempSync(path.join(tmpdir(), "floating-news-"));
  directories.push(directory);
  return new SqliteNewsEventStore(path.join(directory, "events.sqlite"));
}

function document(patch: Partial<NewsItem> = {}): NewsItem {
  return {
    id: "official-1",
    title: "平安银行关于为子公司担保的进展公告",
    url: "https://disc.static.szse.cn/1.pdf",
    source: "szse",
    sourceTier: "official",
    documentType: "announcement",
    materialStatus: "title_only",
    publishedAt: "2026-07-09T00:00:00.000Z",
    fetchedAt: "2026-07-11T00:00:00.000Z",
    relatedCodes: ["000001"],
    ...patch
  };
}

describe("sqlite news event store", () => {
  it("deduplicates exact documents and clusters a media retelling", () => {
    const database = store();
    database.ingest([document(), document()]);
    database.ingest([document({
      id: "media-1",
      title: "平安银行：为子公司提供担保最新进展",
      url: "https://example.com/media",
      source: "eastmoney",
      sourceTier: "media",
      documentType: "fast_news",
      publishedAt: "2026-07-09T00:30:00.000Z"
    })]);
    const events = database.listEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0]?.source, "szse");
    assert.equal(events[0]?.documentCount, 2);
    assert.deepEqual(events[0]?.sources, ["szse", "eastmoney"]);
    database.close();
  });

  it("retains event history and backs off a failed source", () => {
    const database = store();
    database.ingest([document()]);
    const now = new Date("2026-07-11T00:00:00.000Z");
    database.recordSourceFailure("cninfo", new Error("timeout"), now);
    assert.equal(database.listEvents().length, 1);
    assert.equal(database.sourceDue("cninfo", now), false);
    assert.match(database.sourceState("cninfo")?.lastError ?? "", /timeout/);
    database.recordSourceSuccess("cninfo", new Date("2026-07-11T00:01:00.000Z"));
    assert.equal(database.sourceState("cninfo")?.consecutiveFailures, 0);
    database.close();
  });

  it("persists successful analysis and leaves failures retryable", () => {
    const database = store();
    const [event] = database.ingest([document()]);
    const analysis = {
      newsId: event!.id, priority: "high", status: "analyzed", useful: true,
      eventType: "capital", relatedCodes: ["000001"], sourceRelatedCodes: ["000001"],
      inferredRelatedCodes: [], relation: "direct", direction: "neutral", horizon: "short",
      importance: 75, confidence: 80, modelConfidence: 80, materialLimited: true,
      summary: "担保事项更新", mechanism: "或影响或有负债", evidence: ["公司公告"],
      counterFactors: [], missingInformation: [], matchedKeywords: [],
      analyzedAt: "2026-07-11T00:00:00.000Z", provider: "ai", model: "test"
    } satisfies NewsAnalysis;
    database.saveAnalysis(event!.id, analysis);
    assert.equal(database.listEvents()[0]?.analysis?.summary, "担保事项更新");
    database.markAnalysisFailure(event!.id, "later failure");
    assert.equal(database.listEvents()[0]?.analysis?.summary, "担保事项更新");
    database.close();
  });

  it("does not reuse stored AI analysis across model namespaces", () => {
    const database = store();
    const [event] = database.ingest([document()]);
    const analysis = {
      newsId: event!.id, priority: "high", status: "analyzed", useful: true,
      eventType: "capital", relatedCodes: ["000001"], sourceRelatedCodes: ["000001"],
      inferredRelatedCodes: [], relation: "direct", direction: "neutral", horizon: "short",
      importance: 75, confidence: 80, modelConfidence: 80, materialLimited: true,
      summary: "旧模型分析", mechanism: "测试", evidence: ["公告"], counterFactors: [],
      missingInformation: [], matchedKeywords: [], analyzedAt: "2026-07-11T00:00:00.000Z",
      provider: "ai", model: "old"
    } satisfies NewsAnalysis;
    database.saveAnalysis(event!.id, analysis, "provider:old");
    assert.equal(database.listEvents({ analysisNamespace: "provider:old" })[0]?.analysis?.summary, "旧模型分析");
    assert.equal(database.listEvents({ analysisNamespace: "provider:new" })[0]?.analysis, undefined);
    assert.equal(database.analysisDue(event!.id, new Date(), "provider:new"), true);
    database.close();
  });

  it("quarantines a corrupt database and recreates an empty usable store", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "floating-news-recovery-"));
    directories.push(directory);
    const filePath = path.join(directory, "events.sqlite");
    writeFileSync(filePath, "this is not sqlite", "utf8");

    const result = openRecoveringNewsEventStore(filePath);
    assert.equal(result.recovered, true);
    assert.deepEqual(result.store.listEvents(), []);
    result.store.close();
  });

  it("prunes event history older than the local retention window", () => {
    const database = store();
    database.ingest([document({
      id: "old", url: "https://example.com/old.pdf",
      publishedAt: "2026-05-01T00:00:00.000Z", title: "旧公告"
    })]);
    database.ingest([document({
      id: "new", url: "https://example.com/new.pdf",
      publishedAt: "2026-07-10T00:00:00.000Z", title: "新公告"
    })]);
    database.pruneBefore(new Date("2026-06-11T00:00:00.000Z"));
    assert.deepEqual(database.listEvents().map((item) => item.title), ["新公告"]);
    database.close();
  });
});
