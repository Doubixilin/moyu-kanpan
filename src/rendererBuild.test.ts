import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

describe("settings renderer build contract", () => {
  it("emits the runtime module imported by the settings page", async () => {
    const root = process.cwd();
    const entry = await readFile(path.join(root, "src", "settingsRenderer.ts"), "utf8");
    const builder = await readFile(path.join(root, "scripts", "build-renderer.mjs"), "utf8");
    const verifier = await readFile(
      path.join(root, "scripts", "verify-electron-build.mjs"),
      "utf8"
    );

    assert.match(entry, /from "\.\/shortcut\.js"/);
    assert.match(builder, /compileTypeScript\("src\/shortcut\.ts",\s*"shortcut\.js"\)/);
    assert.match(verifier, /verifyRendererImports/);
    // 构建契约：渲染器 import 的模块必须都在 emit 清单里，否则打包后运行时 404。
    for (const emitted of [
      "src/settings/views.ts",
      "src/settings/fields.ts",
      "src/settings/uiState.ts",
      "src/settings/controllers/ports.ts",
      "src/settings/controllers/ai.ts",
      "src/settings/controllers/bossKey.ts",
      "src/settings/controllers/profile.ts",
      "src/domain/errors.ts",
      "src/domain/appSnapshotShape.ts",
      "src/presentation/publicSnapshot.ts",
      "src/presentation/format.ts"
    ]) {
      assert.ok(builder.includes(emitted), `${emitted} 未加入 build-renderer 的编译清单`);
    }
    // 控制器必须由渲染器以值导入（否则它们只是死代码，拆分等于没做）。
    for (const controller of [
      "controllers/ai.js",
      "controllers/bossKey.js",
      "controllers/profile.js"
    ]) {
      assert.match(entry, new RegExp(controller.replace(/[/.]/g, "\\$&")));
    }
    // 页面标签与设置页样式类在 §4-5 拆分后位于 views.ts（纯视图构造函数）。
    const views = await readFile(path.join(root, "src", "settings", "views.ts"), "utf8");
    for (const label of ["窗口与页面", "持仓与提醒", "自选与行情", "新闻与 AI", "导入与备份"]) {
      assert.match(views, new RegExp(label));
    }
    assert.match(views, /settings-page-section/);
    assert.match(entry, /handleHoldingRuleToggle/);
    assert.match(entry, /当日有买卖时，今日盈亏仅供参考/);
  });

  it("builds the lightweight Excel appearance as an independent renderer", async () => {
    const root = process.cwd();
    const entry = await readFile(path.join(root, "src", "excelRenderer.ts"), "utf8");
    const styles = await readFile(path.join(root, "src", "excel.css"), "utf8");
    const builder = await readFile(path.join(root, "scripts", "build-renderer.mjs"), "utf8");
    const main = await readFile(path.join(root, "electron", "main.ts"), "utf8");

    assert.match(builder, /compileTypeScript\("src\/excelRenderer\.ts",\s*"excel\.js"\)/);
    assert.match(builder, /writeHtml\("excel\.html"/);
    assert.match(main, /function createExcelWindow/);
    assert.match(main, /打开月度工作台/);
    assert.match(entry, /项目总览/);
    assert.match(entry, /data-ribbon/);
    assert.match(styles, /\.formula-bar/);
    assert.match(styles, /\.sheet-grid/);
    assert.doesNotMatch(entry, /xlsx|formulaEngine|spreadsheet/i);
  });

  it("builds the local work webpage as an independent strict-CSP renderer", async () => {
    const root = process.cwd();
    const entry = await readFile(path.join(root, "src", "workRenderer.ts"), "utf8");
    const styles = await readFile(path.join(root, "src", "workweb.css"), "utf8");
    const builder = await readFile(path.join(root, "scripts", "build-renderer.mjs"), "utf8");
    const main = await readFile(path.join(root, "electron", "main.ts"), "utf8");

    assert.match(builder, /compileTypeScript\("src\/workRenderer\.ts",\s*"workweb\.js"\)/);
    assert.match(builder, /writeHtml\("work\.html"/);
    assert.match(main, /LocalWorkWebServer/);
    assert.match(main, /打开项目工作网页/);
    assert.match(entry, /EventSource/);
    assert.match(entry, /内容保存在当前浏览器/);
    assert.match(styles, /\.portal-columns/);
    assert.match(entry, /escapeHtml\(item\.text\)/);
    assert.match(entry, /safeUrl\(item\?\.url\)/);
  });
});
