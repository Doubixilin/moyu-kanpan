import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeAiTestRequest } from "../aiTestRequest";

const VALID = {
  ai: {
    enabled: true,
    provider: "custom",
    baseUrl: "https://api.example.com/v1/",
    model: " gpt-x ",
    timeoutSeconds: 30.4
  },
  apiKey: "  sk-draft  "
};

describe("AI test request validation", () => {
  it("normalizes a valid request", () => {
    const request = normalizeAiTestRequest(VALID, "sk-saved");
    assert.deepEqual(request, {
      enabled: true,
      provider: "custom",
      baseUrl: "https://api.example.com/v1",
      model: "gpt-x",
      timeoutSeconds: 30,
      apiKey: "sk-draft"
    });
  });

  it("falls back to the saved key when the draft is blank", () => {
    assert.equal(
      normalizeAiTestRequest({ ...VALID, apiKey: "   " }, "sk-saved").apiKey,
      "sk-saved"
    );
    assert.equal(normalizeAiTestRequest({ ...VALID, apiKey: 42 }, "sk-saved").apiKey, "sk-saved");
  });

  it("rejects non-object payloads and unknown providers", () => {
    assert.throws(() => normalizeAiTestRequest(null, ""), /AI 测试参数无效/);
    assert.throws(() => normalizeAiTestRequest("nope", ""), /AI 测试参数无效/);
    assert.throws(
      () => normalizeAiTestRequest({ ai: { provider: "openai" } }, ""),
      /AI 服务类型无效/
    );
  });

  it("rejects insecure endpoints, bad models and out-of-range timeouts", () => {
    const withAi = (patch: Record<string, unknown>) => ({
      ai: { ...VALID.ai, ...patch },
      apiKey: "k"
    });
    assert.throws(
      () => normalizeAiTestRequest(withAi({ baseUrl: "http://evil.example.com" }), ""),
      /AI API 地址无效/
    );
    assert.throws(() => normalizeAiTestRequest(withAi({ baseUrl: "" }), ""), /AI API 地址无效/);
    // 本机回环的明文 http 是允许的（本地模型）
    assert.equal(
      normalizeAiTestRequest(withAi({ baseUrl: "http://127.0.0.1:11434/v1" }), "").baseUrl,
      "http://127.0.0.1:11434/v1"
    );
    assert.throws(() => normalizeAiTestRequest(withAi({ model: "" }), ""), /AI 模型名称无效/);
    assert.throws(
      () => normalizeAiTestRequest(withAi({ model: "m".repeat(101) }), ""),
      /AI 模型名称无效/
    );
    assert.throws(() => normalizeAiTestRequest(withAi({ timeoutSeconds: 4 }), ""), /5–120/);
    assert.throws(() => normalizeAiTestRequest(withAi({ timeoutSeconds: 121 }), ""), /5–120/);
    assert.throws(() => normalizeAiTestRequest(withAi({ timeoutSeconds: "abc" }), ""), /5–120/);
  });

  it("treats enabled:false explicitly but defaults to enabled", () => {
    assert.equal(
      normalizeAiTestRequest({ ...VALID, ai: { ...VALID.ai, enabled: false } }, "").enabled,
      false
    );
    const { enabled: _ignored, ...withoutEnabled } = VALID.ai;
    assert.equal(normalizeAiTestRequest({ ai: withoutEnabled, apiKey: "k" }, "").enabled, true);
  });
});
