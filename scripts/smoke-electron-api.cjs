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
    // 造一份带"一只持仓 + 一个有提醒规则 + 一个自定义页"的配置：
    // §4-6 的交互检查需要 details.holding-rule-details 与可点击的"清空规则"。
    const smokeSettings = toUserSettings(loadAppConfigFromObject(defaults, {}));
    smokeSettings.holdings = [
      {
        securityCode: smokeSettings.securities[0].code,
        quantity: 100,
        costPrice: 10,
        groupId: "all",
        note: "",
        alertRules: {
          enabled: true,
          stopLossPrice: 9,
          watchPrice: null,
          priceAbove: null,
          priceBelow: null,
          risePercent: null,
          fallPercent: null,
          dailyProfitAmount: null,
          dailyLossAmount: null,
          totalProfitAmount: null,
          totalLossAmount: null
        }
      }
    ];
    smokeSettings.tabs = [
      ...smokeSettings.tabs,
      {
        id: "smoke-custom",
        type: "stock-list",
        title: "冒烟列表",
        builtIn: false,
        visible: true,
        order: smokeSettings.tabs.length,
        securityCodes: [],
        maxItems: 8,
        newsMode: "watchlist_related"
      }
    ];
    ipcMain.handle("settings:get", () => smokeSettings);
    ipcMain.handle("profile:hasBackup", () => false);
    // 固定返回"校验通过且有变化"，让预览/确认导入按钮都进入可用状态。
    ipcMain.handle("profile:preview", (_event, request) => ({
      valid: true,
      hasChanges: true,
      mode: request?.mode === "replace" ? "replace" : "merge",
      issues: [],
      diff: {
        securitiesAdded: [],
        securitiesUpdated: [],
        holdingsAdded: [],
        holdingsUpdated: [],
        holdingsRemoved: [],
        watchlistAdded: [],
        watchlistUpdated: [],
        watchlistRemoved: [],
        alertRuleChanges: 0,
        riskSettingsChanged: false
      }
    }));
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

    // —— §4-6：整页重渲染导致的"焦点/光标丢失 + 展开的面板自己收起" ——
    // 设置页所有分区都在 DOM 里，但只有当前分类可见（display:none 的输入框无法获得焦点），
    // 因此先切到"持仓与提醒"再操作。
    const evaluate = (code) => window.webContents.executeJavaScript(code);
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const readUiState = `
      (() => {
        const details = document.querySelector('details.holding-rule-details');
        const active = document.activeElement;
        return {
          detailsOpen: details ? details.open : null,
          activeSetting: active && active.dataset ? (active.dataset.setting ?? active.tagName) : null,
          caret: active && typeof active.selectionStart === 'number' ? active.selectionStart : null,
          message: (document.getElementById('settings-message')?.textContent ?? '').trim()
        };
      })()
    `;
    const focusNote = `
      (() => {
        const input = document.querySelector('input[data-setting="holding-note"]');
        input.value = 'abc';
        input.focus();
        input.setSelectionRange(1, 1);
        return document.activeElement === input;
      })()
    `;

    await evaluate(`
      (() => {
        document.querySelector('button[data-action="settings-page"][data-page="portfolio"]').click();
        return true;
      })()
    `);
    await delay(200);

    const opened = await evaluate(`
      (() => {
        const details = document.querySelector('details.holding-rule-details');
        if (!details) return 'missing';
        details.querySelector('summary').click();
        return details.open;
      })()
    `);
    check("展开持仓规则面板", () => {
      if (opened !== true) throw new Error("details 未能展开：" + opened);
      return "open=true";
    });

    if ((await evaluate(focusNote)) !== true) {
      check("隐藏窗口里输入框可获得焦点", () => {
        throw new Error("无法聚焦持仓备注输入框，后续断言无意义");
      });
    }

    // 点"清空规则"：会 showMessage →（修复前）整页重渲染 → 面板收起 + 输入框失焦
    await evaluate(`
      (() => {
        const input = document.querySelector('input[data-setting="holding-note"]');
        input.value = 'abc';
        input.focus();
        input.setSelectionRange(1, 1);
        document.querySelector('button[data-action="clear-holding-rules"]').click();
        return true;
      })()
    `);
    await delay(250);
    const afterMessage = await evaluate(readUiState);
    check("提示类操作保留焦点/光标/展开状态与提示本身（§4-6）", () => {
      if (!afterMessage.detailsOpen) throw new Error("展开的 details 被收起");
      if (afterMessage.activeSetting !== "holding-note") {
        throw new Error("焦点丢失，activeElement=" + afterMessage.activeSetting);
      }
      if (afterMessage.caret !== 1) throw new Error("光标位置丢失，caret=" + afterMessage.caret);
      if (!afterMessage.message.includes("已清空")) {
        throw new Error("提示未显示：" + JSON.stringify(afterMessage.message));
      }
      return "焦点/光标/面板 open/提示均保留";
    });

    // 切换会触发整页重渲染的字段（ai-provider，在别的分区里也能派发 change）：
    // 这是无法避免的整页重建路径。先派发 input 把备注写进 settings，否则重建后
    // 输入框会被还原成空值，光标自然无处可放。
    await evaluate(`
      (() => {
        const input = document.querySelector('input[data-setting="holding-note"]');
        input.value = 'abc';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
        input.setSelectionRange(1, 1);
        const select = document.querySelector('select[data-setting="ai-provider"]');
        select.value = 'custom';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()
    `);
    await delay(250);
    const afterRerender = await evaluate(readUiState);
    check("必要整页重渲染后保留焦点与光标（§4-6）", () => {
      if (afterRerender.activeSetting !== "holding-note") {
        throw new Error("重渲染后焦点丢失，activeElement=" + afterRerender.activeSetting);
      }
      if (afterRerender.caret !== 1) {
        throw new Error("重渲染后光标位置丢失，caret=" + afterRerender.caret);
      }
      return "focus=" + afterRerender.activeSetting + " caret=" + afterRerender.caret;
    });

    // 滚动位置也应保留（否则每次提示都把用户弹回页首）
    const scrollKept = await evaluate(`
      (() => {
        const scrollable = document.body.scrollHeight > window.innerHeight + 200;
        window.scrollTo(0, 240);
        const before = window.scrollY;
        const select = document.querySelector('select[data-setting="risk-mode"]');
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return new Promise((resolve) =>
          setTimeout(() => resolve({ scrollable, before, after: window.scrollY }), 250)
        );
      })()
    `);
    check("整页重渲染后保留滚动位置", () => {
      if (!scrollKept.scrollable) return "页面不足一屏，跳过";
      if (Math.abs(scrollKept.after - scrollKept.before) > 2) {
        throw new Error(`滚动位置从 ${scrollKept.before} 变为 ${scrollKept.after}`);
      }
      return `scrollY=${scrollKept.after}`;
    });

    // —— §4-8：改了草稿后旧预览仍在屏幕上"说谎" ——
    const readProfileRegion = `
      (() => {
        const live = document.getElementById('profile-live');
        const apply = document.querySelector('button[data-action="apply-profile"]');
        const textarea = document.querySelector('textarea[data-setting="profile-text"]');
        return {
          hasPreview: Boolean(live && live.querySelector('.profile-diff-grid')),
          hasEmptyHint: Boolean(live && live.querySelector('.profile-empty')),
          applyDisabled: apply ? apply.disabled : null,
          focused: document.activeElement === textarea,
          caret: textarea ? textarea.selectionStart : null
        };
      })()
    `;

    await evaluate(`
      (() => {
        document.querySelector('button[data-action="settings-page"][data-page="data"]').click();
        return true;
      })()
    `);
    await delay(200);

    // 先把草稿敲进去：草稿一变，依赖草稿的整块（按钮禁用态 + 预览）都必须立刻跟上。
    const typed = await evaluate(`
      (() => {
        const textarea = document.querySelector('textarea[data-setting="profile-text"]');
        textarea.value = '{"profileVersion":1}';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return {
          previewDisabled: document.querySelector('button[data-action="preview-profile"]').disabled,
          clearDisabled: document.querySelector('button[data-action="clear-profile"]').disabled
        };
      })()
    `);
    check("输入草稿后预览/清空按钮立即可用（§4-8）", () => {
      if (typed.previewDisabled) throw new Error("敲进 JSON 后'预览差异'仍是禁用的，用户无从预览");
      if (typed.clearDisabled) throw new Error("'清空'仍是禁用的");
      return "预览/清空按钮已启用";
    });

    await evaluate(`
      (() => {
        document.querySelector('button[data-action="preview-profile"]').click();
        return true;
      })()
    `);
    await delay(300);
    const previewed = await evaluate(readProfileRegion);
    check("预览成功后按钮进入可用状态", () => {
      if (!previewed.hasPreview) throw new Error("预览结果没有渲染");
      if (previewed.applyDisabled !== false) throw new Error("确认导入仍不可用");
      return "预览可见 + 确认导入可用";
    });

    // 改一个字符：预览必须立刻失效、确认导入必须立刻禁用，同时光标不能丢
    const edited = await evaluate(`
      (() => {
        const state = () => {
          const live = document.getElementById('profile-live');
          if (!live) return 'missing';
          if (live.querySelector('.profile-diff-grid')) return 'preview';
          if (live.querySelector('.profile-empty')) return 'empty';
          return 'other';
        };
        const before = state();
        const textarea = document.querySelector('textarea[data-setting="profile-text"]');
        // 先改值再定位光标：直接赋 value 会把光标顶到末尾
        textarea.value = '{"profileVersion":1} ';
        textarea.focus();
        textarea.setSelectionRange(3, 3);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                before,
                hasPreview: Boolean(document.querySelector('#profile-live .profile-diff-grid')),
                hasEmptyHint: Boolean(document.querySelector('#profile-live .profile-empty')),
                applyDisabled: document.querySelector('button[data-action="apply-profile"]').disabled,
                focused: document.activeElement === textarea,
                caret: textarea === document.activeElement ? textarea.selectionStart : null
              }),
            200
          )
        );
      })()
    `);
    check("改动草稿后旧预览立即失效且不丢光标（§4-8）", () => {
      // 前置条件：改动之前屏幕上确实有一份预览，否则这条检查会"空过"
      if (edited.before !== "preview")
        throw new Error("改动前没有预览，检查不成立：" + edited.before);
      if (edited.hasPreview) throw new Error("旧预览仍留在屏幕上");
      if (!edited.hasEmptyHint) throw new Error("未显示'导入前不会修改任何设置'占位");
      if (edited.applyDisabled !== true) throw new Error("确认导入仍可点击");
      if (!edited.focused) throw new Error("文本框失去焦点");
      if (edited.caret !== 3) throw new Error("光标位置丢失，caret=" + edited.caret);
      return "预览已清空 + 确认导入禁用 + 光标保持";
    });

    // —— §4-2：主悬浮窗每次快照推送都整页重建 DOM ——
    const { emptyMarketOverview } = await import(
      pathToFileURL(path.join(root, "dist-electron", "src", "domain", "market.js")).href
    );
    const { emptyRiskSnapshot } = await import(
      pathToFileURL(path.join(root, "dist-electron", "src", "domain", "risk.js")).href
    );
    // 主窗口用一份独立的设置：多加 4 个可见页，逼出标签栏的溢出 <select>
    const mainSettings = structuredClone(smokeSettings);
    for (let index = 0; index < 4; index += 1) {
      mainSettings.tabs.push({
        id: "smoke-tab-" + index,
        type: "watchlist",
        title: "冒烟页" + index,
        builtIn: false,
        visible: true,
        order: 100 + index,
        securityCodes: [],
        maxItems: 8,
        newsMode: "watchlist_related"
      });
    }
    mainSettings.navigation = {
      ...mainSettings.navigation,
      defaultTabId: "watchlist",
      lastActiveTabId: "watchlist",
      rememberLastTab: true
    };
    const now = new Date().toISOString();
    const feedStatus = () => ({
      lastSuccessAt: now,
      dataUpdatedAt: now,
      lastChangedAt: now,
      stale: false,
      stalled: false,
      source: "eastmoney",
      coverage: 1,
      degraded: false,
      conflictCount: 0,
      retainedCount: 0,
      missingCount: 0,
      alertSafe: true,
      providerHealth: [],
      marketState: "trading"
    });
    const makeSnapshot = (price) => ({
      quotes: [
        {
          code: "600519",
          name: "贵州茅台",
          market: "SH",
          price,
          change: 0.12,
          changePercent: 1.23,
          open: price,
          previousClose: price - 0.12,
          high: price,
          low: price,
          volume: 1200,
          amount: 148000,
          source: "eastmoney",
          updatedAt: now,
          quality: { state: "fresh", receivedAt: now, reasons: [] }
        }
      ],
      news: [],
      market: emptyMarketOverview(),
      risk: emptyRiskSnapshot(),
      ai: {
        enabled: false,
        configured: false,
        secureStorageAvailable: false,
        credentialSource: "none",
        state: "unconfigured",
        provider: "deepseek",
        model: "smoke",
        lastTestedAt: null,
        lastSuccessAt: null,
        message: "冒烟"
      },
      errors: [],
      updatedAt: now,
      settings: mainSettings,
      feeds: { quotes: feedStatus(), news: feedStatus() },
      ui: { clickThrough: false }
    });

    await window.loadFile(path.join(root, "dist", "index.html"));
    window.webContents.send("snapshot:update", makeSnapshot(12.34));
    await delay(250);
    const mainReady = await evaluate(`
      (() => {
        const select = document.querySelector('select[data-action="tab-overflow"]');
        const tab = document.querySelector('.tabs button[data-action="tab"]');
        const body = document.querySelector('.page-body');
        if (!select || !tab || !body) {
          return { missing: { select: !select, tab: !tab, body: !body } };
        }
        // 记住节点身份，后面第二次推送后比对
        window.__mainProbe = { select, tab, ctButton: document.querySelector('button[data-action="click-through"]') };
        select.focus();
        select.selectedIndex = 1;
        return {
          focused: document.activeElement === select,
          priceText: body.textContent.includes('12.34')
        };
      })()
    `);
    check("悬浮窗首屏：标签溢出 select 可用且能获得焦点（§4-2 前置）", () => {
      if (mainReady.missing) throw new Error("缺少元素：" + JSON.stringify(mainReady.missing));
      if (!mainReady.focused) throw new Error("溢出 select 无法获得焦点");
      if (!mainReady.priceText) throw new Error("列表里没有渲染出报价");
      return "select 已聚焦 + 报价已渲染";
    });

    // 第二次推送：模拟行情刷新（价格变了）
    window.webContents.send("snapshot:update", makeSnapshot(56.78));
    await delay(250);
    const afterPush = await evaluate(`
      (() => {
        const probe = window.__mainProbe;
        const body = document.querySelector('.page-body');
        return {
          sameSelect: document.contains(probe.select),
          sameTab: document.contains(probe.tab),
          sameClickThroughButton: probe.ctButton ? document.contains(probe.ctButton) : false,
          focused: document.activeElement === probe.select,
          selectedIndex: probe.select.selectedIndex,
          priceUpdated: body.textContent.includes('56.78'),
          stalePrice: body.textContent.includes('12.34')
        };
      })()
    `);
    check("行情刷新后标签栏/工具按钮节点不被重建（§4-2）", () => {
      if (!afterPush.sameTab) throw new Error("标签按钮被整页重建（焦点与 :hover 会丢失）");
      if (!afterPush.sameSelect)
        throw new Error("溢出 select 被重建（下拉展开时用户切换会被打断）");
      if (!afterPush.sameClickThroughButton) throw new Error("工具按钮被重建");
      if (!afterPush.focused) throw new Error("焦点丢失");
      if (afterPush.selectedIndex !== 1) throw new Error("select 选中项被重置");
      return "标签栏/工具按钮/焦点/选中项均保留";
    });
    check("行情刷新后数据区仍然更新（§4-2）", () => {
      if (!afterPush.priceUpdated) throw new Error("价格没有更新——修 DOM 重建不能以冻结数据为代价");
      if (afterPush.stalePrice) throw new Error("旧价格仍在页面上");
      return "价格已从 12.34 更新为 56.78";
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
    // 设置页加载或交互脚本自身抛错：单独记一条，避免被误读成"某个断言失败"。
    check("设置页交互阶段（含 §4-6 检查）", () => {
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
