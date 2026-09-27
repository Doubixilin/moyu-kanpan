import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  changeDirection,
  escapeAttr,
  escapeHtml,
  formatClockTime,
  formatClockTimeWithSeconds,
  formatFixedOrDash,
  formatSignedPercent,
  positiveNegativeClass
} from "./format";

/** 用本地时间构造，断言才不会被 CI 的时区影响。 */
const localTime = (hour: number, minute: number, second = 0): string =>
  new Date(2026, 8, 25, hour, minute, second).toISOString();

describe("presentation format helpers", () => {
  it("escapes the five HTML-dangerous characters", () => {
    const escaped = escapeHtml(`<b class="x">Tom & 'Jerry'</b>`);
    assert.equal(escaped, "&lt;b class=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/b&gt;");
    assert.equal(escapeAttr("'"), "&#39;");
    assert.equal(escapeHtml(""), "");
  });

  it("formats clock times in 24-hour form regardless of locale defaults", () => {
    assert.equal(formatClockTime(localTime(9, 5)), "09:05");
    assert.equal(formatClockTime(localTime(23, 59)), "23:59");
    assert.equal(formatClockTimeWithSeconds(localTime(9, 5, 7)), "09:05:07");
  });

  it("falls back to dashes for missing or unparsable times", () => {
    for (const value of [null, undefined, "", "not-a-date"]) {
      assert.equal(formatClockTime(value), "--:--", String(value));
      assert.equal(formatClockTimeWithSeconds(value), "--:--:--", String(value));
    }
  });

  it("classifies change direction with flat for null and zero", () => {
    assert.equal(changeDirection(1.5), "up");
    assert.equal(changeDirection(-0.01), "down");
    assert.equal(changeDirection(0), "flat");
    assert.equal(changeDirection(null), "flat");
    assert.equal(changeDirection(undefined), "flat");
    // 工作网页/Excel 用另一套词，Flat 必须是空类名（不能残留 "flat"）
    assert.equal(positiveNegativeClass("up"), "positive");
    assert.equal(positiveNegativeClass("down"), "negative");
    assert.equal(positiveNegativeClass("flat"), "");
  });

  it("formats fixed decimals and signed percents with dash fallbacks", () => {
    assert.equal(formatFixedOrDash(12.345, 2), "12.35");
    assert.equal(formatFixedOrDash(0, 3), "0.000");
    assert.equal(formatFixedOrDash(null, 2), "--");
    assert.equal(formatFixedOrDash(null, 2, ""), "");

    assert.equal(formatSignedPercent(1.2), "+1.20%");
    assert.equal(formatSignedPercent(-0.5), "-0.50%");
    assert.equal(formatSignedPercent(0), "0.00%");
    assert.equal(formatSignedPercent(null), "--");
  });
});
