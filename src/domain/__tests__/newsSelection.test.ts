import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Security } from "../../config";
import type { NewsAnalysis, NewsItem } from "../types";
import { presentNews, selectRelevantNews } from "../newsSelection";

const SECURITIES: Security[] = [
  { code: "600519", market: "SH", name: "贵州茅台", alias: "茅台" },
  { code: "000001", market: "SZ", name: "平安银行", alias: "" },
  { code: "300750", market: "SZ", name: "宁德时代", alias: "" }
];

function item(
  overrides: Partial<{ id: string; title: string; summary: string }> = {}
): NewsItem & { relatedCodes?: string[] } {
  return {
    id: overrides.id ?? "n1",
    title: overrides.title ?? "标题",
    url: "https://example.com/a",
    source: "eastmoney",
    publishedAt: "2026-09-25T01:00:00.000Z",
    ...(overrides.summary === undefined ? {} : { summary: overrides.summary })
  };
}

describe("news selection", () => {
  it("annotates related codes from the title and summary", () => {
    const [annotated] = selectRelevantNews([item({ title: "贵州茅台发布三季报" })], {
      securities: SECURITIES,
      activeCodes: SECURITIES.map((security) => security.code),
      mode: "all"
    });
    assert.deepEqual(annotated?.relatedCodes, ["600519"]);
  });

  it("matches aliases, codes and quote-only names", () => {
    const byAlias = selectRelevantNews([item({ title: "茅台 股价异动" })], {
      securities: SECURITIES,
      activeCodes: ["600519"],
      mode: "all"
    });
    assert.deepEqual(byAlias[0]?.relatedCodes, ["600519"]);

    const byCode = selectRelevantNews([item({ summary: "关注 000001 的走势" })], {
      securities: SECURITIES,
      activeCodes: ["000001"],
      mode: "all"
    });
    assert.deepEqual(byCode[0]?.relatedCodes, ["000001"]);

    // 行情名（带空格）优先于空别名，也必须参与匹配
    const byQuoteName = selectRelevantNews([item({ title: "五 粮 液 涨停" })], {
      securities: [{ code: "000858", market: "SZ", name: "", alias: "" }],
      activeCodes: ["000858"],
      quoteNames: new Map([["000858", "五 粮 液"]]),
      mode: "all"
    });
    assert.deepEqual(byQuoteName[0]?.relatedCodes, ["000858"]);
  });

  it("ignores too-short keywords and inactive securities", () => {
    // 关键字长度 < 2 一律忽略：否则 "A"、"1" 这类短串会命中一切
    const shortKeyword = selectRelevantNews([item({ title: "A 股大盘" })], {
      securities: [{ code: "600000", market: "SH", name: "A", alias: "" }],
      activeCodes: ["600000"],
      mode: "all"
    });
    assert.deepEqual(shortKeyword[0]?.relatedCodes, []);

    // 不在 activeCodes 里的证券不参与匹配，已有 relatedCodes 也会被过滤
    const inactive = selectRelevantNews(
      [{ ...item({ title: "贵州茅台" }), relatedCodes: ["600519", "999999"] }],
      { securities: SECURITIES, activeCodes: ["000001"], mode: "all" }
    );
    assert.deepEqual(inactive[0]?.relatedCodes, []);
  });

  it("filters to related items only in watchlist_related mode", () => {
    const items = [item({ id: "a", title: "贵州茅台" }), item({ id: "b", title: "宏观数据" })];
    const filtered = selectRelevantNews(items, {
      securities: SECURITIES,
      activeCodes: ["600519"],
      mode: "watchlist_related"
    });
    assert.deepEqual(
      filtered.map((entry) => entry.id),
      ["a"]
    );
    // 其他模式只标注、不过滤
    const annotated = selectRelevantNews(items, {
      securities: SECURITIES,
      activeCodes: ["600519"],
      mode: "important"
    });
    assert.equal(annotated.length, 2);
  });

  it("keeps only useful non-low items in important mode, then truncates", () => {
    // 只关心 presentNews 读取的两个字段，其余字段与断言无关
    const analysis = (useful: boolean, priority: string) =>
      ({ useful, priority }) as unknown as NewsAnalysis;
    const withAnalysis = [
      { ...item({ id: "high" }), analysis: analysis(true, "high") },
      { ...item({ id: "low" }), analysis: analysis(true, "low") },
      { ...item({ id: "useless" }), analysis: analysis(false, "high") },
      { ...item({ id: "none" }) }
    ];
    const important = presentNews(withAnalysis, 10, "important");
    assert.deepEqual(
      important.map((entry) => entry.id),
      ["high"]
    );

    // all 模式不过滤，只截断
    assert.equal(presentNews(withAnalysis, 3, "all").length, 3);
    assert.equal(presentNews(withAnalysis, 2, "important").length, 1);
  });
});
