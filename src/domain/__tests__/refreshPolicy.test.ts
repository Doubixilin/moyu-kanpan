import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BACKGROUND_QUOTE_INTERVAL_MS,
  FOREGROUND_QUOTE_INTERVAL_MS,
  IDLE_QUOTE_INTERVAL_MS,
  quoteTargetIntervalMs,
  startToStartDelayMs
} from "../refreshPolicy";

describe("quote refresh policy", () => {
  it("uses three seconds in the foreground and five seconds in the background", () => {
    assert.equal(
      quoteTargetIntervalMs({ marketState: "trading", foreground: true }),
      FOREGROUND_QUOTE_INTERVAL_MS
    );
    assert.equal(
      quoteTargetIntervalMs({ marketState: "trading", foreground: false }),
      BACKGROUND_QUOTE_INTERVAL_MS
    );
  });

  it("backs off outside continuous trading", () => {
    for (const marketState of ["preopen", "lunch", "closed", "holiday", "weekend"] as const) {
      assert.equal(
        quoteTargetIntervalMs({ marketState, foreground: true }),
        IDLE_QUOTE_INTERVAL_MS
      );
    }
  });

  it("offers a conservative standard mode", () => {
    assert.equal(quoteTargetIntervalMs({ marketState: "trading", foreground: true, mode: "standard" }), 5_000);
    assert.equal(quoteTargetIntervalMs({ marketState: "trading", foreground: false, mode: "standard" }), 8_000);
  });

  it("subtracts request time from the next delay and applies bounded jitter", () => {
    assert.equal(startToStartDelayMs(3_000, 200, () => 0), 2_650);
    assert.equal(startToStartDelayMs(3_000, 200, () => 0.5), 2_800);
    assert.equal(startToStartDelayMs(3_000, 200, () => 1), 2_950);
    assert.equal(startToStartDelayMs(3_000, 5_000, () => 0.5), 100);
  });
});
