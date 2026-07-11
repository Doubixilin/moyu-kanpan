import type { NewsItem, NewsSourceTier } from "./types.js";

const COMMON_TITLE_WORDS = /(股份有限公司|有限责任公司|集团股份|集团|公司|关于|公告|的|暨|进展|提示性)/g;

export function normalizeEventTitle(title: string): string {
  return title
    .replace(/<[^>]+>/g, "")
    .replace(COMMON_TITLE_WORDS, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .toLowerCase();
}

export function documentFingerprint(item: NewsItem): string {
  const url = item.url.trim().toLowerCase();
  if (url) return stableHash([item.source, url].join("\u001f"));
  return stableHash([
    item.source,
    normalizeEventTitle(item.title),
    (item.summary ?? "").replace(/\s+/g, "").slice(0, 2_000)
  ].join("\u001f"));
}

export function shouldClusterDocuments(left: NewsItem, right: NewsItem): boolean {
  if (left.url && right.url && left.url.trim().toLowerCase() === right.url.trim().toLowerCase()) {
    return true;
  }
  const leftTitle = normalizeEventTitle(left.title);
  const rightTitle = normalizeEventTitle(right.title);
  if (!leftTitle || !rightTitle) return false;
  const leftCodes = new Set(left.relatedCodes ?? []);
  const sharesCode = (right.relatedCodes ?? []).some((code) => leftCodes.has(code));
  const bothHaveCodes = leftCodes.size > 0 && (right.relatedCodes?.length ?? 0) > 0;
  if (bothHaveCodes && !sharesCode) return false;
  if (leftTitle === rightTitle) return true;
  if (!sharesCode) return false;
  return diceCoefficient(characterBigrams(leftTitle), characterBigrams(rightTitle)) >= 0.64;
}

export function preferredRootDocument(items: NewsItem[]): NewsItem {
  return [...items].sort((left, right) => {
    const tier = sourceTierRank(right.sourceTier) - sourceTierRank(left.sourceTier);
    if (tier !== 0) return tier;
    const material = materialRank(right) - materialRank(left);
    if (material !== 0) return material;
    return Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
  })[0]!;
}

export function sourceTierRank(tier: NewsSourceTier | undefined): number {
  if (tier === "official") return 3;
  if (tier === "regulatory") return 2;
  return 1;
}

function materialRank(item: NewsItem): number {
  if (item.materialStatus === "full") return 3;
  if (item.summary && item.summary.length >= 40) return 2;
  if (item.materialStatus === "unavailable") return 0;
  return 1;
}

function characterBigrams(value: string): Set<string> {
  if (value.length < 2) return new Set([value]);
  const result = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    result.add(value.slice(index, index + 2));
  }
  return result;
}

function diceCoefficient(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const item of left) if (right.has(item)) overlap += 1;
  return (2 * overlap) / (left.size + right.size);
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
