# 摸鱼看盘

一个面向 Windows 与 macOS 使用场景的半透明桌面悬浮窗，用于低干扰查看 A 股行情、持仓规则提醒、法定公告与 AI 事件简析。应用名称统一为“摸鱼看盘”。

本项目以源码可用方式发布，允许个人研究、修改和非商业分发；商业使用不被许可。它不是 MIT 协议，也不属于 OSI 定义的开源软件，详见 [LICENSE](LICENSE)。

## 功能

- Electron 透明、无边框、置顶窗口
- 自选 A 股行情轮询，默认东方财富，失败时自动切换腾讯行情
- 东方财富 7x24 快讯、巨潮资讯、上交所/深交所公告和证监会政策源
- 新闻文档写入本地 SQLite，按 URL、标题、证券代码和相似度去重聚类；官方公告优先作为事实根节点
- 巨潮失败时按市场回退到交易所公告；单一来源失败会保留历史并退避重试
- 点击新闻打开原文链接
- 设置页可配置 DeepSeek 或 OpenAI-compatible API，输出结构化事件、方向、机制、证据与反向因素
- AI 请求不会读取持仓数量、成本价或账户规模；股票相关性仅来自当前用户配置与新闻正文命中
- 重要事件按“留意 / 核验 / 立即查看”表达查看优先级，并显示当前相对主要指数表现
- 支持一键复制脱敏事件上下文供 Coze 深度核验，不包含账户和仓位私密数据
- 无 API Key 时使用本地规则分析，避免功能空白
- 托盘菜单及全局快捷键支持显示/隐藏和点击穿透恢复
- macOS 仅托盘驻留时同步隐藏 Dock，菜单栏使用鱼形行情 Logo 的单色 Template Image
- Windows NSIS 与 macOS DMG 均使用 `electron-builder` 独立打包

## 开发

```bash
npm ci
npm test
npm run build
npm run smoke:data
npm run smoke:news
npm run smoke:profile
npm start
```

本机如果 Electron 二进制下载缓慢，可以先运行：

```bash
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install
```

这种方式可以跑测试和 TypeScript 构建，但启动 Electron 需要后续补齐 Electron 二进制。若下载较慢，可以尝试：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm rebuild electron
```

## 配置

默认配置在 `config/defaults.json`：

- `watchlist`: 自选股代码
- `pollIntervals.quotesMs`: 行情轮询间隔
- `pollIntervals.newsMs`: 快讯轮询间隔
- `providers.quote`: `eastmoney` 或 `tencent`
- `appearance.backgroundOpacity`: 初始背景不透明度

默认配置不含持仓。`config/example-profile.json` 是可导入的公开模拟组合，四只代表性股票的模拟成本合计约 20 万元；其中警戒线只用于演示字段和影子模式，不会自动成为用户配置。

AI 配置优先通过应用设置页完成。API Key 由 Electron 主进程使用系统安全存储加密保存；Windows 使用系统凭据保护能力，macOS 使用 Keychain。普通设置文件和渲染进程均无法读取明文，安全存储不可用时会拒绝明文保存。DeepSeek 默认配置为：

```text
API 地址：https://api.deepseek.com
模型：deepseek-v4-flash
模式：关闭深度思考，JSON Output
```

环境变量仅作为开发或旧配置兼容入口：

```bash
AI_API_KEY=...
AI_API_BASE_URL=https://api.deepseek.com
AI_MODEL=deepseek-v4-flash
```

应用会尝试读取以下位置的 `.env`，已存在的系统环境变量优先：

1. Electron 用户数据目录
2. 可执行文件所在目录
3. 当前工作目录（仅开发模式）

远程 AI API 地址必须使用 HTTPS；只有 `localhost`、`127.0.0.1` 和 `::1` 允许 HTTP。

快捷键：

- 默认老板键 `CommandOrControl+Shift+Space`：显示/隐藏窗口，可在设置页录制其他组合键
- `CommandOrControl+Alt+X`：开启/关闭点击穿透；冲突时自动尝试 `CommandOrControl+Shift+F12`、`CommandOrControl+Alt+F10` 和 `CommandOrControl+Shift+F10`

## 数据源说明

行情默认接入东方财富公开网页端接口，请求超时、失败或返回空数据时自动切换腾讯行情。事件来源按可靠性分层：巨潮和交易所公告属于法定披露，证监会属于监管政策源，东方财富 7×24 属于快速媒体线索。法定披露失败时按证券市场回退到对应交易所；媒体或政策源失败时继续显示本地历史事件，不把空抓取误当成“没有新闻”。

事件、来源健康和 AI 重试状态保存在 Electron 用户数据目录的 `news-events.sqlite`。API Key 仍单独由 `safeStorage` 加密保存，不进入事件数据库。上述公开网页端接口没有 SLA，只适合个人低频使用。

“仅交易时段提醒”按 9:30–11:30、13:00–15:00（上海时区）判断，不把集合竞价当作连续交易。法定休市表按年度维护；未收录年份仍会按工作日与周末降级判断，发布新年度版本前应更新交易所休市日。

## Windows 打包

```bash
npm run package:win
```

Windows 打包需要能下载 Electron 和 electron-builder 相关二进制。当前已在 Windows x64 上验证 NSIS 安装包构建成功；窗口透明、置顶、托盘和点击穿透行为仍应在每次相关修改后做一次短 GUI 验收。

## macOS 开发与打包

macOS 开发命令与上面的通用开发流程相同。`npm start` 会构建后启动 Electron；默认“仅托盘驻留”会隐藏 Dock 图标，仍可通过菜单栏图标和全局老板键显示或隐藏主窗口。

在 Intel 或 Apple Silicon Mac 上运行：

```bash
npm run package:mac
```

脚本会检测当前 Node 进程架构，只构建本机的 `x64` 或 `arm64` 产物。输出位于 `release/`：

- `release/mac-<arch>/摸鱼看盘.app`
- `release/摸鱼看盘-<version>-<arch>.dmg`

产物使用临时 ad-hoc 签名，适合本机开发验收；当前阶段没有 Developer ID 签名或公证，不用于正式互联网分发。打包校验会检查 ASAR 必需文件，并拒绝 `.env`、`personal.local.json`、疑似 API Key、开发机绝对路径和开发依赖。

macOS 应用图标来自 `resources/icons/app.icns`，菜单栏使用 `trayTemplate.png` 和 `trayTemplate@2x.png`。它们都由正式母版 `resources/icons/app.png` 生成；需要重建资产时，在装有 Pillow 和 Xcode Command Line Tools 的 macOS 开发机运行：

```bash
python3 scripts/generate-macos-icons.py resources/icons/app.png resources/icons
```

生成后的 `.icns` 和 Template Image 已提交到仓库，正常构建和打包不依赖 Python。

可单独验证本机 Electron 安全存储与系统通知支持：

```bash
npm run smoke:safe-storage
npm run smoke:ai-credential
```

## 免责声明

本工具只用于信息展示和新闻摘要，不构成投资建议。

## 许可证

[PolyForm Noncommercial License 1.0.0](LICENSE)：非商业用途可使用、修改和分发；商业用途未获授权。
