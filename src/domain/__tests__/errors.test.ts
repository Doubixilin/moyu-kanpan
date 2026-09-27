import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { errorMessage, upsertError } from "../errors";

describe("error helpers", () => {
  it("extracts a message from anything", () => {
    assert.equal(errorMessage(new Error("坏了")), "坏了");
    assert.equal(errorMessage("plain"), "plain");
    assert.equal(errorMessage({ code: 1 }), "[object Object]");
    assert.equal(errorMessage(undefined), "undefined");
  });

  it("deduplicates by scope prefix and keeps the newest first", () => {
    let errors: string[] = [];
    errors = upsertError(errors, "quotes:第一次");
    errors = upsertError(errors, "news:第一次");
    errors = upsertError(errors, "quotes:第二次");
    // 同一来源只保留最新一条，不同来源可以并存
    assert.deepEqual(errors, ["quotes:第二次", "news:第一次"]);
  });

  it("caps the list at four entries", () => {
    let errors: string[] = [];
    for (let index = 0; index < 6; index += 1) errors = upsertError(errors, `scope${index}:失败`);
    assert.equal(errors.length, 4);
    assert.deepEqual(errors, ["scope5:失败", "scope4:失败", "scope3:失败", "scope2:失败"]);
  });

  it("does not deduplicate entries without a colon", () => {
    // 没有冒号时"前缀"就是整串，过滤条件退化成 `startsWith("无前缀:")`，因此不会去重。
    // 这是 `main.ts` 原实现的行为，保持不动（真实错误串都带 `scope:` 前缀）。
    const errors = upsertError(upsertError([], "无前缀"), "无前缀");
    assert.deepEqual(errors, ["无前缀", "无前缀"]);
  });
});
