# 摸鱼看盘 最终发布前深度审计

> 审计日期：2026-07-11
> 审计基线：`5bf0bdd feat: streamline settings and portable profiles`
> 审计范围：现有功能的安全性、稳定性、正确性、使用便利性、打包独立性与开源准备；不新增产品功能。

## 1. 结论

修复后的 Windows 产物能够脱离源码目录独立启动，行情双源、市场数据、新闻多源、AI 降级、提醒状态机和配置导入均已通过自动化与真实接口复核。当前代码树可以作为 macOS 开发基线；公开发布前只剩 macOS 实机验收门槛。

本轮最初发现：

- 2 个 P0：打包版可受开发服务器环境变量影响；真实个人持仓资料已经进入 Git 历史。
- 15 个本轮应修 P1：覆盖请求冻结、配置损坏、新闻状态、AI 缓存、提醒语义、设置草稿和 Electron 边界。
- 7 个 P2/发布准备项：包含长期清理、打包防误发、平台文案、许可证和历史整理。

上述代码、数据、交互和发布项已全部修复并复验。许可证已确定为 PolyForm Noncommercial 1.0.0。新的私有仓库 `Doubixilin/moyu-kanpan` 仅包含单一干净根提交；原 `floating-stock-widget` 仓库保留为私有历史归档，不作为未来公开仓库。

## 2. 已执行验证

| 检查 | 结果 |
| --- | --- |
| Git 基线 | 工作区干净，`main` 已推送，远程仍为 `PRIVATE` |
| 单元/服务测试 | 135 项通过 |
| 测试覆盖率 | 行 91.23%，分支 72.77%，函数 87.70% |
| TypeScript 与 Electron 构建 | 通过 |
| npm 官方漏洞审计 | 生产依赖及完整依赖树均为 0 个已知漏洞 |
| 真实行情 smoke | 东财、腾讯双源一致；覆盖率 100%；市场概览、分时、日 K、BOLL 正常 |
| 真实新闻 smoke | 东财、巨潮、沪深交易所、证监会均成功；52 份文档聚合为 41 个事件，其中 6 个合并事件 |
| Windows unpacked/NSIS 打包 | Electron 39.8.10 x64 构建成功，安装包与 ASAR 新鲜度/清单校验通过 |
| ASAR 内容 | 包含 main、preload、两个页面、默认配置、许可证与生产依赖；不含个人配置和 `.env` |
| 独立运行 | 从空白临时工作目录和隔离 userData 启动；即使注入远程开发服务器环境变量，8 秒后主进程及 3 个子进程稳定存活 |
| 硬编码路径 | 当前代码树和解包后的 ASAR 均未发现开发机绝对路径；历史文档中的本机引用已移除 |
| 外部运行时 | 不需要用户安装 Node、Python、数据库或 VC++ 原生模块；SQLite 来自 Electron 内置 Node |

验证限制：本轮没有在 macOS 上实际运行透明窗口、Dock/托盘、通知、快捷键、签名或打包；Windows NSIS 安装/卸载也没有作为日常测试入口。

## 3. 发布阻断项（P0）

### P0-1 打包版仍可能加载开发服务器页面（已修复）

- 位置：`electron/main.ts` 的主窗口/设置窗口加载逻辑及 `.env` 搜索逻辑；`electron/preload.cts`。
- 触发：系统环境或启动目录 `.env` 中存在 `VITE_DEV_SERVER_URL`。
- 影响：安装版会加载外部页面，但仍向该页面注入完整 preload API。外部页面可读取持仓和成本、修改设置、操作配置导入及剪贴板。
- 伴随风险：生产态从任意当前工作目录读取 `.env`，还可能把安全存储中的 API Key 发往被覆盖的自定义端点。
- 已完成：
  - 仅 `!app.isPackaged` 时允许开发服务器。
  - 生产态始终加载 ASAR 内本地 HTML。
  - 生产态不得读取 `process.cwd()` 下的 `.env` 或个人 seed。
  - 禁止非预期导航和新窗口，并统一校验 IPC sender。

### P0-2 真实个人资料已经进入 Git 历史（已通过新仓库隔离解决）

- 位置：`src/settings/__tests__/profile.test.ts` 以及部分新闻/事件测试和 smoke 脚本。
- 内容：测试夹具复用了截图中的真实证券代码、持仓数量、精确成本和警戒线。
- 影响：仅在新提交中替换不能删除旧提交内容；仓库改为 public 后仍可从历史恢复个人交易资料。
- 当前状态：远程仍为私有，未发生公开披露；常见 API Key/token 模式在当前树和历史中的扫描结果为 0。
- 当前处理：
  - 当前树已全部改为通用标的与合成数值；公开示例为四只代表性股票、模拟成本合计 20 万元。
  - 已生成本地完整 Git bundle 备份，并建立仅含单一干净根提交的新仓库 `Doubixilin/moyu-kanpan`。
  - 原仓库继续保持私有并作为历史归档；未来只允许将新仓库转为公开，从而避免旧悬空对象随仓库可见性变化而暴露。

## 4. 已确认问题

### 4.1 本轮应修（P1）

以下 15 项均已完成修复并通过对应单元测试、构建或真实 smoke；表格保留原始证据与修复目标，便于后续回归。

| 编号 | 问题 | 影响与证据 | 最小修复方向 |
| --- | --- | --- | --- |
| P1-1 | HTTP 超时只覆盖响应头 | `src/providers/fetch.ts` 在 `fetch()` 返回后清除计时器；若 `json/text/arrayBuffer` 卡住，single-flight 永久不结束，行情或新闻只能靠重启恢复 | 让超时覆盖完整 body 消费，增加 body 卡死测试和合理体积上限 |
| P1-2 | 损坏设置会被静默覆盖 | `src/settings/store.ts` 把 JSON `SyntaxError` 当成空配置，随后写回默认值；当前 temp+copy 也不是原子替换 | 原子写入、last-known-good 备份、保留损坏文件并优先恢复备份 |
| P1-3 | 新闻 SQLite 损坏拖垮整个应用 | `SqliteNewsEventStore` 构造异常未隔离；一个可重建缓存会阻止行情、托盘和窗口启动 | 隔离损坏 DB/WAL/SHM 后重建，并显示新闻降级；避免退出时关闭 DB 与在途刷新竞争 |
| P1-4 | 新闻退避期间伪造“刚成功” | 未实际请求时 `fetchedAt` 仍为当前时间，主进程推进成功时间并清除降级；历史事件来源又被当作当前来源 | 返回真实 attempted/successful/lastSuccessfulAt；无新成功不得推进时间，缓存明确标记 |
| P1-5 | SQLite AI 分析没有 namespace | JSON 缓存按模型隔离，但事件表永久复用旧 `analysis_json`；切模型、端点或关联上下文后仍显示旧分析 | 保存 analysis namespace/输入指纹，读取时只接受当前 namespace |
| P1-6 | AI 可阻塞新闻展示数分钟 | 首次至少 20 个候选，最多 4 批串行且每批可重试；`latestNews` 等全部完成后才更新 | 先发布规则/缓存结果；每轮只处理有限 AI 批次，完成后增量更新 |
| P1-7 | profile 预览与应用不一致 | 合法但错误的市场枚举会通过；自选顺序/可见性变化无法进入 diff；允许 100 个但保存上限 50；`order` 被忽略 | 与统一市场推断比较；完整比较 watchlist；复用保存校验；超限直接报错 |
| P1-8 | 全局持仓上限受局部开关屏蔽 | `maxPositionValue` 候选只在该持仓局部提醒开启时生成；界面显示越线但不会通知 | 全局候选对所有持仓生成，局部开关只控制局部规则 |
| P1-9 | 规则停用再启用可能补发旧穿越 | 候选缺席期间旧状态仍保持 evaluable；同阈值重新启用后可能按停用前价格触发 | 对本轮缺席规则标为不可评估，重新出现时只 rebase 不补发 |
| P1-10 | 老板键隐藏设置后不恢复置顶 | 设置窗口打开时主窗取消置顶；设置窗被 hide 而非 close 后不会恢复 | settings hide/reveal 时重新同步配置的 always-on-top 状态 |
| P1-11 | 未保存设置可能被外部更新覆盖 | `onSettings` 无条件替换本地草稿；主窗切页、主题或托盘操作可让输入静默丢失 | 增加 dirty/revision，草稿存在时不整包覆盖并给出提示 |
| P1-12 | 每轮行情刷新重置长列表滚动 | `renderer.ts` 每次使用 `root.innerHTML` 重建页面，约 8 秒回到列表顶部 | 按页面保存/恢复滚动位置，避免更新打断浏览 |
| P1-13 | Electron 与 AI 传输边界不足 | 未限制导航/新窗口/IPC sender；自定义 API 允许非本机 HTTP 明文发送 Bearer Key | 限制导航与 sender；只允许 HTTPS，HTTP 仅限 loopback |
| P1-14 | 提醒状态落盘不可靠 | 提醒状态直接覆盖文件，退出时最后写入未等待；快速退出可能丢暂停、冷却和每日一次状态 | 原子写入；重要状态立即持久化；退出避免启动新工作并完成受控 flush |
| P1-15 | 来源空响应被记作成功 | 东财快讯或政策源 HTTP 200 但解析为空时会清除失败状态，不触发退避 | 对应源要求有效非空结果；规范化/入库成功后再记录来源成功 |

### 4.2 次要但应在公开前处理（P2）

以下项目均已处理：30 天新闻保留与 WAL checkpoint、9:30 连续交易边界、快捷键失败文案、发布目录清理与 ASAR 核验、macOS Dock 同步代码、系统通知文案、Node engines、许可证、作者邮箱移除及本机路径清理。年度休市表仍属于每年发布前的维护事项，macOS 行为仍需实机复核。

1. 新闻 SQLite 没有保留上限，长期托盘运行会持续增长；建议按明确保留期删除旧事件和孤立文档并 checkpoint。
2. 交易时段从 9:15 开始，导致集合竞价阶段允许“仅交易时段提醒”；应改为 9:30。交易日历仅内置 2026 年，未来年份需维护或明确降级策略。
3. 点击穿透快捷键全部注册失败时，托盘仍显示第一个候选键，形成错误提示。
4. `package:win` 不清理旧 `release`，打包失败后可能误用旧安装包；应采用隔离输出并校验 ASAR 清单。
5. macOS 的“仅托盘驻留”不能只依靠 `skipTaskbar`，后续应同步 Dock；“Windows 通知”应改为“系统通知”。
6. 项目未声明最低 Node 版本，而开发测试使用 `node:sqlite`；README 和 `engines` 应明确兼容要求。
7. 仓库没有 `LICENSE`。公开前必须由仓库所有者选择许可证；同时决定是否公开 package author 邮箱，并移除历史文档中的本机路径。

## 5. 修复完成情况

### A. 发布安全与数据保护（完成）

- 修 P0-1、P1-1、P1-2、P1-3、P1-13、P1-14。
- 当前树替换所有个人化测试夹具，但暂不重写历史。
- 验证：安全单测、损坏文件恢复测试、body 卡死测试、构建、独立 ASAR 启动。

### B. 数据与提醒正确性（完成）

- 修 P1-4 至 P1-9、P1-15。
- 增加新闻真实成功时间、AI namespace、增量 AI、profile 一致性和提醒 rebase 测试。
- 验证：全量测试、真实行情/新闻 smoke、AI mock 回归。

### C. 使用便利性与发布卫生（完成）

- 修 P1-10 至 P1-12，以及可无争议处理的 P2：9:30、快捷键提示、系统通知文案、Node engines、打包清单验证、无效本机路径。
- macOS Dock 行为留到 macOS 实机阶段验证。
- LICENSE 已采用 PolyForm Noncommercial 1.0.0；package author 已移除邮箱。Git 历史重写仍保留为用户决策点。

每批修复后都应保持工作区可构建、测试通过；全部完成后重新生成独立 Windows unpacked/NSIS 产物，并从空工作目录、隔离 userData 启动复验。

## 6. 已确认可靠的部分

- 行情已按证券粒度实现东财/腾讯 fallback、时间和字段一致性校验、跨源冲突保留以及不安全数据禁用提醒。
- 行情、市场、新闻均有 single-flight，正常情况下不会形成轮询重叠风暴。
- API Key 使用 Electron `safeStorage`；安全存储不可用时拒绝明文落盘；普通设置、快照、profile 和 AI 缓存均不含 Key。
- 新闻内容、标题和错误在写入 `innerHTML` 前经过 HTML/属性转义；外部链接只接受 HTTP(S)。
- SQLite 查询采用参数绑定，事务、WAL、外键和 busy timeout 已启用。
- 个人配置和 `.env` 同时被 Git 与打包清单排除；所有持久数据写入 Electron userData。
- 生产依赖均为纯 JavaScript，打包后不依赖开发机目录或额外系统服务。
- 市场概览、分时、日 K、BOLL、缓存降级以及提醒 crossing/hysteresis/cooldown 已有较强领域测试覆盖。

## 7. 测试覆盖的实际边界

91.23% 是修复前审计时领域、服务和 provider 文件的覆盖率，不包含 `electron/main.ts`、`renderer.ts` 和 `settingsRenderer.ts` 的完整真实运行覆盖。最终版本增加了安全边界、原子写入、损坏恢复、来源状态、AI namespace、profile 一致性和提醒 rebase 等测试，总计 135 项；窗口置顶、草稿保护、滚动保持与 macOS 平台行为仍应保留人工 GUI 验收。

## 8. macOS Apple Silicon 适配与实机验证（2026-07-11）

验证环境：Apple M4（arm64）、macOS 26.2、Node 22.23.1、npm 10.9.8、Electron 39.8.10、electron-builder 26.15.3。开发分支为 `codex/macos-port`。

已完成适配：

- “仅托盘驻留”在 macOS 同步调用 `app.dock.hide()` / `app.dock.show()`，并同步 Mission Control 可见性；主窗口、设置窗口、托盘和老板键路径均复用同一 Dock 状态同步函数。
- macOS 置顶层级使用 `floating`，Windows 继续使用既有 `screen-saver`；主窗口继续禁止最大化和全屏，恢复显示前会修复瞬态状态与出屏位置。
- 设置窗口按当前指针所在显示器的 work area 居中；设置窗口隐藏或关闭时恢复主窗口配置的置顶状态。
- 菜单栏托盘优先使用系统 SF Symbol `chart.line.uptrend.xyaxis` 并标记为 Template Image，失败时回退到既有透明图标；Windows 托盘路径保持不变。
- 默认老板键改为 `CommandOrControl+Shift+Space`，避开 macOS 默认占用的 `Command+Option+Space`；macOS 启动时仅迁移该旧默认值，不改写用户自定义组合键。
- 退出流程在提醒状态落盘前显式刷新主窗口 bounds，避免退出前最后一次移动尚在防抖计时器中。
- 未保存凭据时不再让 Keychain 可用性探测阻塞启动热路径；锁屏实测曾复现 ad-hoc 重签后 Keychain 查询等待，调整后同一锁屏会话可正常创建主窗口、渲染进程、SQLite 与缓存。打开设置或实际保存 Key 时仍会探测安全存储，失败时继续拒绝明文。
- 新增按本机 `arm64` / `x64` 架构构建的 `package:mac`，保留 `package:win`；macOS 使用 ad-hoc 签名并输出 `.app` 与 DMG。

自动与真实数据验证：

| 检查 | macOS 结果 |
| --- | --- |
| `npm ci` | 通过 |
| `npm test` | 137 项通过 |
| `npm run build` | 通过 |
| `npm run smoke:data` | 通过；东财/腾讯双源一致，覆盖率 100%，市场概览、241 点分时、120 根日 K 与 BOLL 正常 |
| `npm run smoke:news` | 通过；东财、巨潮、上交所、深交所、证监会均成功，52 份文档聚合为 41 个事件，其中 6 个合并事件 |
| `npm run smoke:profile` | 通过；公开模拟配置 4/4 行情齐全，默认配置持仓仍为空 |
| `npm run smoke:safe-storage` | 通过；`safeStorage` 可用且加解密往返成功，系统通知 API 可用；测试未读取或打印任何真实 Key |
| `npm run package:mac` | 通过；生成 arm64 `.app` 与 DMG，ASAR 必需内容和泄漏扫描通过 |
| 签名与磁盘映像 | `codesign --verify --deep --strict` 通过；DMG CRC 校验、挂载和挂载内 `.app` 签名验证通过；未做 Developer ID 签名或公证 |
| 独立启动 | 从仓库外空目录、隔离 userData 启动；主进程和 3 个子进程稳定，设置、SQLite 和缓存只写入隔离 userData，空工作目录保持为空 |

GUI 验收说明：本轮执行到原生窗口验收时 macOS 会话处于锁屏，自动化无法读取窗口或操作菜单栏/Dock。因此透明度、拖动、置顶切换、老板键、点击穿透恢复、托盘退出、设置窗口视觉完整性、原文打开以及多显示器拖动恢复仍需在解锁后的桌面会话补做最终人工复核。代码和构建层验证不能替代这些原生交互结论。
