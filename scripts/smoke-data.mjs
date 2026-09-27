import { fetchEastmoneyQuotes } from "../dist-electron/src/providers/eastmoney.js";
import { fetchEastmoneyFastNews } from "../dist-electron/src/providers/eastmoneyNews.js";
import { fetchTencentQuotes } from "../dist-electron/src/providers/tencent.js";
import { DEFAULT_MARKET_INDICES, instrumentKey } from "../dist-electron/src/domain/market.js";
import { MarketDataCoordinator } from "../dist-electron/src/services/marketData.js";
import { QuoteCoordinator } from "../dist-electron/src/services/quotes.js";

const codes = ["600519", "000001"];

// 这个 smoke **刻意**直连东财（不经回退），所以上游抖动时会失败——这是特性不是 bug。
// 但未处理的 rejection 会让 Node 在退出清理阶段触发 libuv 断言、丢掉错误正文，
// 于是"上游挂了"和"代码坏了"在日志里长得一样。这里统一收口成一行可读诊断。
main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[smoke:data] 失败：" + message);
  if (/fetch failed|timed out|UND_ERR_SOCKET|other side closed|prematurely/i.test(message)) {
    console.error("[smoke:data] 看起来是上游/网络问题（push2.eastmoney.com），稍后重试即可；");
    console.error("[smoke:data] 若重复出现，请用 curl 直接验证该域名是否可访问。");
  }
  process.exitCode = 1;
});

async function main() {
  const [eastmoneyQuotes, tencentQuotes, news] = await Promise.all([
    fetchEastmoneyQuotes(codes),
    fetchTencentQuotes(codes),
    fetchEastmoneyFastNews(undefined, 5)
  ]);
  const coordinated = await new QuoteCoordinator(undefined, {
    crossCheckEvery: 1
  }).fetch(codes, "eastmoney", { marketOpen: false });
  const marketCoordinator = new MarketDataCoordinator();
  const [marketOverview, marketDetail] = await Promise.all([
    marketCoordinator.fetchOverview("eastmoney", { marketOpen: false }),
    marketCoordinator.fetchDetail(
      {
        key: instrumentKey("stock", "SH", "600519"),
        kind: "stock",
        code: "600519",
        market: "SH",
        name: "贵州茅台"
      },
      "eastmoney",
      { marketOpen: false }
    )
  ]);

  function compactQuotes(quotes) {
    return quotes.map((quote) => ({
      code: quote.code,
      name: quote.name,
      price: quote.price,
      changePercent: quote.changePercent,
      source: quote.source
    }));
  }

  console.log(
    JSON.stringify(
      {
        eastmoneyQuotes: compactQuotes(eastmoneyQuotes),
        tencentQuotes: compactQuotes(tencentQuotes),
        coordinatedQuotes: compactQuotes(coordinated.quotes),
        quoteQuality: {
          source: coordinated.source,
          coverage: coordinated.coverage,
          degraded: coordinated.degraded,
          alertSafe: coordinated.alertSafe,
          conflictCount: coordinated.conflictCount,
          providerHealth: coordinated.providerHealth
        },
        market: {
          indices: marketOverview.indices.map((item) => ({
            key: item.instrument.key,
            price: item.price,
            changePercent: item.changePercent,
            source: item.source
          })),
          breadth: marketOverview.breadth,
          sectors: marketOverview.sectors.map((item) => ({
            name: item.name,
            changePercent: item.changePercent
          })),
          previewPoints: marketOverview.intraday.items.length,
          overviewSource: marketOverview.source,
          overviewDegraded: marketOverview.degraded,
          stockDetail: {
            instrument: marketDetail.instrument.key,
            intradayPoints: marketDetail.intraday.items.length,
            intradaySource: marketDetail.intraday.source,
            dailyCandles: marketDetail.daily.items.length,
            dailySource: marketDetail.daily.source,
            latestBollMid: marketDetail.daily.items.at(-1)?.bollMid ?? null
          },
          indexKeys: DEFAULT_MARKET_INDICES.map((item) => item.key)
        },
        news: news.map((item) => ({
          title: item.title,
          source: item.source,
          url: item.url
        }))
      },
      null,
      2
    )
  );
}
