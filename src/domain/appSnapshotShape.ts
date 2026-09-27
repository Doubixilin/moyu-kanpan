/**
 * IPC 边界的形状自检（审计报告 §4-4）。
 *
 * `preload.cts` 的 30 个方法都是 `as` 断言，而 `ipcRenderer.invoke` 返回 `any`——
 * 主进程一旦改字段名，渲染层读到的就是 `undefined`：`renderFeedStatus` 的布尔比较全部
 * 为 false，底部状态栏反而显示"一切正常"；`renderQuoteQuality` 读
 * `quality.reasons.length` 会直接抛错。类型系统在边界处**不可能**报错，所以必须运行时查。
 *
 * 这里不"修复"载荷（把缺字段补成默认值会掩盖漂移，正是审计要消掉的失败模式），
 * 而是**指出第一个不对的字段路径**，让渲染层把问题直接显示出来。
 */

type Expected = "array" | "object" | "string" | "boolean" | "number";

interface FieldSpec {
  path: string;
  expected: Expected;
  /** 允许 null（例如 lastSuccessAt）。 */
  nullable?: boolean;
}

/**
 * 渲染层真正会读取、且出错会"静默说谎或抛错"的字段。
 * 只收录这些：范围再扩大就变成维护一份类型副本。
 */
const REQUIRED_FIELDS: FieldSpec[] = [
  { path: "quotes", expected: "array" },
  { path: "news", expected: "array" },
  { path: "market", expected: "object" },
  { path: "risk", expected: "object" },
  { path: "ai", expected: "object" },
  { path: "updatedAt", expected: "string" },
  { path: "settings", expected: "object" },
  { path: "settings.tabs", expected: "array" },
  { path: "settings.watchlist", expected: "array" },
  { path: "settings.securities", expected: "array" },
  { path: "settings.holdings", expected: "array" },
  { path: "settings.navigation", expected: "object" },
  { path: "settings.quotes", expected: "object" },
  { path: "settings.appearance", expected: "object" },
  { path: "settings.risk", expected: "object" },
  { path: "settings.window", expected: "object" },
  { path: "feeds", expected: "object" },
  { path: "feeds.quotes", expected: "object" },
  { path: "feeds.news", expected: "object" },
  // 这几项决定"一切正常"是否说谎
  { path: "feeds.quotes.stale", expected: "boolean" },
  { path: "feeds.quotes.stalled", expected: "boolean" },
  { path: "feeds.quotes.degraded", expected: "boolean" },
  { path: "feeds.quotes.conflictCount", expected: "number" },
  { path: "feeds.quotes.retainedCount", expected: "number" },
  { path: "feeds.quotes.missingCount", expected: "number" },
  { path: "feeds.quotes.alertSafe", expected: "boolean" },
  { path: "feeds.quotes.coverage", expected: "number", nullable: true },
  { path: "feeds.quotes.source", expected: "string", nullable: true },
  { path: "feeds.news.stale", expected: "boolean" },
  { path: "feeds.news.degraded", expected: "boolean" },
  { path: "ui", expected: "object" },
  { path: "ui.clickThrough", expected: "boolean" },
  { path: "risk.recentEvents", expected: "array" },
  { path: "market.indices", expected: "array" },
  { path: "ai.state", expected: "string" }
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valueAt(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const segment of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function typeOf(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function matches(value: unknown, spec: FieldSpec): boolean {
  if (value === undefined) return false;
  if (value === null) return spec.nullable === true;
  return typeOf(value) === spec.expected;
}

/**
 * 返回第一个不符合契约的字段描述；全部正常时返回 `null`。
 *
 * 描述了"路径 + 期望 + 实际"，因此字段改名时用户看到的是
 * `feeds.quotes.degraded：期望 boolean，实际 undefined`，而不是一个绿色的"正常"。
 */
export function describeAppSnapshotProblem(value: unknown): string | null {
  if (!isRecord(value)) return `快照根对象：期望 object，实际 ${typeOf(value)}`;
  for (const spec of REQUIRED_FIELDS) {
    const found = valueAt(value, spec.path);
    if (!matches(found, spec)) {
      const expected = spec.nullable ? `${spec.expected} 或 null` : spec.expected;
      return `${spec.path}：期望 ${expected}，实际 ${typeOf(found)}`;
    }
  }
  return null;
}
