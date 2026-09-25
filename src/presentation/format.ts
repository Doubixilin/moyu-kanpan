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
