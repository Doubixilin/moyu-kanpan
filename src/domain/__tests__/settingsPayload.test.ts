import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_SETTINGS_PAYLOAD_BYTES, isOversizedSettingsPayload } from "../settingsPayload";

describe("settings IPC payload guard", () => {
  it("accepts a normal settings payload", () => {
    assert.equal(isOversizedSettingsPayload({ tabs: [], holdings: [{ quantity: 1 }] }), false);
    assert.equal(isOversizedSettingsPayload({}), false);
  });

  it("rejects payloads above the 2 MB budget", () => {
    // 刚好超限一个字符也要拒绝（边界按 JSON 长度算）
    const filler = "x".repeat(MAX_SETTINGS_PAYLOAD_BYTES - '{"note":""}'.length + 1);
    assert.equal(isOversizedSettingsPayload({ note: filler }), true);
    const justUnder = "x".repeat(MAX_SETTINGS_PAYLOAD_BYTES - '{"note":""}'.length);
    assert.equal(isOversizedSettingsPayload({ note: justUnder }), false);
  });

  it("rejects payloads that cannot be serialized at all", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    assert.equal(isOversizedSettingsPayload(circular), true);
    assert.equal(isOversizedSettingsPayload(undefined), true);
    assert.equal(
      isOversizedSettingsPayload(() => undefined),
      true
    );
  });
});
