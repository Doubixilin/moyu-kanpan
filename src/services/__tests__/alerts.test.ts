import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { AlertCandidate } from "../../domain/risk";
import { AlertEngine, JsonAlertStateStore } from "../alerts";

function candidate(value: number, safe = true): AlertCandidate {
  return {
    ruleId: "holding:600519:price-above",
    type: "price_above",
    title: "测试股价格向上突破",
    message: `现价 ${value}`,
    securityCode: "600519",
    value,
    threshold: 10,
    direction: "above",
    hysteresis: 0.5,
    safe
  };
}

function context(at: string, patch = {}) {
  return {
    now: new Date(at),
    mode: "shadow" as const,
    cooldownMinutes: 10,
    oncePerDay: false,
    onlyDuringTrading: true,
    tradingSession: true,
    ...patch
  };
}

describe("alert crossing state machine", () => {
  it("does not fire on startup or repeat while a condition remains true", () => {
    const engine = new AlertEngine();
    assert.equal(engine.evaluate([candidate(9)], context("2026-07-10T01:30:00Z")).events.length, 0);
    assert.equal(engine.evaluate([candidate(10.1)], context("2026-07-10T01:31:00Z")).events.length, 1);
    assert.equal(engine.evaluate([candidate(10.2)], context("2026-07-10T01:32:00Z")).events.length, 0);
  });

  it("requires hysteresis retreat and cooldown before firing again", () => {
    const engine = new AlertEngine();
    engine.evaluate([candidate(9)], context("2026-07-10T01:30:00Z"));
    engine.evaluate([candidate(10.1)], context("2026-07-10T01:31:00Z"));
    engine.evaluate([candidate(9.4)], context("2026-07-10T01:32:00Z"));
    assert.equal(engine.evaluate([candidate(10.1)], context("2026-07-10T01:35:00Z")).events.length, 0);
    engine.evaluate([candidate(9.4)], context("2026-07-10T01:42:00Z"));
    assert.equal(engine.evaluate([candidate(10.1)], context("2026-07-10T01:43:00Z")).events.length, 1);
  });

  it("rebases after unsafe data instead of generating a catch-up alert", () => {
    const engine = new AlertEngine();
    engine.evaluate([candidate(9)], context("2026-07-10T01:30:00Z"));
    engine.evaluate([candidate(11, false)], context("2026-07-10T01:31:00Z"));
    assert.equal(engine.evaluate([candidate(11)], context("2026-07-10T01:32:00Z")).events.length, 0);
  });

  it("supports once-per-day and resumes on the next Shanghai date", () => {
    const engine = new AlertEngine();
    const once = { oncePerDay: true };
    engine.evaluate([candidate(9)], context("2026-07-10T01:30:00Z", once));
    assert.equal(engine.evaluate([candidate(11)], context("2026-07-10T01:31:00Z", once)).events.length, 1);
    engine.evaluate([candidate(9)], context("2026-07-10T02:00:00Z", once));
    assert.equal(engine.evaluate([candidate(11)], context("2026-07-10T02:01:00Z", once)).events.length, 0);
    engine.evaluate([candidate(9)], context("2026-07-11T01:30:00Z", once));
    assert.equal(engine.evaluate([candidate(11)], context("2026-07-11T01:31:00Z", once)).events.length, 1);
  });

  it("pauses for the current date and rebases after resume", () => {
    const engine = new AlertEngine();
    engine.evaluate([candidate(9)], context("2026-07-10T01:30:00Z"));
    engine.pauseForToday(new Date("2026-07-10T01:31:00Z"));
    assert.equal(engine.evaluate([candidate(11)], context("2026-07-10T01:32:00Z")).events.length, 0);
    engine.resume();
    assert.equal(engine.evaluate([candidate(11)], context("2026-07-10T01:33:00Z")).events.length, 0);
  });

  it("keeps pause active through non-trading days until the next trading session", () => {
    const engine = new AlertEngine();
    engine.pauseForToday(new Date("2026-07-10T01:30:00Z"));
    const weekend = context("2026-07-11T01:30:00Z", { tradingSession: false });
    assert.equal(engine.evaluate([candidate(9)], weekend).paused, true);
    const monday = context("2026-07-13T01:30:00Z", { tradingSession: true });
    assert.equal(engine.evaluate([candidate(9)], monday).paused, false);
  });
  it("rebases when a configured threshold changes", () => {
    const engine = new AlertEngine();
    engine.evaluate([candidate(9)], context("2026-07-10T01:30:00Z"));
    const changed = { ...candidate(11), threshold: 12 };
    assert.equal(engine.evaluate([changed], context("2026-07-10T01:31:00Z")).events.length, 0);
  });
  it("rebases after a rule is removed and later enabled again", () => {
    const engine = new AlertEngine();
    engine.evaluate([candidate(9)], context("2026-07-10T01:30:00Z"));
    engine.evaluate([], context("2026-07-10T01:31:00Z"));
    assert.equal(engine.evaluate([candidate(11)], context("2026-07-10T01:32:00Z")).events.length, 0);
  });
  it("persists alert state to a local JSON file", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "floating-alerts-"));
    try {
      const store = new JsonAlertStateStore(path.join(directory, "state.json"));
      const engine = new AlertEngine();
      engine.evaluate([candidate(9)], context("2026-07-10T01:30:00Z"));
      engine.evaluate([candidate(11)], context("2026-07-10T01:31:00Z"));
      await store.write(engine.exportState());
      const restored = new AlertEngine(await store.read());
      assert.equal(restored.recentEvents().length, 1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("restores triggered state across restart without duplicate alerts", () => {
    const first = new AlertEngine();
    first.evaluate([candidate(9)], context("2026-07-10T01:30:00Z"));
    first.evaluate([candidate(11)], context("2026-07-10T01:31:00Z"));
    const restored = new AlertEngine(first.exportState());
    assert.equal(restored.evaluate([candidate(11.2)], context("2026-07-10T01:32:00Z")).events.length, 0);
    assert.equal(restored.recentEvents().length, 1);
  });
});
