import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCninfoAnnouncements } from "../cninfo";
import { parseCsrcPolicyList } from "../csrc";
import { parseSseAnnouncements, parseSzseAnnouncements } from "../exchangeAnnouncements";

describe("official news providers", () => {
  it("parses Cninfo official PDF announcements", () => {
    const [item] = parseCninfoAnnouncements({ announcements: [{
      announcementId: "1225420400", secCode: "600058",
      announcementTitle: "五矿发展关于&lt;重大资产重组&gt;的公告",
      announcementTime: Date.parse("2026-07-11T00:00:00+08:00"),
      adjunctUrl: "finalpage/2026-07-11/1225420400.PDF"
    }] }, "2026-07-11T01:00:00.000Z");
    assert.equal(item?.sourceTier, "official");
    assert.equal(item?.relatedCodes?.[0], "600058");
    assert.match(item?.url ?? "", /static\.cninfo\.com\.cn/);
  });

  it("parses SSE JSONP and SZSE JSON with official document URLs", () => {
    const sse = parseSseAnnouncements(`jsonpCallback(${JSON.stringify({ result: [{
      SECURITY_CODE: "600519", TITLE: "贵州茅台公告",
      URL: "/disclosure/listedinfo/announcement/c/new/a.pdf", SSEDATE: "2026-07-10"
    }] })})`);
    const szse = parseSzseAnnouncements({ data: [{
      annId: 1, title: "平安银行：担保公告", publishTime: "2026-07-09 00:00:00",
      attachPath: "/disc/disk03/finalpage/a.PDF", secCode: ["000001"]
    }] });
    assert.equal(sse[0]?.source, "sse");
    assert.equal(szse[0]?.source, "szse");
    assert.match(szse[0]?.url ?? "", /disc\.static\.szse\.cn/);
  });

  it("parses only CSRC policy content links", () => {
    const html = `<li><a href="/csrc/c100028/c7618628/content.shtml">证监会发布监管规定</a><span>2026-03-06</span></li>`;
    const [item] = parseCsrcPolicyList(html, "2026-07-11T00:00:00.000Z");
    assert.equal(item?.sourceTier, "regulatory");
    assert.equal(item?.publishedAt, "2026-03-05T16:00:00.000Z");
  });
});
