import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchCninfoAnnouncements, parseCninfoAnnouncements } from "../cninfo";
import { parseCsrcPolicyList } from "../csrc";
import {
  fetchSseAnnouncements,
  parseSseAnnouncements,
  parseSzseAnnouncements
} from "../exchangeAnnouncements";

describe("official news providers", () => {
  it("parses Cninfo official PDF announcements", () => {
    const [item] = parseCninfoAnnouncements(
      {
        announcements: [
          {
            announcementId: "1225420400",
            secCode: "600058",
            announcementTitle: "五矿发展关于&lt;重大资产重组&gt;的公告",
            announcementTime: Date.parse("2026-07-11T00:00:00+08:00"),
            adjunctUrl: "finalpage/2026-07-11/1225420400.PDF"
          }
        ]
      },
      "2026-07-11T01:00:00.000Z"
    );
    assert.equal(item?.sourceTier, "official");
    assert.equal(item?.relatedCodes?.[0], "600058");
    assert.match(item?.url ?? "", /static\.cninfo\.com\.cn/);
  });

  it("parses SSE JSONP and SZSE JSON with official document URLs", () => {
    const sse = parseSseAnnouncements(
      `jsonpCallback(${JSON.stringify({
        result: [
          {
            SECURITY_CODE: "600519",
            TITLE: "贵州茅台公告",
            URL: "/disclosure/listedinfo/announcement/c/new/a.pdf",
            SSEDATE: "2026-07-10"
          }
        ]
      })})`
    );
    const szse = parseSzseAnnouncements({
      data: [
        {
          annId: 1,
          title: "平安银行：担保公告",
          publishTime: "2026-07-09 00:00:00",
          attachPath: "/disc/disk03/finalpage/a.PDF",
          secCode: ["000001"]
        }
      ]
    });
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

  it("builds announcement date windows from Shanghai dates, not UTC", async () => {
    // 2026-07-10T23:30Z 在上海是 2026-07-11 07:30：UTC 日期还停在 10 号。
    const now = new Date("2026-07-10T23:30:00.000Z");

    let cninfoBody: Record<string, string> = {};
    const cninfoFetch: typeof fetch = async (_input, init) => {
      // cninfo 用 application/x-www-form-urlencoded 提交。
      cninfoBody = Object.fromEntries(new URLSearchParams(String(init?.body ?? "")));
      return new Response(JSON.stringify({ announcements: [] }), { status: 200 });
    };
    await fetchCninfoAnnouncements("600519", cninfoFetch, { now, days: 7 });
    assert.equal(cninfoBody.seDate, "2026-07-04~2026-07-11");

    const sseRequests: URL[] = [];
    const sseFetch: typeof fetch = async (input) => {
      sseRequests.push(new URL(String(input)));
      return new Response('jsonpCallback({"result":[]})', { status: 200 });
    };
    await fetchSseAnnouncements("600519", sseFetch, { now, days: 7 });
    assert.equal(sseRequests[0]?.searchParams.get("endDate"), "2026-07-11");
    assert.equal(sseRequests[0]?.searchParams.get("beginDate"), "2026-07-04");
  });
});
