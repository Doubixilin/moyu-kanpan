/**
 * 渲染层共用的基础工具。
 *
 * 这些函数此前在 5 个渲染器里各有副本，其中 `escapeHtml` 还存在**同名不同语义**的问题：
 * `renderer.ts` / `settingsRenderer.ts` 只转义 `& < > "` 并另配 `escapeAttr` 补 `'`，
 * 而 `quickRenderer.ts` / `excelRenderer.ts` / `workRenderer.ts` 转义 5 个字符。
 * 在渲染器之间复制标记时，这种差异会静默改变属性转义行为，因此统一到这里：
 * 两者都转义 5 个字符（`escapeAttr` 现在与 `escapeHtml` 等价，保留名字以表达意图）。
 *
 * 本模块必须是浏览器安全的（不得引入 node: 模块），并且要被
 * `scripts/build-renderer.mjs` 编译进 `assets/` —— 新增渲染器导入时别忘记加进去。
 */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};

/** 转义插入 HTML 文本/属性时用到的全部危险字符。 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]!);
}

/**
 * 转义用于属性值的字符串。
 * 与 `escapeHtml` 等价（两者都覆盖 `'`），保留独立名字是为了在调用点表达意图。
 */
export function escapeAttr(value: string): string {
  return escapeHtml(value);
}

/** 时间缺失或非法时的占位符。 */
export const DASH = "--";

/** 时间格式器复用实例：`Intl` 构造开销不小，而渲染器每次推送都会调用。 */
const CLOCK_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});
const CLOCK_FORMAT_WITH_SECONDS = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});

/**
 * `HH:mm`（本地时区）。
 *
 * 此前 5 个渲染器各有一份（3 份用 `toLocaleTimeString`、2 份用 `DateTimeFormat`）；
 * 显式写 `hour12: false` 才能保证 zh-CN 下不会插进"上午/下午"，也让输出可测。
 */
export function formatClockTime(value: string | null | undefined): string {
  if (!value) return "--:--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--:--" : CLOCK_FORMAT.format(date);
}

/** `HH:mm:ss`（快讯/同步时间）。 */
export function formatClockTimeWithSeconds(value: string | null | undefined): string {
  if (!value) return "--:--:--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--:--:--" : CLOCK_FORMAT_WITH_SECONDS.format(date);
}

export type ChangeDirection = "up" | "down" | "flat";

/** 数值方向：`null` 与 0 都算走平（各渲染器原本的判定一致）。 */
export function changeDirection(value: number | null | undefined): ChangeDirection {
  if (value == null || value === 0) return "flat";
  return value > 0 ? "up" : "down";
}

/** `positive/negative/空串` 版类名，供工作网页与 Excel 使用（其 CSS 用这套词）。 */
export function positiveNegativeClass(direction: ChangeDirection): string {
  return direction === "up" ? "positive" : direction === "down" ? "negative" : "";
}

/** 固定小数位，缺失显示 `--`。 */
export function formatFixedOrDash(
  value: number | null | undefined,
  digits: number,
  dash = DASH
): string {
  return value == null ? dash : value.toFixed(digits);
}

/** 带符号的百分比：`+1.23%` / `-0.50%` / `--`。 */
export function formatSignedPercent(
  value: number | null | undefined,
  digits = 2,
  dash = DASH
): string {
  return value == null ? dash : `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}
