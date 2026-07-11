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
    assert.match(
      builder,
      /compileTypeScript\("src\/shortcut\.ts",\s*"shortcut\.js"\)/
    );
    assert.match(verifier, /verifyRendererImports/);
    for (const label of ["窗口与页面", "持仓与提醒", "自选与行情", "新闻与 AI", "导入与备份"]) {
      assert.match(entry, new RegExp(label));
    }
    assert.match(entry, /settings-page-section/);
    assert.match(entry, /handleHoldingRuleToggle/);
  });
});
