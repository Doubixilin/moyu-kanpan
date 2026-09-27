/**
 * Electron 运行时 API 冒烟（用于 §7-1 的版本升级验证）。
 *
 * 目的：在**不把窗口显示到用户桌面**的前提下，把应用真正依赖的 Electron 能力跑一遍，
 * 因为"能构建"并不等于"运行时 API 还在"。所有窗口都以 `show: false` 创建。
 *
 * 覆盖：透明/无边框窗口选项、`setAlwaysOnTop(…, "screen-saver")`、点击穿透、
 * `setMovable/setResizable/setMaximizable/setFullScreenable/setSkipTaskbar`、
 * 隐藏窗口加载真实渲染器页面（sandbox + contextIsolation + preload 的 CJS 桥）、
 * 托盘与上下文菜单、全局快捷键注册/注销、`safeStorage` 往返、`screen`、
 * `session` 权限处理器、主进程里的 `node:sqlite`。
 *
 * 运行：`npm run smoke:electron`（需要 electron 二进制，CI 不跑）。
 * 注意：若环境里设了 `ELECTRON_RUN_AS_NODE=1`（某些 agent/CLI 环境会设），Electron 会退化成
 * 纯 Node、`require("electron")` 拿到的是二进制路径，必须先清掉这个变量。
 * 说明：它验证的是"API 可用"，**不**替代人眼确认透明度/托盘菜单/老板键的实际观感。
 *
 * 必须是 `.cjs`：只有 CommonJS 主入口里的 `require("electron")` 才会解析成 Electron
 * 内置模块，ESM 里拿到的是 npm 包导出的二进制路径字符串。
 */
const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  screen,
  session,
  Tray
} = require("electron");
const { readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { DatabaseSync } = require("node:sqlite");

if (!process.versions.electron) {
  // 常见原因：ELECTRON_RUN_AS_NODE=1（Electron 退化成纯 Node，require("electron") 只给出二进制路径）。
  console.error(
    "[smoke:electron] 当前进程不是 Electron 运行时" +
      (process.env.ELECTRON_RUN_AS_NODE
        ? "：请先清除环境变量 ELECTRON_RUN_AS_NODE 再运行。"
        : "：请用 electron 二进制启动本脚本。")
  );
  process.exit(1);
}

const root = process.cwd();
// 固定路径的隔离 userData：绝不碰用户真实的 settings/凭据；启动前清一次即可，
// 退出时不再删除（Chromium 子进程此刻仍持有句柄，删了会 EPERM）。
const userData = path.join(tmpdir(), "moyu-electron-smoke");
try {
  require("node:fs").rmSync(userData, { recursive: true, force: true });
} catch {
  // 上一轮残留被占用也无所谓：Electron 会复用该目录。
}
app.setPath("userData", userData);

const results = [];

function check(name, run) {
  try {
    const detail = run();
    results.push({ name, ok: true, detail: detail ?? null });
  } catch (error) {
    results.push({
      name,
      ok: false,
      detail: error instanceof Error ? error.message : String(error)
    });
  }
}

async function main() {
  await app.whenReady();

  check("screen.getPrimaryDisplay().workArea", () => {
    const area = screen.getPrimaryDisplay().workArea;
    if (!area || area.width <= 0 || area.height <= 0) throw new Error("work area 不可用");
    return `${area.width}x${area.height}`;
  });

  check("safeStorage 往返", () => {
    if (!safeStorage.isEncryptionAvailable()) return "不可用（跳过往返）";
    const encrypted = safeStorage.encryptString("老板键-冒烟-测试");
    const plain = safeStorage.decryptString(encrypted);
    if (plain !== "老板键-冒烟-测试") throw new Error("解密结果不一致");
    return `backend=${safeStorage.getSelectedStorageBackend?.() ?? "n/a"}`;
  });

  check("session 权限处理器", () => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false)
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    return "已安装";
  });

  check("node:sqlite", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("create table t(a integer)");
    db.prepare("insert into t values (?)").run(42);
    const row = db.prepare("select a from t").get();
    db.close();
    if (row?.a !== 42) throw new Error("查询结果不一致");
    return "insert/select 正常";
  });

  check("globalShortcut 注册/注销", () => {
    const accelerator = "CommandOrControl+Alt+Space";
    if (!globalShortcut.register(accelerator, () => undefined)) {
      throw new Error("默认老板键注册失败（可能被其他程序占用）");
    }
    globalShortcut.unregister(accelerator);
    return accelerator;
  });

  check("Tray + 上下文菜单", () => {
    const icon = nativeImage.createFromPath(path.join(root, "resources", "icons", "tray.png"));
    if (icon.isEmpty()) throw new Error("托盘图标加载失败");
    const tray = new Tray(icon);
    tray.setToolTip("冒烟测试");
    tray.setContextMenu(Menu.buildFromTemplate([{ label: "占位", enabled: false }]));
    tray.destroy();
    return "创建/菜单/销毁正常";
  });

  const window = new BrowserWindow({
    width: 420,
    height: 620,
    x: -4000,
    y: -4000,
    show: false,
    transparent: true,
    frame: false,
    resizable: true,
    movable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    icon: path.join(root, "resources", "icons", "app-256.png"),
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(root, "dist-electron", "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  check("窗口行为（置顶/穿透/锁定）", () => {
    window.setAlwaysOnTop(true, "screen-saver");
    window.setIgnoreMouseEvents(true, { forward: true });
    window.setMovable(false);
    window.setResizable(false);
    window.setMaximizable(false);
    window.setFullScreenable(false);
    window.setSkipTaskbar(true);
    window.setIgnoreMouseEvents(false);
    return `visible=${window.isVisible()} alwaysOnTop=${window.isAlwaysOnTop()}`;
  });

  const rendererConsole = [];
  window.webContents.on("console-message", (event) => {
    rendererConsole.push(`${event.level ?? "log"}: ${event.message ?? ""}`);
  });

  try {
    // 注册最小 IPC，让设置页能真正完成首屏（真实主进程会提供这些通道）。
    // dist-electron 是 ESM，动态 import 必须给 file:// URL（Windows 绝对路径不行）。
    const { loadAppConfigFromObject, toUserSettings } = await import(
      pathToFileURL(path.join(root, "dist-electron", "src", "config.js")).href
    );
    const defaults = JSON.parse(readFileSync(path.join(root, "config", "defaults.json"), "utf8"));
    ipcMain.handle("settings:get", () => toUserSettings(loadAppConfigFromObject(defaults, {})));
    ipcMain.handle("profile:hasBackup", () => false);
    ipcMain.handle("ai:status", () => ({
      enabled: false,
      configured: false,
      secureStorageAvailable: false,
      credentialSource: "none",
      state: "unconfigured",
      provider: "deepseek",
      model: "smoke",
      lastTestedAt: null,
      lastSuccessAt: null,
      message: "冒烟测试"
    }));

    await window.loadFile(path.join(root, "dist", "settings.html"));
    check("隐藏窗口加载真实设置页", () => "did-finish-load");
    const bridged = await window.webContents.executeJavaScript(
      "typeof window.floatingStock === 'object' && typeof window.floatingStock.saveSettings === 'function'"
    );
    check("contextBridge 暴露 preload API", () => {
      if (bridged !== true) throw new Error("window.floatingStock 未暴露");
      return "floatingStock.saveSettings 可见";
    });

    // 首屏要等 settings:get 回来，轮询若干次再断言。
    let controls = 0;
    for (let attempt = 0; attempt < 40 && controls <= 0; attempt += 1) {
      controls = await window.webContents.executeJavaScript(
        "document.querySelectorAll('button[data-action]').length"
      );
      if (controls <= 0) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    let bodyText = "";
    if (controls <= 0) {
      bodyText = await window.webContents
        .executeJavaScript("document.body.innerText.slice(0, 200)")
        .catch(() => "");
      // 首屏仍停在"正在读取设置…"时，直接探测三个启动 IPC 各自的归宿。
      bodyText +=
        " | probe=" +
        (await window.webContents
          .executeJavaScript(
            `Promise.race([
               Promise.allSettled([
                 window.floatingStock.getSettings(),
                 window.floatingStock.getAiStatus(),
                 window.floatingStock.hasProfileBackup()
               ]).then((r) => JSON.stringify(r.map((x) => x.status))),
               new Promise((resolve) => setTimeout(() => resolve("timeout"), 1500))
             ])`
          )
          .catch((error) => "probe-error:" + String(error)));
    }
    check("设置页在 Electron 44 下完成首屏渲染", () => {
      if (controls <= 0) {
        throw new Error(
          `未找到设置页交互元素（渲染器可能未启动）；body=${JSON.stringify(bodyText)}；console=${rendererConsole.slice(-3).join(" | ") || "无"}`
        );
      }
      return `${controls} 个 data-action 控件`;
    });

    // 其余 4 个渲染器都是模块顶层同步写首屏标记，因此"根节点有子元素"就等价于
    // "脚本在 Chromium 152 下真的执行了"（模块加载失败/CSP 拦截都会留空）。
    for (const page of [
      { file: "index.html", rootId: "#root", label: "悬浮窗" },
      { file: "quick.html", rootId: "#quick-root", label: "速览" },
      { file: "excel.html", rootId: "#excel-root", label: "月度工作台" },
      { file: "work.html", rootId: "#work-root", label: "项目工作网页" }
    ]) {
      const consoleFrom = rendererConsole.length;
      await window.loadFile(path.join(root, "dist", page.file));
      let children = 0;
      for (let attempt = 0; attempt < 20 && children <= 0; attempt += 1) {
        children = await window.webContents.executeJavaScript(
          `(document.querySelector(${JSON.stringify(page.rootId)})?.childElementCount) ?? 0`
        );
        if (children <= 0) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const pageErrors = rendererConsole
        .slice(consoleFrom)
        .filter((line) => line.startsWith("error"));
      check(`渲染器首屏：${page.label}`, () => {
        if (children <= 0) {
          throw new Error(
            `${page.rootId} 没有子元素（脚本未执行）；console=${pageErrors.slice(-2).join(" | ") || "无"}`
          );
        }
        return `${children} 个子元素${pageErrors.length ? `（控制台 ${pageErrors.length} 条 error，多为 file:// 下缺少 IPC）` : ""}`;
      });
    }
  } catch (error) {
    check("隐藏窗口加载真实设置页", () => {
      throw error;
    });
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }

  const failed = results.filter((entry) => !entry.ok);
  console.log(
    JSON.stringify(
      {
        electron: process.versions.electron,
        node: process.versions.node,
        chrome: process.versions.chrome,
        results
      },
      null,
      2
    )
  );
  if (failed.length > 0) {
    console.error(
      `[smoke:electron] ${failed.length} 项失败：${failed.map((entry) => entry.name).join("、")}`
    );
  }
  // 用 app.exit 明确退出码：app.quit() 之后主进程可能在子进程收尾时抛 EPERM 并掩盖真实结果。
  app.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(
    "[smoke:electron] 失败：" + (error instanceof Error ? error.message : String(error))
  );
  app.exit(1);
});
