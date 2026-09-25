import { fetchEastmoneyQuotes } from "../dist-electron/src/providers/eastmoney.js";
import { fetchEastmoneyFastNews } from "../dist-electron/src/providers/eastmoneyNews.js";
import { fetchTencentQuotes } from "../dist-electron/src/providers/tencent.js";
import { DEFAULT_MARKET_INDICES, instrumentKey } from "../dist-electron/src/domain/market.js";
import { MarketDataCoordinator } from "../dist-electron/src/services/marketData.js";
import { QuoteCoordinator } from "../dist-electron/src/services/quotes.js";

const codes = ["600519", "000001"];
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
