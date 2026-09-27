import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { collectCssPalette, undefinedVariables } from "./cssPalette";

/**
 * 调色板预算（审计报告 §4-10）：当前实测的去重颜色字面量数量。
 *
 * 这是"只降不升"的棘轮：新增近似色会让测试失败，必须先在评审里说明用途，
 * 或合并到已有颜色后把预算调低。做设计收敛（合并近似灰、统一涨跌色）时请同步下调。
 */
const COLOR_BUDGETS: Record<string, number> = {
  "src/styles.css": 75,
  "src/settings.css": 86,
  "src/quick.css": 15,
  "src/excel.css": 71,
  "src/workweb.css": 85
};

function read(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("css palette parser", () => {
  it("counts hex and functional colors, ignoring comments and case", () => {
    const palette = collectCssPalette(`
      /* 示例色不应计入：#000000 */
      a { color: #FFF; border-color: #fff; background: rgb(8 13 16 / var(--widget-opacity)); }
      b { color: #FFFFFF; }
    `);
    assert.equal(palette.colors.get("#fff"), 2);
    assert.equal(palette.colors.get("#ffffff"), 1);
    assert.equal(palette.colors.get("#000000"), undefined);
    // 函数式颜色即使内嵌 var() 也要被识别为一个字面量
    assert.equal(palette.colors.get("rgb(8 13 16 / var(--widget-opacity))"), 1);
  });

  it("separates used variables from defined ones", () => {
    const palette = collectCssPalette(
      ":root { --brand: #fff; } a { color: var(--brand); background: var(--panel); }"
    );
    assert.deepEqual([...palette.definedVariables], ["--brand"]);
    assert.deepEqual(undefinedVariables(palette), ["--panel"]);
  });

  it("normalizes whitespace inside functional colors", () => {
    const palette = collectCssPalette("a { color: rgb(1,2,3); } b { color: rgb( 1 , 2 , 3 ); }");
    assert.equal(palette.colors.size, 2);
    assert.equal(palette.colors.get("rgb(1,2,3)"), 1);
    assert.equal(palette.colors.get("rgb( 1 , 2 , 3 )"), 1);
  });
});

describe("css palette budgets", () => {
  for (const [file, budget] of Object.entries(COLOR_BUDGETS)) {
    it(`${file} 的颜色种类不超过 ${budget}（且 var(--x) 都有定义）`, () => {
      const palette = collectCssPalette(read(file));
      assert.deepEqual(undefinedVariables(palette), [], `${file} 存在未定义的 var(--x)`);
      const distinct = palette.colors.size;
      assert.ok(
        distinct <= budget,
        `${file} 的去重颜色从 ${budget} 增加到 ${distinct}：新增颜色前请先确认是否该复用已有色，` +
          `或与设计一起收敛（见 docs/2026-09-25-code-audit.md §4-10）`
      );
    });
  }
});
