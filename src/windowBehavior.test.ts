import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { DEFAULT_BOSS_KEY_ACCELERATOR } from "./shortcut";

describe("boss key window safety", () => {
  it("does not use a function key as the default global shortcut", () => {
    assert.doesNotMatch(DEFAULT_BOSS_KEY_ACCELERATOR, /\+F\d+$/);
  });

  it("prevents fullscreen/maximize and never persists transient fullscreen bounds", async () => {
    const main = await readFile(path.join(process.cwd(), "electron", "main.ts"), "utf8");
    assert.match(main, /maximizable:\s*false/);
    assert.match(main, /fullscreenable:\s*false/);

    const persistStart = main.indexOf("async function persistWindowBounds");
    const persistEnd = main.indexOf("function restoreConfiguredAlwaysOnTop", persistStart);
    const persist = main.slice(persistStart, persistEnd);
    assert.match(persist, /isMaximized\(\)/);
    assert.match(persist, /isFullScreen\(\)/);
  });
});
