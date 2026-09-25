import type { MarketCode } from "../domain/types.js";

/**
 * provider 端共用的 payload 收敛工具。
 *
 * 这些函数此前在 market.ts / eastmoney.ts / tencent.ts 里各有一份副本（其中
 * asRecord/asText/asNumber 三份、f13→market 映射两份且互相矛盾），这里统一到一处，
 * 避免同一个 payload 字段在不同接口里被解释成不同结果。
 */

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * 只接受原始类型：对对象调用 String() 会得到 "[object Object]"。
 */
export function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/** 东财/腾讯都用 "-" 表示缺失值。 */
export function asNumber(value: unknown): number | null {
  if (value === "-" || value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function asInteger(value: unknown): number | null {
  const number = asNumber(value);
  return number == null ? null : Math.round(number);
}

export function isoFromUnixSeconds(value: unknown): string | null {
  const seconds = asNumber(value);
  return seconds != null && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

/**
 * 东财 f13 字段 → 市场。
 *
 * 注意：实测北交所标的的 f13 也是 0（与深市相同），因此调用方**不能**只靠它区分
 * 深市与北交所；需要按代码回退查找（见 market.ts 的指数解析）。
 */
export function marketFromEastmoneyFlag(value: unknown): MarketCode {
  const flag = asNumber(value);
  if (flag === 1) return "SH";
  if (flag === 0) return "SZ";
  if (flag === 2) return "BJ";
  return "UNKNOWN";
}
