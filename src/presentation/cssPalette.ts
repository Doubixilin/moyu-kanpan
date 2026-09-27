/**
 * CSS 调色板盘点（审计报告 §4-10）。
 *
 * 5 个界面的 CSS 各自散落着几十个颜色字面量，且没有任何机制阻止"再随手加一个近似灰"。
 * 这里提供一个**纯解析器**，让调色板规模变成可断言的数字：
 * 新增颜色会让测试失败，从而必须先在评审里说明用途（或合并到已有颜色）。
 *
 * 只解析颜色**字面量**（hex / rgb() / hsl()）与自定义属性，不做 CSS 语法分析，
 * 因此对格式化与写法差异不敏感；注释会先被剥掉，避免注释里的示例色被计入。
 */
export interface CssPalette {
  /** 颜色字面量 → 出现次数（已小写化、压缩空白）。 */
  colors: Map<string, number>;
  /** 使用到的 `var(--x)`。 */
  usedVariables: Set<string>;
  /** 声明过的 `--x:`（自定义属性定义）。 */
  definedVariables: Set<string>;
}

/** hex 与函数式颜色；允许函数括号里再嵌一层（`rgb(8 13 16 / var(--x))`）。 */
const COLOR_PATTERN = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\((?:[^()]|\([^()]*\))*\)/g;
const VARIABLE_USE_PATTERN = /var\(\s*(--[a-z0-9-]+)\s*\)/gi;
const VARIABLE_DEFINITION_PATTERN = /(--[a-z0-9-]+)\s*:/gi;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 字面量规范化：大小写与空白差异不应算作两种颜色。 */
export function normalizeColorLiteral(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function collectCssPalette(source: string): CssPalette {
  const text = stripComments(source);
  const colors = new Map<string, number>();
  for (const match of text.matchAll(COLOR_PATTERN)) {
    const literal = normalizeColorLiteral(match[0]);
    colors.set(literal, (colors.get(literal) ?? 0) + 1);
  }

  const usedVariables = new Set<string>();
  for (const match of text.matchAll(VARIABLE_USE_PATTERN)) usedVariables.add(match[1]!);
  const definedVariables = new Set<string>();
  for (const match of text.matchAll(VARIABLE_DEFINITION_PATTERN)) definedVariables.add(match[1]!);

  return { colors, usedVariables, definedVariables };
}

/** 用了但没定义的 `var(--x)`：这类拼写错误会让整条声明静默失效。 */
export function undefinedVariables(palette: CssPalette): string[] {
  return [...palette.usedVariables].filter((name) => !palette.definedVariables.has(name)).sort();
}

/** 出现次数最多的颜色，便于人工评审时先看热点。 */
export function topColors(palette: CssPalette, limit = 10): Array<[string, number]> {
  return [...palette.colors.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}
