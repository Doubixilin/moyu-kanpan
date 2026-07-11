import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NewsItem } from "../types";
import {
  documentFingerprint,
  normalizeEventTitle,
  preferredRootDocument,
  shouldClusterDocuments
} from "../events";

function item(patch: Partial<NewsItem> = {}): NewsItem {
  return {
    id: "1",
    title: "平安银行股份有限公司关于为子公司担保的进展公告",
    url: "https://example.com/1.pdf",
    source: "cninfo",
    sourceTier: "official",
    publishedAt: "2026-07-09T00:00:00.000Z",
    relatedCodes: ["000001"],
    ...patch
  };
}

describe("news event domain", () => {
  it("normalizes boilerplate without erasing event meaning", () => {
    assert.equal(normalizeEventTitle(item().title), "平安银行为子担保");
  });

  it("clusters close titles only when a security code overlaps", () => {
    assert.equal(shouldClusterDocuments(
      item(),
      item({
        id: "2",
        title: "平安银行：为子公司提供担保最新进展",
        url: "https://example.com/2",
        source: "eastmoney",
        sourceTier: "media"
      })
    ), true);
    assert.equal(shouldClusterDocuments(
      item(),
      item({ id: "3", relatedCodes: ["600519"], url: "https://example.com/3" })
    ), false);
  });

  it("prefers an official document as the event fact root", () => {
    const official = item();
    const media = item({
      id: "2", source: "eastmoney", sourceTier: "media",
      title: "平安银行担保事项引发关注", publishedAt: "2026-07-09T01:00:00.000Z"
    });
    assert.equal(preferredRootDocument([media, official]).id, official.id);
  });

  it("fingerprints exact source documents deterministically", () => {
    assert.equal(documentFingerprint(item()), documentFingerprint(item()));
    assert.notEqual(documentFingerprint(item()), documentFingerprint(item({ url: "https://example.com/2" })));
  });
});
