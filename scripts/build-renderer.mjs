import ts from "typescript";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const assets = path.join(dist, "assets");

await mkdir(assets, { recursive: true });

await compileTypeScript("src/renderer.ts", "main.js");
await compileTypeScript("src/settingsRenderer.ts", "settings.js");
await compileTypeScript("src/shortcut.ts", "shortcut.js");
await compileTypeScript("src/domain/news.ts", "domain/news.js");
await compileTypeScript("src/domain/decision.ts", "domain/decision.js");
await copyFile(path.join(root, "src/styles.css"), path.join(assets, "main.css"));
await copyFile(path.join(root, "src/settings.css"), path.join(assets, "settings.css"));

await writeHtml("index.html", {
  title: "摸鱼看盘",
  rootId: "root",
  css: "main.css",
  script: "main.js"
});

await writeHtml("settings.html", {
  title: "摸鱼看盘设置",
  rootId: "settings-root",
  css: "settings.css",
  script: "settings.js"
});

async function compileTypeScript(sourcePath, outputName) {
  const source = await readFile(path.join(root, sourcePath), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      strict: true
    },
    fileName: path.basename(sourcePath),
    reportDiagnostics: true
  });

  const errors = (compiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  if (errors.length > 0) {
    throw new Error(
      errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n")
    );
  }

  const outputPath = path.join(assets, outputName);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, compiled.outputText, "utf8");
}

async function writeHtml(fileName, page) {
  await writeFile(
    path.join(dist, fileName),
    `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${page.title}</title>
    <link rel="stylesheet" href="./assets/${page.css}" />
  </head>
  <body>
    <div id="${page.rootId}"></div>
    <script type="module" src="./assets/${page.script}"></script>
  </body>
</html>
`,
    "utf8"
  );
}
