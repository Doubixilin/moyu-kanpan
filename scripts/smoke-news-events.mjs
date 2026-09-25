import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fetchCninfoAnnouncements } from "../dist-electron/src/providers/cninfo.js";
import { fetchCsrcPolicyNews } from "../dist-electron/src/providers/csrc.js";
import { fetchEastmoneyFastNews } from "../dist-electron/src/providers/eastmoneyNews.js";
import {
  fetchSseAnnouncements,
  fetchSzseAnnouncements
} from "../dist-electron/src/providers/exchangeAnnouncements.js";
import { SqliteNewsEventStore } from "../dist-electron/src/services/newsEvents.js";

const directory = await mkdtemp(path.join(tmpdir(), "floating-news-smoke-"));
const store = new SqliteNewsEventStore(path.join(directory, "events.sqlite"));

try {
  const checks = await Promise.allSettled([
    fetchEastmoneyFastNews(fetch, 10),
    fetchCninfoAnnouncements("600058", fetch, { days: 30, pageSize: 5 }),
    fetchSseAnnouncements("600058", fetch, { days: 30, pageSize: 5 }),
    fetchSzseAnnouncements("000001", fetch, { days: 30, pageSize: 5 }),
    fetchCsrcPolicyNews(fetch, 10)
  ]);
  const labels = ["eastmoney", "cninfo", "sse", "szse", "csrc"];
  const documents = [];
  const sources = checks.map((result, index) => {
    if (result.status === "rejected") {
      return {
        source: labels[index],
        ok: false,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason)
      };
    }
    documents.push(...result.value);
    return { source: labels[index], ok: true, count: result.value.length };
  });
  if (!sources.some((source) => source.ok && source.source !== "eastmoney")) {
    throw new Error("No official or regulatory source succeeded");
  }
  store.ingest(documents);
  // ingest() 现在返回 void（此前顺带返回事件列表，但那让每次刷新都白跑一次查询）。
  const events = store.listEvents({ limit: Math.max(100, documents.length * 2) });
  console.log(
    JSON.stringify(
      {
        sources,
        documentCount: documents.length,
        eventCount: events.length,
        mergedEventCount: events.filter((event) => (event.documentCount ?? 1) > 1).length,
        sample: events.slice(0, 5).map((event) => ({
          title: event.title,
          source: event.source,
          sourceTier: event.sourceTier,
          documentCount: event.documentCount,
          relatedCodes: event.relatedCodes
        }))
      },
      null,
      2
    )
  );
} finally {
  store.close();
  await rm(directory, { recursive: true, force: true });
}
