import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const preloadPath = path.join(root, "dist-electron", "electron", "preload.cjs");
const mainPath = path.join(root, "dist-electron", "electron", "main.js");
const rendererAssets = path.join(root, "dist", "assets");
const [preload, main] = await Promise.all([
  readFile(preloadPath, "utf8"),
  readFile(mainPath, "utf8")
]);

if (/^\s*import\s/m.test(preload)) {
  throw new Error("Electron preload must not contain ESM imports");
}
if (!preload.includes('require("electron")')) {
  throw new Error("Electron preload was not emitted as CommonJS");
}
if (!main.includes('"preload.cjs"')) {
  throw new Error("Electron main process does not reference preload.cjs");
}

// 5 个渲染器入口都要走一遍 import 闭包：此前只查 main.js/settings.js，
// 漏掉的模块（例如 work 页新引入的 publicSnapshot）要到运行时才 404。
// 这正是 smoke:electron 先发现"项目工作网页首屏为空"的原因。
await verifyRendererImports([
  path.join(rendererAssets, "main.js"),
  path.join(rendererAssets, "settings.js"),
  path.join(rendererAssets, "quick.js"),
  path.join(rendererAssets, "excel.js"),
  path.join(rendererAssets, "workweb.js")
]);

async function verifyRendererImports(entries) {
  const pending = [...entries];
  const visited = new Set();

  while (pending.length > 0) {
    const modulePath = pending.pop();
    if (!modulePath || visited.has(modulePath)) continue;
    visited.add(modulePath);

    const source = await readFile(modulePath, "utf8");
    const imports = source.matchAll(/\bfrom\s+["'](\.[^"']+)["']|\bimport\s+["'](\.[^"']+)["']/g);
    for (const match of imports) {
      const specifier = match[1] ?? match[2];
      const dependencyPath = path.resolve(path.dirname(modulePath), specifier);
      const relative = path.relative(rendererAssets, dependencyPath);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("Renderer import escapes assets: " + specifier);
      }
      try {
        await readFile(dependencyPath, "utf8");
      } catch {
        throw new Error(
          "Renderer module missing: " +
            path.relative(root, dependencyPath) +
            " imported by " +
            path.relative(root, modulePath)
        );
      }
      pending.push(dependencyPath);
    }
  }
}
