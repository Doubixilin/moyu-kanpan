import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Quote, QuoteRequest } from "../../domain/types";
import { QuoteCoordinator, fetchQuotesWithFallback, type QuoteProviderSet } from "../quotes";

/** 测试用的行情请求：显式市场按代码前缀给一个合理值。 */
function reqs(...codes: string[]): QuoteRequest[] {
  return codes.map((code) => ({
    code,
    market:
      code.startsWith("6") || code.startsWith("5")
        ? "SH"
        : code.startsWith("4") || code.startsWith("8") || code.startsWith("920")
          ? "BJ"
          : "SZ"
  }));
}

function quote(code: string, source: "eastmoney" | "tencent", patch: Partial<Quote> = {}): Quote {
  return {
    code,
    name: code,
    market: code.startsWith("6") ? "SH" : "SZ",
    price: 100,
    change: 1,
    changePercent: 1.0101,
    open: 99.5,
    previousClose: 99,
    high: 101,
    low: 98,
    volume: 1,
    amount: 1,
    source,
    ...patch
  };
}

describe("quote provider fallback", () => {
  it("uses Tencent when Eastmoney fails", async () => {
    const result = await fetchQuotesWithFallback(reqs("600519"), "eastmoney", {
      eastmoney: async () => {
        throw new Error("unavailable");
      },
      tencent: async () => [quote("600519", "tencent")]
    });

    assert.equal(result.source, "tencent");
    assert.equal(result.quotes[0]?.source, "tencent");
    assert.equal(result.quotes[0]?.quality?.state, "fallback");
    assert.deepEqual(result.failures, ["eastmoney:unavailable"]);
  });

  it("only asks the fallback provider for missing securities", async () => {
    let tencentRequest: string[] = [];
    const result = await fetchQuotesWithFallback(reqs("600519", "000001"), "eastmoney", {
      eastmoney: async () => [quote("600519", "eastmoney")],
      tencent: async (requests) => {
        tencentRequest = requests.map((request) => request.code);
        return [quote("000001", "tencent")];
      }
    });

    assert.deepEqual(tencentRequest, ["000001"]);
    assert.deepEqual(
      result.quotes.map((item) => item.code),
      ["600519", "000001"]
    );
    assert.equal(result.source, "mixed");
    assert.equal(result.fallbackCount, 1);
    assert.equal(result.coverage, 1);
    assert.equal(result.alertSafe, true);
  });

  it("passes the explicit market through to the provider", async () => {
    // §3-2 的核心：provider 不能自己按代码前缀猜市场，必须拿到调用方给的那一份。
    let seen: QuoteRequest[] = [];
    const coordinator = new QuoteCoordinator({
      eastmoney: async (requests) => {
        seen = requests;
        return [quote("920099", "eastmoney", { market: "BJ" })];
      },
      tencent: async () => []
    });

    await coordinator.fetch([{ code: "920099", market: "BJ" }], "eastmoney", { marketOpen: false });
    assert.deepEqual(seen, [{ code: "920099", market: "BJ" }]);

    // 同一代码配不同市场时，provider 收到的是调用方给的市场，而不是前缀推断的结果
    await coordinator.fetch([{ code: "600519", market: "BJ" }], "eastmoney", { marketOpen: false });
    assert.deepEqual(seen, [{ code: "600519", market: "BJ" }]);
  });

  it("falls back when the primary returns HTTP-success but stale source data", async () => {
    const nowMs = Date.parse("2026-07-10T02:00:30.000Z");
    const coordinator = new QuoteCoordinator(
      {
        eastmoney: async () => [
          quote("600519", "eastmoney", {
            updatedAt: "2026-07-10T01:58:00.000Z"
          })
        ],
        tencent: async () => [
          quote("600519", "tencent", {
            updatedAt: "2026-07-10T02:00:20.000Z"
          })
        ]
      },
      { crossCheckEvery: 0 }
    );

    const result = await coordinator.fetch(reqs("600519"), "eastmoney", {
      marketOpen: true,
      nowMs,
      maxSourceAgeMs: 60_000
    });
    assert.equal(result.quotes[0]?.source, "tencent");
    assert.equal(result.quotes[0]?.quality?.state, "fallback");
    assert.equal(result.alertSafe, true);
  });

  it("retains the last trusted quote when both providers fail", async () => {
    let fail = false;
    const providers: QuoteProviderSet = {
      eastmoney: async () => {
        if (fail) throw new Error("east down");
        return [quote("600519", "eastmoney")];
      },
      tencent: async () => {
        if (fail) throw new Error("tencent down");
        return [quote("600519", "tencent")];
      }
    };
    const coordinator = new QuoteCoordinator(providers, { crossCheckEvery: 1 });
    await coordinator.fetch(reqs("600519"), "eastmoney", { marketOpen: false });
    fail = true;

    const result = await coordinator.fetch(reqs("600519"), "eastmoney", {
      marketOpen: false
    });
    assert.equal(result.quotes[0]?.price, 100);
    assert.equal(result.quotes[0]?.source, "local");
    assert.equal(result.quotes[0]?.quality?.state, "retained");
    assert.equal(result.alertSafe, false);
    assert.equal(result.degraded, true);
  });

  it("keeps the last trusted value when providers materially conflict", async () => {
    let eastPrice = 100;
    let tencentPrice = 100;
    const coordinator = new QuoteCoordinator(
      {
        eastmoney: async () => [
          quote("600519", "eastmoney", {
            price: eastPrice,
            change: eastPrice - 99,
            changePercent: ((eastPrice - 99) / 99) * 100,
            high: Math.max(101, eastPrice)
          })
        ],
        tencent: async () => [
          quote("600519", "tencent", {
            price: tencentPrice,
            change: tencentPrice - 99,
            changePercent: ((tencentPrice - 99) / 99) * 100,
            high: Math.max(101, tencentPrice)
          })
        ]
      },
      { crossCheckEvery: 1 }
    );

    await coordinator.fetch(reqs("600519"), "eastmoney", { marketOpen: false });
    eastPrice = 102;
    tencentPrice = 104;
    const result = await coordinator.fetch(reqs("600519"), "eastmoney", {
      marketOpen: false
    });

    assert.equal(result.quotes[0]?.price, 100);
    assert.equal(result.quotes[0]?.source, "local");
    assert.equal(result.quotes[0]?.quality?.state, "conflict");
    assert.equal(result.conflictCount, 1);
    assert.equal(result.alertSafe, false);
  });

  it("opens a provider circuit after consecutive failed recovery probes", async () => {
    let eastmoneyCalls = 0;
    const coordinator = new QuoteCoordinator(
      {
        eastmoney: async () => {
          eastmoneyCalls += 1;
          throw new Error("down");
        },
        tencent: async () => [quote("600519", "tencent")]
      },
      {
        crossCheckEvery: 0,
        recoveryProbeEvery: 1,
        stickyCycles: 0,
        circuitFailureThreshold: 2,
        circuitOpenCycles: 3
      }
    );

    await coordinator.fetch(reqs("600519"), "eastmoney", { marketOpen: false });
    await coordinator.fetch(reqs("600519"), "eastmoney", { marketOpen: false });
    const result = await coordinator.fetch(reqs("600519"), "eastmoney", { marketOpen: false });

    assert.equal(eastmoneyCalls, 2);
    assert.equal(
      result.providerHealth.find((health) => health.provider === "eastmoney")?.circuitState,
      "open"
    );
    assert.equal(result.quotes[0]?.source, "tencent");
  });

  it("returns to the preferred provider only after consecutive healthy probes", async () => {
    const calls: string[] = [];
    let eastmoneyFails = true;
    const coordinator = new QuoteCoordinator(
      {
        eastmoney: async () => {
          calls.push("eastmoney");
          if (eastmoneyFails) throw new Error("down");
          return [quote("600519", "eastmoney")];
        },
        tencent: async () => {
          calls.push("tencent");
          return [quote("600519", "tencent")];
        }
      },
      {
        crossCheckEvery: 0,
        recoveryProbeEvery: 1,
        recoverySuccesses: 2,
        stickyCycles: 0,
        circuitFailureThreshold: 10
      }
    );

    await coordinator.fetch(reqs("600519"), "eastmoney", { marketOpen: false });
    eastmoneyFails = false;
    await coordinator.fetch(reqs("600519"), "eastmoney", { marketOpen: false });
    await coordinator.fetch(reqs("600519"), "eastmoney", { marketOpen: false });
    calls.length = 0;
    const recovered = await coordinator.fetch(reqs("600519"), "eastmoney", { marketOpen: false });

    assert.equal(calls[0], "eastmoney");
    assert.equal(recovered.quotes[0]?.source, "eastmoney");
  });
  it("sticks to the fallback source after the preferred provider fails", async () => {
    const calls: string[] = [];
    let eastFails = true;
    const coordinator = new QuoteCoordinator(
      {
        eastmoney: async () => {
          calls.push("eastmoney");
          if (eastFails) throw new Error("down");
          return [quote("600519", "eastmoney")];
        },
        tencent: async () => {
          calls.push("tencent");
          return [quote("600519", "tencent")];
        }
      },
      {
        crossCheckEvery: 0,
        recoveryProbeEvery: 10,
        stickyCycles: 3
      }
    );

    await coordinator.fetch(reqs("600519"), "eastmoney", { marketOpen: false });
    calls.length = 0;
    eastFails = false;
    await coordinator.fetch(reqs("600519"), "eastmoney", { marketOpen: false });
    assert.equal(calls[0], "tencent");
  });

  it("uses wall-clock time for default cross checks", async () => {
    let tencentCalls = 0;
    const coordinator = new QuoteCoordinator({
      eastmoney: async () => [quote("600519", "eastmoney")],
      tencent: async () => {
        tencentCalls += 1;
        return [quote("600519", "tencent")];
      }
    });
    const start = Date.parse("2026-07-10T02:00:00.000Z");

    await coordinator.fetch(reqs("600519"), "eastmoney", { marketOpen: false, nowMs: start });
    await coordinator.fetch(reqs("600519"), "eastmoney", {
      marketOpen: false,
      nowMs: start + 44_000
    });
    assert.equal(tencentCalls, 0);
    await coordinator.fetch(reqs("600519"), "eastmoney", {
      marketOpen: false,
      nowMs: start + 45_000
    });
    assert.equal(tencentCalls, 1);
  });

  it("keeps a failed provider open for a wall-clock duration", async () => {
    let eastmoneyCalls = 0;
    const coordinator = new QuoteCoordinator(
      {
        eastmoney: async () => {
          eastmoneyCalls += 1;
          throw new Error("down");
        },
        tencent: async () => [quote("600519", "tencent")]
      },
      {
        crossCheckIntervalMs: 0,
        recoveryProbeIntervalMs: 1,
        stickyMs: 0,
        circuitFailureThreshold: 1,
        circuitOpenMs: 15_000
      }
    );
    const start = Date.parse("2026-07-10T02:00:00.000Z");

    await coordinator.fetch(reqs("600519"), "eastmoney", { marketOpen: false, nowMs: start });
    await coordinator.fetch(reqs("600519"), "eastmoney", {
      marketOpen: false,
      nowMs: start + 5_000
    });
    assert.equal(eastmoneyCalls, 1);
    await coordinator.fetch(reqs("600519"), "eastmoney", {
      marketOpen: false,
      nowMs: start + 16_000
    });
    assert.equal(eastmoneyCalls, 2);
  });
});
