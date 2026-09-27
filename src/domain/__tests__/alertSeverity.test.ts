import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AlertEvent, AlertRuleType } from "../types";
import { ALERT_SEVERITY, mostSevereAlert } from "../alertSeverity";

function event(type: AlertRuleType, id: string): AlertEvent {
  return {
    id,
    ruleId: "rule-" + id,
    type,
    title: type,
    message: type,
    value: 1,
    threshold: 1,
    triggeredAt: "2026-09-25T01:00:00.000Z",
    mode: "active"
  };
}

describe("alert severity", () => {
  it("ranks loss-type rules above profit-type rules", () => {
    assert.ok(ALERT_SEVERITY.stop_loss > ALERT_SEVERITY.near_stop);
    assert.ok(ALERT_SEVERITY.daily_loss > ALERT_SEVERITY.daily_profit);
    assert.ok(ALERT_SEVERITY.group_loss > ALERT_SEVERITY.group_profit);
  });

  it("picks the most severe event regardless of order", () => {
    const events = [event("daily_profit", "1"), event("stop_loss", "2"), event("watch_price", "3")];
    // 同一批事件的 triggeredAt 相同，取最后一条是错的（§9 S-3）
    assert.equal(mostSevereAlert(events)?.id, "2");
    assert.equal(mostSevereAlert([...events].reverse())?.id, "2");
  });

  it("keeps the first event on ties and handles empty input", () => {
    assert.equal(mostSevereAlert([]), undefined);
    const tied = [event("stop_loss", "first"), event("stop_loss", "second")];
    assert.equal(mostSevereAlert(tied)?.id, "first");
  });
});
