# 摸鱼看盘 代码审计报告

> 审计日期：2026-09-25
> 审计基线：`74f1604 docs: publish GitHub project introduction`（`main`，工作区干净，`origin` 已同步）
> 审计范围：金额/提醒正确性、数据层与 provider、渲染层、配置与导入、工程化门禁、依赖与运行时安全、发布一致性；不新增产品功能。
> 方法：控制方独立复核 + 4 路并行深度审计（Electron 安全 / 数据层与 provider / 领域与配置 / 渲染层）。控制方对每一项**标为"已核实"的结论都亲自读代码或运行命令确认**，包括独立复现最高优先级的金额缺陷。

---

## 0. 结论摘要

**工程基础扎实，安全面干净，但存在若干"会安静地给出错误金额"的正确性缺陷。**

- **安全**：独立安全审计 + 控制方复核的共同结论是**没有 Critical / High / Medium 漏洞**。Electron 边界、凭证存储、隐私快照、本地网页服务均设计正确；README 关于凭证与隐私的核心声明**经核实成立**。
- **上一轮修复**：2026-07-11 审计提出的 2 项 P0 与 15 项 P1，逐条核实**均已落实并带回归测试**。
- **但**：本轮发现 **1 项严重 + 7 项高优先级的正确性缺陷**，其中金额类的后果是 UI 显示 `NaN` / `Infinity`、静默漏算、甚至**持仓在下次启动时被静默丢弃**；提醒类则有两条会导致**该响的提醒不响**。对一个"计算并告警真实资金"的工具，这类问题比风格问题重要得多。

### 严重度分布

| 级别 | 数量 | 代表问题 |
| --- | --- | --- |
| **严重** | 1 | `costPrice`/`quantity` 无上限 → `round()` 溢出为 `Infinity` → `NaN` 金额 + 持仓静默丢失（**已执行复现**） |
| **高** | 7 | 阈值恰好相等时漏报穿越；影子模式触发后切正式模式不再提醒；持仓汇总卡静默漏算；回差配置对 8/11 规则无效；腾讯备用源 `amount` 读错字段；BJ 板块代码永远取不到行情；Electron 39 已 EOL |
| **中** | 17 | 交易日历只收录 2026；行情详情缓存的 `details` 无淘汰且每次全量 fsync 重写；`fetchWithTimeout` 定时器泄漏；`fetchDetail`/`fetchOverview` 无单飞；轮询中的 floating promise；32 位 FNV 作 SQLite 主键；AI 内存缓存无上限；UTC 日期用于上海日期窗口；导入静默截断 100 只证券；两份市场推断互相矛盾；等 |
| **低/信息** | 约 25 | 死代码、重复实现、CSS 无 token 层、未清理的隔离文件、托盘状态不老化等 |

### 最高优先级四件事

1. **修金额校验上限**（§2-1）——唯一会**破坏用户数据**的缺陷。
2. **修两条提醒漏报**（§2-2、§2-3）——提醒是该产品的核心承诺。
3. **修渲染层"显示了错的数"与"给了假保证"**（§2-4、§4）——含上一轮误判为"已修复"的滚动问题、以及被证伪的 README 表格声明。
4. **升级 Electron 39**（§7）——唯一随时间恶化的安全项。

---

## 0.1 本轮修复进展（2026-09-25 当日实施）

已修复 **48 项**（Phase A 的 §9 项、Phase B/C/D、Phase E 可静态验证部分；测试 **159 → 190**）；`npm run verify`（typecheck + lint + format:check + test + build）与三个 smoke 全部通过。

| # | 报告条目 | 修改 | 验证方式 |
| --- | --- | --- | --- |
| 1 | §2-1 金额量级溢出（严重） | `config.ts`：新增 `MAX_HOLDING_QUANTITY`/`MIN`/`MAX_HOLDING_COST_PRICE`；`round()` 溢出保护；`positiveOrNull` 归零返回 `null`；`normalizeHoldings` 加界；`assertSavableSettings` 补上界与整数校验。`profile.ts` 的 `positiveNumber` 支持上下界 | 先执行复现（`round(1e308,4)===Infinity`、持久化为 `"costPrice":null`），修复后 4 个新测试断言不再产生 `Infinity`/`null`，且持仓重载后仍在 |
| 2 | §2-2 阈值恰好相等漏报穿越（高） | `alerts.ts`：上一笔比较改为非严格（`<=`/`>=`） | 新增 2 个测试（`10.00 → 10.05` 必须告警；止损方向同理）。原 10 个用例全部仍通过 |
| 3 | §2-3 影子→正式被吞掉（高） | `alerts.ts`：规则记录 `mode`，模式变化时 rebase 并重新 arm（只 rebase、不补发，与既有语义一致） | 新增测试：切换后无需完成整个回差即可对下一次穿越告警 |
| 4 | §2-4 汇总卡静默漏算（高） | `renderer.ts`：汇总卡改用 `risk.portfolio` 的 null-safe 值；成本额不依赖行情，对全部持仓求和 | 类型检查 + 构建；`--` 兜底路径已在既有格式化函数中 |
| 5 | §4-1 滚动保持无效（高） | `renderer.ts`：滚动目标由 `.page-body` 改为真正的滚动容器 `.scroll-list`，并支持合并页的多个列表 | 与 `styles.css:174-186` 逐行核对 |
| 6 | §4-3 单元格全量重写（高） | `excelRenderer.ts`：新增 `lastRenderedCells` 差异表，只重写变化的单元格；`renderSheetTabs` 改为就地更新；编辑栏获得焦点时不被覆盖 | 构建通过；`cellClasses` 仍接收原始值以保持 `typeof` 分支语义 |
| 7 | §4-4 复制定时器写脱离节点 / 点击穿透无回滚 | `renderer.ts`：保存并取消定时器句柄；点击穿透失败时回滚并重渲染 | 类型检查 + 构建 |
| 8 | §3-3 交易日历跨年静默降级（高） | `marketClock.ts`：休市表改为按年份结构，新增 `isTradingCalendarVerified()`/`COVERED_HOLIDAY_YEARS`；`main.ts` 在未收录年份写入可见告警 `calendar:...` | 新增 2 个测试（2027/2028 未收录 = false；未收录年份退化为工作日+时段但仍正确处理周末与时段） |
| 9 | §3-1 腾讯 `amount` 读错字段（高） | `tencent.ts`：改用字段 `[37]`（万元）×10000 | **实测真实接口**：600519 → 3,867,310,000（东财 3,867,310,920）；920099 → 8,939,400（东财 8,939,379.52）。原读 `[45]` 会得到 15463.51（总市值亿元）。测试夹具改为真实布局并固定 `volume`/`amount` |
| 10 | §3-2 北交所代码取不到行情（高） | `config.inferSecurityMarket`、`eastmoney.buildEastmoneySecid`、`tencent.marketPrefixForCode` 统一 `920xxx → BJ`；`profile.inferMarket` 改为委托前者，消除第二份矛盾规则 | **实测真实接口**：`920099` 修复前两个源都返回空，修复后东财与腾讯均返回"瑞华技术 16.68"；`900xxx` 仍正确路由为沪市 B 股 |
| 11 | §6-1 无 lint（高） | 新增 `eslint.config.mjs`：`typescript-eslint` 的 `recommendedTypeChecked` 并收紧 `no-explicit-any` / `no-floating-promises`（`ignoreVoid`）/ `no-unused-vars` / `no-misused-promises` / `eqeqeq`；新增 `lint`/`lint:fix`/`typecheck`/`verify` 脚本 | `npx eslint .` **0 问题**；顺带修掉 38 项真实发现（见下） |
| 12 | §6-2 无 CI（中） | 新增 `.github/workflows/ci.yml`：Node 24 + `npm ci` → `typecheck` → `lint` → `test` → `build`（`permissions: contents: read`、并发取消） | `npm run verify` 本地端到端通过（exit 0） |
| 13 | §3-5 `fetchWithTimeout` 定时器泄漏（中） | `fetch.ts`：非 ok 响应在读取属性时主动排空 body 并释放定时器；定时器 `unref()`；`release()` 幂等 | 新增测试断言非 ok 响应被排空（`bodyUsed === true`）；P1-1 的"超时覆盖 body 读取"回归测试仍通过。判定用严格的 `ok === false`，避免 `await` 读取 `.then` 时把鸭子类型响应误判为非 ok |
| 14 | §3-10 UTC 日期用于上海窗口（中） | 新增 `marketClock.shanghaiDateKey()`；`cninfo`、`exchangeAnnouncements` 的查询窗口改用它；顺带合并 `alerts.ts` 里第三份时区实现 | 新增端到端测试：`2026-07-10T23:30Z`（上海 07-11 07:30）时窗口为 `2026-07-04~2026-07-11`，而 UTC 日期会得到 `07-03~07-10` |
| 15 | §3-9 AI 内存缓存无上限（中） | `batch.ts`：内存缓存改用与磁盘缓存相同的 `{analysis, expiresAt}` + 上限策略（默认 1000，可配）；命中不再刷新 TTL；淘汰按写入顺序。**同时修掉一个潜在 bug**：`persistentEntries` 在无持久缓存时是 `{}`（真值），写路径的 `if (this.persistentEntries)` 因此恒成立，使它变成**第二份无上限内存缓存**——现在要求 `persistentCache` 存在才写入，并在写盘前按 `capacity` 就地裁剪 | 新增测试：上限 2 时最早条目被淘汰并需重新分析；TTL=0 时条目立即过期 |
| 16 | §3-6 `fetchDetail`/`fetchOverview` 无单飞（中） | `marketData.ts`：新增按 key 的 `singleFlight`（`finally` 清除），`fetchDetail` 用 `detail:${key}:${preferred}`、`fetchOverview` 用 `overview:${preferred}` | 新增测试：两次并发 `fetchDetail` 只产生一次分时+日 K 抓取；settle 后条目清除（后续请求不会永久复用） |
| 17 | §3-4 详情缓存无淘汰 + 全量 fsync 重写（中） | `marketData.ts`：新增 `detailsLimit`（默认 30）按最近写入时间淘汰；新增 `cacheDirty` 标记，只有内容变化才落盘；行情缓存改为 `flush: false`（`atomicFile.ts` 新增可选 `flush`，默认仍为 `true`，不影响设置/凭证） | 新增测试：上限 2 时只保留最近两个标的；两个序列都命中缓存时**不再重写**缓存文件 |
| 18 | §3-8 32 位 FNV 作主键/缓存键（中） | 新增 `domain/digest.ts`（`stableDigest` = SHA-256 前 128 位）；`documentFingerprint` 与 `analysisFingerprint` 改用它，删除两份重复的 FNV 实现；`newsEvents.ts` 增加 `PRAGMA user_version` 迁移，换 key 方案时清空这份可重建缓存（保留来源退避状态） | 新增测试断言摘要为 32 位十六进制且不同输入不同键 |
| 19 | §3-7 轮询未处理 rejection（中） | `main.ts`：新增 `triggerRefresh()` / `reportInternalFailure()`，所有后台刷新统一 `.catch()` 并记入 `internal:` 可见告警；三个轮询循环（行情/快指数/市场）与 `setInterval` 新闻轮询全部覆盖；`refreshRisk` 单独 try/catch，提醒子系统失败不再中断行情快照 | `npx eslint .` 的 `no-floating-promises` 仍为 0；`tsc` 双工程通过 |
| 20 | §5-1 导入静默截断 100 只（中） | `profile.ts`：新增 `MAX_SECURITIES`/`MAX_HOLDINGS`/`MAX_WATCHLIST`，证券、持仓、自选超限一律作为 **error** 报出（不再静默截断后让后续引用报出误导性的"必须先在 securities 中定义"） | 新增测试：120 只证券得到"最多 100 只证券，当前 120 只" |
| 21 | §5-3 导入拒绝 `cooldownMinutes: 0`（中） | 风险字段拆成"可为 null"与"不可为 null 且有区间"两组；`cooldownMinutes` 归入后者并允许 0（区间 0–1440，与 config 一致） | 新增测试：`cooldownMinutes: 0` 导入成功且落为 0 |
| 22 | §5-4 导入接受非空字段的显式 `null`（中） | 新增 `numberInRange()`：`stopWarningPercent`(0.1–20)、`hysteresisPercent`(0.01–10)、`cooldownMinutes`(0–1440 整数) 拒绝显式 `null` 与越界值，类型上不再违反 `RiskSettings` | 新增测试：三个字段传 `null` 均被拒；`stopWarningPercent: 500` 被拒 |
| 23 | §5-5 merge 模式无法调整自选顺序（中） | 新增 `mergeWatchlist()`：包内代码按包里的顺序排前、其余保持原相对顺序排后；此前用通用 `mergeBy`（Map 插入顺序）会丢弃已存在代码的 `order`，把"只调整顺序"的包判成 `hasChanges=false` 并报"没有差异" | 新增测试：合并 `[600519, 000001]` 得到该顺序且 `hasChanges=true` |
| 24 | §5-6 `assertSavableSettings` 断言不健全（中） | 去掉 `asserts value is UserSettings`（**已确认无调用方依赖该收窄**，双工程 `tsc` 通过），改为诚实的 `void` 并注明校验范围；新增 `asStrictNumber()`，断言路径一律拒绝 `"100"`/`true`/`[100]` 这类被 `asNumber` 强转的值 | 新增测试：字符串/布尔/数组数量、字符串 `accountBaseline`、字符串 `timeoutSeconds` 均被拒 |
| 25 | §5-7 托盘"注意"永不消退（中） | `trayStatus.ts`：`buildTrayPresentation(snapshot, now = new Date())`，提醒只有 30 分钟内才让托盘保持"注意"（与渲染层同一窗口；此前只看事件条数，而 `recentEvents` 只按 50 条封顶、不按时间老化） | 新增测试：10 分钟后为 `attention`，40 分钟后回 `neutral`，暂停时为 `neutral` |
| 26 | §5-9 无 `schemaVersion` 上界守卫（中） | `AppConfig` 新增 `sourceSchemaVersion`；`SettingsStore` 识别"配置由更新版本写入"，读取时不覆盖原文件、给出可见告警，并在**降级写入前**把原文件完整备份到 `<settings>.v<source>.json`（避免静默丢失新字段） | 新增测试：v99 文件读完仍是 v99、告警可见、写入后 `.v99.json` 保留了 `futureOnlyField` |
| 27 | §5-10 空自选被静默回退为全部证券（中） | `normalizeWatchlist()`：只有字段**缺失或类型不可用**时才回退为"全部证券"；显式 `[]` 视为空（"清空自选"不再被无声填满，也不再影响托盘计数） | 新增测试：`watchlist: []` → 0 条；缺字段 → 迁移为全部证券 |

### Phase A：§9 Low/Info 中有价值项（见 §9 表）

| # | 条目 | 修改 | 验证方式 |
| --- | --- | --- | --- |
| 28 | S-1 提醒规则表只增不减 | `alerts.ts`：新增 `absentSince` 与 `RULE_RETENTION_MS`（7 天，必须大于冷却上限与 oncePerDay 窗口），缺席超期即删除；短暂缺席仍保留冷却/当日一次状态 | 新增测试：短暂缺席后重新出现不重复提醒且条目保留；缺席超过保留期后条目被清理 |
| 29 | S-7 `listEvents` 先 LIMIT 后过滤 | `newsEvents.ts`：有 `relatedCodes` 时改为分页扫描（`EVENT_SCAN_PAGE`/`EVENT_SCAN_MAX_ROWS`），按"已匹配条数"收敛，直到取满 limit 或翻到表尾 | 新增测试：`limit=1` 时仍能取到排在 5 条无关公告之后的相关公告（旧实现在这里会漏掉） |
| 30 | S-16 `ingest` 顺带返回事件列表被丢弃 | `ingest()` 改为返回 `void`（唯一调用方本就丢弃返回值，等于每次刷新白跑一次 JOIN+SELECT）；测试与 `scripts/smoke-news-events.mjs` 改用 `listEvents()` | 全量测试 + smoke:news（**该脚本一开始漏改，被 smoke 抓到**） |
| 31 | S-8 新闻库 `close()` 从未调用 | `newsEvents.ts` 的 `close()` 先 `PRAGMA wal_checkpoint(TRUNCATE)` 再关闭；`main.ts` 退出流程调用它 | 退出路径为 try/catch 包裹，失败不影响关闭 |
| 32 | S-11 腾讯请求头误带东财 Referer | `market.ts`：新增 `tencentHeaders()`（仅 User-Agent），分时/日 K/指数三处腾讯域名改用；东财端点保持 `marketHeaders()` | 逐行核对 6 个 URL 与所用请求头的对应关系 |
| 33 | S-5 localWeb 客户端错误返回 500 | `localWeb.ts`：新增 `HttpError`，请求体超限返回 **413**、JSON 非法返回 **400**；SSE 响应补 `error` 监听与写入保护（此前向已断开客户端写入会抛未捕获异常） | 新增测试：`not-json` → 400、超大 body → 413 |
| 34 | S-6 `visibleClients` 无回收 | `localWeb.ts`：心跳里按"是否还有打开的 SSE 流"回收可见客户端（被强杀的标签页不会发 FIN）；客户端每次（重）连都重申一次可见性以消除竞态 | 类型检查 + 构建；未采用"按时间戳回收"，因为活动标签页只在 visibilitychange 时才上报，会被误判 |
| 35 | S-15 `fetchQuotesWithFallback` 每次新建 coordinator | 保持行为不变（它只用于 smoke 与测试），补文档明确说明**不保留**熔断/恢复探测/`lastTrusted`，应用内应复用长期 coordinator | JSDoc |
| 36 | S-18 `tabs` 与 `tabs[].securityCodes` 无上限 | `config.ts`：新增 `MAX_TABS=30`、`MAX_TAB_SECURITY_CODES=200`，规范化时截断（含 `activeSecurityCodes` 的请求规模），`assertSavableSettings` 对原始长度报错 | 新增测试：35 个自定义页 + 205 个代码 → 截断到上限；assert 分别报"页面最多"/"自定义代码最多" |
| 37 | S-17 `asCustomTabType` 永不返回 `watchlist` | 支持 `watchlist`（渲染层对 `watchlist` 与 `stock-list` 是两种不同页面），不再静默降级 | 新增测试：自定义页声明 `type: "watchlist"` 后保持原类型 |
| 38 | S-19 隔离文件累积 / 旧备份无法恢复 | `store.ts`：新增 `pruneQuarantineFiles()` 只保留最近 3 个 `<settings>.corrupt-*`；`restoreImportBackup()` 改走规范化而非 `save()`，使含旧版（现已禁止）老板键的备份能被自动修复而不是抛错 | 现有 9 个 store 测试全部通过 |
| 39 | S-22/S-23/S-25 死配置、死资源、死代码 | 删除 `tsconfig.json` 的 `jsx: react-jsx`（无 React）；打包清单排除从未在运行时读取的 `resources/icons/app.png`（606 KB）；删除死代码 `quotePollDelayMs`、`dedupeNewsItems`+`normalizeTitle`、`activeWatchlistCodes` 及其测试 | `tsc` + `eslint` 双工程 0 问题；测试 189 全绿 |
| 40 | §9 末尾"重复实现（已漂移）"清单 | 新增 `providers/parseUtils.ts`，把 `asRecord`/`asText`/`asNumber`/`asInteger`/`isoFromUnixSeconds`/`marketFromEastmoneyFlag` 从 market/eastmoney/tencent 三份副本收敛为一处；顺带统一了两套互相矛盾的 `f13` 映射（0 既可能是深市也可能是北交所），并给指数解析补了"按代码回退查找" | 全量测试 + smoke（东财/腾讯指数解析均通过） |
| 41 | S-10 `fetchOfficial` 无总预算 | `newsData.ts`：新增 `OFFICIAL_FETCH_BUDGET_MS=30_000`，超预算后不再发起新标的请求，并把跳过的数量作为可见错误报出（此前最坏约 130s 突发，期间新闻刷新一直返回同一个 in-flight promise） | 4 个 newsData 测试通过 |
| 42 | S-12 分时成交量口径不统一 | **实测确认**：东财 `trends2` 的 `parts[5]` 是每分钟量（全天求和 = 31239 = 当日总量），腾讯 `minute/query` 的 `parts[2]` 本身已是累计（183→31245）。两者解析后口径一致，所以代码是对的——但此前没有任何文档说明，容易被"优化"掉。已在 `IntradayPoint` 与两个解析函数处写明"必须是当日累计值" | 真实接口实测（见上文数值） |

**Phase A 验证**：`tsc` 双工程、`eslint .`（0 问题）、**189 个测试**、`npm run build`、三个 smoke 全部通过。

**lint 顺带修掉的真实问题**（不是为过规则而改）：
- `electron/main.ts:1809` `app.whenReady().then(async …)` 的 Promise 无人处理 → 加 `void` 显式标记。
- `electron/main.ts` 的 `handleTrusted` 参数由 `any[]` 改为 `unknown[]`，并把 4 个声明了具体类型的 handler（`navigation:setActiveTab`、`appearance:setBackgroundOpacity`、`link:open`、`window:toggleClickThrough`）改为接收 `unknown` 后在内部收窄——契约与注释一致（渲染器传入的都是不可信输入）。
- `src/renderer.ts` 两个 `addEventListener("click"/"change", async …)` → 改为具名 async 函数 + `void` 调用，消除 `no-misused-promises` 与悬挂 rejection。
- `electron/main.ts` 未使用的 `loadAppConfigFromObject` 导入、`src/services/marketData.ts` 未使用的 `emptyMarketOverview` 导入、`fetch.ts` 未使用的 `receiver` 参数、`marketData.ts` 无效赋值 → 删除。
- 收敛 `any` 扩散：`JSON.parse` 结果显式标注 `unknown`（`main.ts`/`store.ts`/`localWeb.ts`/`workRenderer.ts`）、`Reflect.get`/`bind` 结果收敛（`fetch.ts`）、`readStringArray` 断言元素为 `string`（`openaiCompatible.ts`）、`Array.isArray` 后显式 `unknown[]`（`profile.ts`）。
- `asString`/`asText` 只接受原始类型，避免对象被 `String()` 成 `"[object Object]"`（`eastmoney.ts`、`market.ts`）。
- `credentials.ts` 重抛时补 `{ cause }`，不再丢解密错误（即报告 §9 S-13）。
- `newsData.ts` 的 `"empty response"` 保留为独立判定，加了一行带理由的 `eslint-disable-next-line`（挂 `cause` 会把无关错误伪装成因果链）。

### Phase B / C / D

| # | 阶段 | 内容 | 验证方式 |
| --- | --- | --- | --- |
| 43 | **Phase B：§3-2 残余** | 没有改 `QuoteProvider` 签名（成本高、会动到测试最密的行情管线），而是消除了**矛盾源头**：`config.asSecurityMarket()` 现在在显式 market 与代码推断冲突时以**代码推断**为准。因为行情路由本来就是按代码前缀推导的，这样"存档的 market"始终等于"路由实际使用的 market"；导入路径本来就会拒绝这种包（"市场与代码不匹配"），两条路径现在一致 | 新增测试：`{code:"920099", market:"SH"}` 归一化为 `BJ`，`600519/SH`、`000001/SZ` 保持不变 |
| 44 | **Phase C：§6-3 覆盖率可复现** | 引入 `c8` + `.c8rc.json`（阈值 行/语句 89、函数 88、分支 70）+ `npm run test:coverage`；CI 的测试步骤改为覆盖率门槛；`coverage/` 加入 `.gitignore` | 实测**行 91.34% / 分支 73.65% / 函数 91.20%**（与上一轮审计声称的 91.23/72.77/87.70 基本吻合，说明当时的数字是可信的，只是没有工具可复现）。用 `--lines 99` 反证门槛确实会让 CI 失败 |
| 45 | **Phase D：prettier** | 引入 Prettier 3 + `.prettierrc.json`（`printWidth: 100`、`trailingComma: "none"`、`endOfLine: "auto"`，均按现有风格设定以缩小 diff）+ `.prettierignore`（排除 `docs/`、`README.md`、`*.css`、构建产物）；新增 `format`/`format:check`；`verify` 与 CI 各加一步 | 全量格式化后 `tsc` 双工程、`eslint .`、190 个测试、`npm run build`、三个 smoke 全部通过。`*.css` 有意留到 §4-10 的 token 层一起处理，避免同一文件重排两次 |

**Phase B/C/D 验证**：`npm run verify`（typecheck + lint + format:check + test + build）exit 0，三个 smoke exit 0，**190 个测试**。

### Phase E：渲染层（GUI 相关，本轮完成可静态验证的部分）

| # | 条目 | 修改 | 验证方式 |
| --- | --- | --- | --- |
| 46 | §4-7 同名不同语义的 `escapeHtml`（5 份副本） | 新增 `src/presentation/format.ts`，统一为转义 5 个字符（`& < > " '`）的 `escapeHtml` 与等价的 `escapeAttr`；`renderer.ts`/`settingsRenderer.ts` 删掉本地 4 字符版本（它们此前**不转义** `'`，与另外 3 个渲染器语义不同），`quickRenderer.ts`/`excelRenderer.ts`/`workRenderer.ts` 删除本地副本。同时把它加入 `scripts/build-renderer.mjs` 的编译清单 | `npm run build` 的 import 闭包校验通过；确认 `dist/assets/presentation/format.js` 已产出且 5 个渲染器产物都改为 import 它（这一步若漏加编译清单，构建校验会直接报"Renderer module missing"） |
| 47 | §9 S-21 逐行盈亏用原始价格 | `renderer.ts` 的 `renderHoldingRow` 改用 `risk.totalPnl`/`risk.totalPnlPercent`（风险模型用 `finitePositive` 清洗过价格，数据不安全时整体为 `null` → 显示 `--`），与风险面板、汇总卡口径一致 | `tsc` + `eslint` + 构建通过；此前与风险面板一致仅依赖上游不变量 |
| 48 | §4-10 死 CSS（约 39 行） | 删除经 grep 确认**在全部 TS 中零引用**的规则：`styles.css` 的 `.news-title`/`.news-summary`（含 stealth 覆盖）与 `.driver-inference`（含 stealth 覆盖），`settings.css` 的 `.code-input`、`.split-panel`（含媒体查询内） | 删除前逐个类名复查引用数为 0；删除后 `verify` 与三个 smoke 全部通过 |

**Phase E 进行中**：`settingsRenderer.ts` 的拆分已完成 §4-5 三步中的**声明式字段表**（#49）与**视图构造函数**（#50），控制器（AI/个人配置/老板键三块 DOM 事件逻辑）尚未外移；`settings.css` 的 127 处硬编码色值收敛为 CSS token 层（§4-10 下半）未做。剩下的都是纯前端结构调整，**必须在实机确认设置页与各外观无回归**后才能算完成。

#### 续：§4-5 第一步（声明式字段表）已完成

| # | 条目 | 修改 | 验证方式 |
| --- | --- | --- | --- |
| 49 | §4-5 把 190 行派发函数换成声明式字段表 | 新增 `src/settings/fields.ts`（320 行）：`SETTINGS_FIELD_UPDATERS` 顶层字段表 + `WATCH_ROW_FIELDS`/`HOLDING_ROW_FIELDS`/`RISK_GROUP_ROW_FIELDS`/`TAB_ROW_FIELDS` 行内表 + `nullableInputNumber`/`nullableInputInteger`/`HOLDING_ALERT_NUMBER_FIELDS`。**模块只写 settings，不碰 DOM、不碰模块级状态**：重渲染、错误提示、重置老板键录制、更新透明度标签都通过返回值交给渲染层。`settingsRenderer.ts` 的 `handleFormChange` 缩成约 110 行的"取 `data-setting` → 定位行 → 应用副作用"薄壳 | `src/settings/__tests__/fields.test.ts`（182 行、**13 个用例**）覆盖原本零测试的逻辑：数值边界（`Math.max(0.1,…)`/`5–120`/`1–30`/冷却取整）、`default-tab` 不做 trim、行情字段上限 5 且**只提示不写入**、`tab-security` 按 tabId 增删且未知 tab 不崩、三个字段只在 `change` 时重渲染、关闭老板键才重置录制、服务商默认值回填、未知字段不写入 |
| 50 | §4-5 第二步：视图构造函数全部外移 | 扩写 `src/settings/views.ts`（362 行）为纯构造函数集合：`nullableNumber`/`option`/`displayNameForCode`（别名→名称→代码的唯一实现，此前渲染层有 9 处副本）/`settingsPageClass`/`renderSettingsNavigation`/`holdingRuleSummary`/`holdingAlertInput`/`formatRuleAmount`/`holdingRuleDescriptions`/`renderWatchItem`/`renderRiskGroupSetting`/`renderAddHolding`/`renderTabSetting`/`renderHoldingSetting`/`renderProfilePreview`/`renderProfilePanel`。**一律显式传参**，不再像原先那样读模块级 `settings` 全局（那几个函数因此根本无法单测）；转义统一走 `presentation/format.ts`。`settingsRenderer.ts` **1580 → 1131 行** | `src/settings/__tests__/views.test.ts` 从 7 个用例扩到 **14 个**（新增：导航只高亮当前分类且 `aria-selected` 唯一、别名→名称→代码回退、内置页 `readonly`+「内置」标记且无删除按钮 vs 自定义页有 `delete-tab`、中间行方向键不禁用、规则「未配置 / 已启用 · N 条 / 已暂停 · N 条」与"清空规则"按钮禁用态、`holdingRuleSummary` 计数、导入预览的 `valid/invalid` 与错误/提醒分级、导入面板按钮禁用矩阵与 JSON 转义）。`views.ts` 语句/行覆盖 **100%**；`rendererBuild.test.ts` 增加契约断言：`build-renderer.mjs` 的编译清单必须包含 `settings/views.ts`、`settings/fields.ts`、`presentation/format.ts`（漏加会让 `npm run build` 的 import 闭包校验失败） |

**这一步的额外收获**：分支覆盖率 73.65% → 74.08% → **74.82%**，总测试 190 → 203 → **217**。`handleFormChange` 原本是设置界面唯一承载全部逻辑的函数且完全没被测试；现在它的逻辑被完整覆盖，剩下的薄壳只做 DOM 定位。同理，视图构造函数外移前也没有任何测试（它们读模块级全局），现在 `views.ts` 的语句/行覆盖到 **100%**（整体行覆盖率回到 **91.6%**）。这也让后续"抽取控制器"（§4-5 第三步）风险明显降低——字段逻辑与渲染逻辑都已经不在那个 1100 行文件里了。

**行为变更提示（需人工确认）**：`assertSavableSettings` 现在会**拒绝**超出量级或非整数的持仓数量/成本。设置界面本身已把输入钳制在合法范围（`Math.max(1, Math.round(...))`、`Math.max(0.0001, ...)`），因此正常操作不受影响；手工编辑 `settings.json` 或导入异常配置包会得到明确报错，而不是静默改写数据。

**README 声明现状**：§4-3 的"只更新对应单元格 / 切换工作表不被打断 / 编辑不被打断"在修复后**已基本成立**，但**趋势分析页**（`renderTrendPanel` → `trendPanel.innerHTML`）仍是每次推送整体重建，不在本次范围内。

**尚未处理**（按报告路线图，需要更大改动或人工验证）：

- **Phase E 剩余（GUI 相关）**：`settingsRenderer.ts` 拆分只剩 §4-5 第三步的**控制器**（AI 设置、个人配置导入、老板键录制三块 DOM 事件逻辑，连同 `handleClick` 的约 177 行与 `render()` 外壳）；`settings.css` 的 CSS token 层（§4-10 的色值收敛部分）。已完成的共享转义层与纯视图层为前者铺好了路（`presentation/format.ts`、`src/settings/views.ts` 已就位）。
- **Phase F（GUI 相关，最后）**：§7-1 Electron 39 升级到受支持版本。代码改动可做，但**透明窗口/置顶/托盘/老板键/`safeStorage`/`node:sqlite` 需要实机回归**，无法在无 GUI 环境自动验证。
- **其余未做（有意）**：
  - §9 **S-24**：`docs/marketing/**` 约 2 MB PNG 在 Git 历史里；README 直接引用这些图，改动收益低，保持原样。
  - §6-3 覆盖率的**每目录阈值**：c8 只支持全局与逐文件阈值；全局下限已能拦住回归。
  - §6-4 约 5,500 行测试盲区（`main.ts` 与 5 个渲染器）：渲染器将在 Phase E 抽层后再补，`main.ts` 需先抽纯逻辑。
  - §5-9 **没有**建完整迁移注册表（历史那三个零散 `if (sourceSchemaVersion < N)` 保持原样）。
- **数据迁移提示**：§3-8 换摘要算法后，`news_documents` 的主键全部改变——已用 `user_version` 迁移清空这份可重建缓存，因此**首次启动会重新抓取新闻**（AI 分析缓存键也变了，会重新分析一次）。

---

## 1. 审计基线（可复现证据）

环境：Node v24.14.0 / npm 11.9.0 / Windows。源码 **13,039 行**，测试 **3,199 行**。

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 依赖安装 | `npm install` | 成功，330 个包 |
| 单元/服务测试 | `npm test` | **159 项通过 / 44 套件 / 0 失败**，约 11.2s |
| 构建 | `npm run build` | 通过（`tsc` ×2 + 渲染器构建 + 构建校验） |
| 配置 smoke | `node scripts/smoke-profile.mjs` | 通过（离线） |
| 真实数据 smoke | `node scripts/smoke-data.mjs` | 通过（东财行情 + 新闻真实接口） |
| 生产依赖漏洞 | `npm audit --omit=dev --registry=https://registry.npmjs.org` | **0 vulnerabilities** |
| 完整依赖树漏洞 | `npm audit --registry=https://registry.npmjs.org` | 8 条（7 high / 1 moderate），全在 electron 安装链，**不进产物** |

最大文件：`electron/main.ts` 1845、`src/settingsRenderer.ts` 1496、`src/renderer.ts` 1224、`src/config.ts` 891、`src/settings/profile.ts` 607、`src/excelRenderer.ts` 561。

> **复现提示**：本机 npm registry 指向 `registry.npmmirror.com`，该镜像**不实现 audit 端点**（`[NOT_IMPLEMENTED]`）。漏洞审计必须显式加 `--registry=https://registry.npmjs.org`。建议写入开发文档。

---

## 2. 金额与提醒的正确性（最高优先级）

### 2-1 【严重·已执行复现】`costPrice`/`quantity` 无上限，`round()` 溢出为 `Infinity`，持仓会被静默丢弃

- 位置：`src/config.ts:965-968`（`round`）、`:616-617`（`normalizeHoldings`）、`:504-505`（`assertSavableSettings` 只校验 `> 0`）、`:937-939`（`positiveOrNull`）、`src/settings/profile.ts:585-593`（`positiveNumber` 只校验有限且 `>0`）。
- 代码：
  - `config.ts:616-617`：`quantity: Math.round(quantity), costPrice: round(costPrice, 4),`
  - `config.ts:965-968`：`const scale = 10 ** digits; return Math.round(value * scale) / scale;`
  - `config.ts:505`：`if (costPrice == null || costPrice <= 0) throw ...` ← **只有下界，没有上界**
- **控制方独立复现（node 执行 `round` 与 `positiveOrNull` 的真实逻辑）**：

  | 输入 | 结果 |
  | --- | --- |
  | `round(1e308, 4)` | `Infinity` |
  | `round(1e-9, 4)` | `0` |
  | `positiveOrNull(1e-5, 1e11)` | `0`（尽管入口已校验 `> 0`） |
  | `(11 − Infinity) / Infinity * 100` | `NaN` |
  | `JSON.stringify({costPrice: round(1e308,4)})` | `{"costPrice":null}` → **下次加载时该持仓被静默丢弃** |
  | `50000 / 0 * 100`（`accountBaseline` 被四舍五入为 0） | `Infinity` |

- 影响链：
  - `costPrice: 1e308` → `costPrice = Infinity` → `totalPnl = -Infinity`、`totalPnlPercent = NaN`；**持久化为 `"costPrice": null`，下次启动 `normalizeHoldings` 静默丢弃该持仓**（用户看到持仓凭空消失，无任何提示）。
  - `costPrice: 1e-9` → `round` 归零 → `totalPnlPercent = Infinity` → 持久化 `costPrice: 0` → 同样被丢弃。
  - `risk.accountBaseline: 1e-5` → `positiveOrNull` 归零 → `exposurePercent = Infinity` → UI 违规文案直接显示 `"Infinity% > 50.000%"`；且 `risk.ts:427` 的 `Number.isFinite` 守卫会**丢弃该提醒候选** → 界面显示越线但**永不告警**。
  - 渲染沉底：`risk.ts:512` `value.toFixed(...)` → `"NaN"`/`"Infinity"`；`risk.ts:505-508` `Intl.NumberFormat.format(-Infinity)` → `"-∞"`；`renderer.ts:1161` → `"-InfinityR"`；`renderer.ts:1157` → `"NaN%"`/`"Infinity%"`。
- **可达路径**：README 明确宣传的"由 Coze 或其他智能体生成 JSON 配置包"导入路径。子审计**已执行** `previewProfileImport`，对 `costPrice: 1e308` 返回 `valid: true, issues: []`，随后 `profile:apply`（`main.ts:1485-1489`）即持久化。手工编辑 `settings.json` 亦可。
- 修复（三层都要加界，并让 `round` 溢出安全）：
  1. `normalizeHoldings`：`quantity: clampInteger(quantity, 1, 1_000_000_000)`、`costPrice: round(clamp(costPrice, 0.0001, 10_000_000), 4)`；
  2. `round`：`const scaled = value * scale; if (!Number.isFinite(scaled)) return value;`
  3. `positiveOrNull`：`round(...)` 结果为 `0` 时返回 `null`（否则函数名撒谎）；
  4. `assertSavableSettings`：补上 `quantity <= 1e9`、`costPrice <= 1e7`、`Number.isInteger(quantity)`；
  5. `profile.ts` 的 `positiveNumber`：补同样的上下界。
- 说明：**普通用户在设置页手工输入不会触发**（`settingsRenderer.ts` 未审计，能否产生该量级未知），但导入路径已确认可达。归为最高优先级是因为它会**静默破坏已保存的持仓数据**。

### 2-2 【高·已执行复现】阈值恰好相等时漏报穿越

- 位置：`src/services/alerts.ts:143-145`。
  ```ts
  const crossed = candidate.direction === "above"
    ? rule.lastValue < candidate.threshold && candidate.value >= candidate.threshold
    : rule.lastValue > candidate.threshold && candidate.value <= candidate.threshold;
  ```
- 问题：当上一笔恰好**等于**阈值（`lastValue === threshold`）时，严格 `<` 为假 → 不触发；而 `lastValue` 随后仍等于 `threshold`，于是**之后无论涨到多少都不会触发**，必须先把价格退回并重新穿越。A 股最小变动价位是 0.01，而用户习惯设置 10.00 / 50.00 这类整数阈值 → 命中概率不低。
- 复现（子审计对真实 `AlertEngine` 执行）：`priceAbove = 10.00`；tick1 值 `10.00` → 0 事件；tick2 值 `10.05` → **0 事件**（期望 1）。止损场景同理。
- 修复：把上一笔的比较改为非严格——`rule.lastValue <= candidate.threshold` / `rule.lastValue >= candidate.threshold`。子审计已手工核对该文件现有 9 个测试用例，改后**全部仍然通过**。

### 2-3 【高·已执行复现】影子模式下触发过一次后，切到正式模式不再提醒

- 位置：`src/services/alerts.ts:151-158`（触发时无条件 `rule.armed = false`，不区分模式）；`:92-95`/`:116-124` 只在候选消失或阈值变化时 rebase；`main.ts:1826` 引擎只构造一次，`:932-942` 每轮传入模式，**没有任何地方在模式切换时重置状态**。
- 复现（子审计执行）：影子模式、止损 9；值 9.5 → 0 事件；值 8.8 → 1 条影子事件（`armed=false`）。改为 `active` 后，价格仍是 8.8 → **0 事件**；8.7 → 0 事件；`state.rules[...].armed === false`。
- 影响：用户目睹影子告警后决定"开启真实提醒"，此刻**正处在跌破止损的状态**——恰恰是最需要提醒的时刻，却完全静默，必须等价格回抽到 `阈值 + 回差` 以上并重新跌破才会响。
- 修复：在 `rule` 上记录 `mode`，每轮比较 `rule.mode !== context.mode` 时 rebase（更新 lastValue、置 `armed` 到安全侧、`continue`）；或切到 active 时对"当前已越线"的规则补发一次。

### 2-4 【高·已核实】持仓汇总卡静默漏算无报价持仓，给出偏小的市值

- 位置：`src/renderer.ts:325-331`（**控制方亲自核实**）：
  ```ts
  const totals = next.settings.holdings.reduce((acc, holding) => {
    const price = quoteMap.get(holding.securityCode)?.price;
    if (price == null) return acc;          // ← 静默跳过，无任何提示
    acc.marketValue += price * holding.quantity;
    acc.costValue += holding.costPrice * holding.quantity;
    return acc;
  }, { marketValue: 0, costValue: 0 });
  ```
- 对比：`src/domain/risk.ts:449-453` 的 `sumComplete` 在**任一**持仓缺数据时返回 `null` → 风险面板正确显示 `"--"`。两处口径不一致：风险面板说"数据不安全"，汇总卡却给出一个**看起来很确定的错数**。
- 复现：持仓 A 100 股 @成本 10 现有报价 11；持仓 B 1000 股 @成本 100 无报价 → 卡片显示 `持仓市值 1,100 / 累计盈亏 +100 / +10.00%`，而真实规模约 10.1 万。托盘此时还提示"数据待核验"，与卡片的自信数字自相矛盾。
- 修复：改用已做空值保护的 `next.risk.portfolio.marketValue/totalPnl/totalPnlR`；或在任一持仓缺价时渲染 `"--"`/停牌提示。

### 2-5 【高】用户配置的回差 `hysteresisPercent` 对 11 类持仓规则中的 8 类无效

- 位置：`src/domain/risk.ts:350-351`（价格类规则正确使用）、`:399-403`（百分比类用硬编码 `*0.05`）、`:488-490`（金额类 `moneyHysteresis` 用 `max(1, threshold*0.05, oneR*0.02)`，**`risk.hysteresisPercent` 从未出现**）。
- 复现：设回差 2%，规则"今日盈利 ≥ 100 元"，`oneR = 1000` → 实际 `max(1, 5, 20) = 20 元`；把回差改成 10% 仍是 20 元。用户以为自己在调回差，实际没有生效。
- 修复：`moneyHysteresis` 改用 `Math.max(1, threshold * risk.hysteresisPercent / 100, oneR * risk.hysteresisPercent / 100)`；百分比类同理。或者明确把该字段改名为"仅价格规则生效"并在 UI 说明。

---

## 3. 数据层与 provider

### 3-1 【高】腾讯备用源的 `amount` 读错字段 → 成交额显示为市值量级 —— 已修复（见 §0.1 #9）

- 位置：`src/providers/tencent.ts:21` `amount: asNumber(parts[45])`，而 `src/providers/market.ts:186` 用 `composite[2]`（第 35 字段第 3 段）。
- 依据：解析器使用的其他下标（30=时间、31=涨跌、32=涨跌%、33=最高、34=最低、36=成交量(手)）都符合 gtimg 标准布局，其中 **37=成交额(万元)、45=总市值**。测试夹具 `src/providers/__tests__/tencent.test.ts:13` 中 37 位为 `987654`、45 位为 `987654321`（后者等于东财夹具的 `f6` 值）→ 两个"amount"来源中必有一个不是成交额。
- 影响：东财失败切到腾讯后，`renderer.ts:1140-1141` 按"元/成交额"渲染该列，Excel 导出（`excelWorkbook.ts:34,49`）同样写入；`quoteFingerprint`（`domain/status.ts:56`）也包含该字段 → 卡死检测依赖一个更新节奏不同的字段。
- 测试缺口：`tencent.test.ts:15-28` 的 `deepEqual` **故意排除了 `volume`/`amount`**，所以夹具恰好掩盖了不一致。
- 修复：`amount: (asNumber(parts[37]) ?? 0) * 10_000`（万元→元），并在测试中把 `volume`/`amount` 一并固定。置信度中高（无网络确认实际字段映射，但内部自相矛盾本身即为缺陷）。

### 3-2 【高】行情路径丢弃已配置的 `market` → 北交所 920xxx 永远取不到行情 —— 主要场景已修复（见 §0.1 #10；显式 market 仍未贯穿 provider 签名）

- 位置：`src/services/quotes.ts:18` `QuoteProvider = (codes: string[]) => Promise<Quote[]>`（不传 market）→ `src/providers/eastmoney.ts:23-29` 与 `src/providers/tencent.ts:42-46` 都**只按代码前缀推断**（`^9` → SH）。而 `src/config.ts:427-431`/`:896-899` 允许显式 `market: "BJ"`，北交所 920xxx 代码确实存在；`src/domain/market.ts:22-30` 的 `eastmoneySecid`/`tencentSymbol` **本来就是 market 感知且正确的**——行情路径没走它。
- 影响：配置为 BJ/`920099` 的证券被请求为 `1.920099` / `sh920099` → 两边都返回空 → 永久 `missingCodes`、`quotes:empty response`、**永远拿不到行情且没有诊断信息**。反向风险：显式配置 SH 而代码是 `0xxxxx` 时，会静默返回平安银行的价格，而 `validateQuote`（`quoteQuality.ts:29`）只比对 `code` → 错误标的被当作 `fresh` 接受。
- 修复：把 `QuoteProvider` 改为接收 `{code, market}[]`（或 code→market 映射）并改用 `eastmoneySecid`/`tencentSymbol`；同时拒绝与请求 market 不符的返回。

### 3-3 【高】交易日历只收录 2026 年，2027 起静默降级 —— 已修复（见 §0.1 #8）

- 位置：`src/domain/marketClock.ts:16-26`（`OFFICIAL_HOLIDAYS` 全为 2026 日期）、`:32-35` 判定链。
- 触发：**2027-01-01 起**，任何工作日休市日被判为 `"trading"`。
- 影响链（已逐处核对）：`main.ts:809, 874, 922, 940, 1000, 1360, 1439, 1858` 用 `isAShareTradingSession(now)` 构造 `tradingSession`；`alerts.ts:99` 用它门控"仅交易时段提醒" → **休市日会基于停牌旧价评估穿越并告警**；`refreshPolicy.ts:19-28` 让轮询全天按 3 秒跑；`validateQuote` 拿到 `marketOpen:true`，把上一交易日的行情判为 `source_stale` → `alertSafe=false`、`isQuoteFeedStalled` 为真 → **风险/提醒评估被整体抑制、UI 显示"行情卡死"**。
- 交叉验证：本次 `smoke:data` 返回行情 `updatedAt = 2026-09-24`，而审计日 2026-09-25 恰在 2026 休市表内 → 机制在 2026 年内工作正常，问题纯属年份覆盖。测试同源盲区：`marketClock.test.ts:20-23` 只断言 2026 日期。
- 修复：未收录年份回退为"仅工作日判断"并**显式告警**"交易日历已过期"，同时让"仅交易时段提醒"在该状态下默认不通过；补 2027/2028 测试；长期改为启动时拉取交易所日历。

### 3-4 【中】行情详情的 `details` 缓存永不淘汰，且每次全量 fsync 重写 —— 已修复（见 §0.1 #17）

- 位置：`src/services/marketData.ts:61-65/:113`（无淘汰）、`:326-330`/`:371-375`（每次写单个标的）、`:433-442`（每次 `structuredClone` 整个缓存）、`:244`（每次取详情都 `await` 落盘）、`:107-109` + `atomicFile.ts:19`（`flush: true`）。
- 影响：浏览 N 个标的就永久保留 N ×（约 120 根日 K + 约 240 个分时点）在内存与磁盘上；`market-cache.json` 涨到 MB 级，并在交易时段**每 15 秒全量重写 + fsync**，I/O 随 N 线性增长。
- 修复：对 `details` 加 LRU 上限（如 30 条）或按 TTL 淘汰；仅在 overview 或本次触碰的详情真正变化时落盘。

### 3-5 【中】`fetchWithTimeout` 在"不读 body"的路径上泄漏定时器（即所有 `!response.ok` 分支） —— 已修复（见 §0.1 #13）

- 位置：`src/providers/fetch.ts:15-18` 起定时器；`cleanup()` 只在 catch（`:50-53`）或被代理的 body 方法 `finally`（`:39-47`）中执行。而各 provider 在 `!response.ok` 时**先抛错、不碰 body**（`eastmoney.ts:73`、`market.ts:38/52/72/88/99/117/133`、`cninfo.ts:79`、`exchangeAnnouncements.ts:100/128`、`csrc.ts:41`、`eastmoneyNews.ts:66`）。
- 影响：每次 4xx/5xx 都留下一个未 `unref` 的定时器（最长 2.5–10 秒），且错误响应体从不被读取（socket 被占用、上游错误文本丢失）。应用内影响小，但**会让 `node --test` 进程被挂住**；且没有任何测试覆盖非 ok 路径（`fetch.test.ts` 只覆盖 hang/stalled body/ok）。**控制方独立发现此条，与子审计结论一致。**
- 修复：headers 到达即清理定时器（当调用方不会读 body 时），并把错误响应体读入抛出的错误信息。

### 3-6 【中】`fetchDetail`/`fetchOverview` 没有在途去重 → README 的"不会成倍请求上游"只对网页路径成立 —— 已修复（见 §0.1 #16）

- 位置：`marketData.ts:233-251` / `:127-219` 只查 TTL 缓存，无 promise 记忆；去重实现只存在于网页路径（`localWeb.ts:176-183` 的 `trendInFlight`）。
- 影响：主窗 + 表格窗，或 `/api/trend` + IPC `market:detail`（`main.ts:1435-1443`）在同一 25 秒窗口内请求同一标的 → 双双未命中 → intraday + daily 双份请求（共 4 次 provider 调用）；渲染器快速切换标的也没有节流。README:87/:113 的声明对 SSE 与 `/api/trend` 路径**已核实成立**（`main.ts:1888-1891` 的刷新是单飞的，`/api/public-snapshot` 只读缓存），但对窗口/IPC 路径不成立。
- 修复：按 `instrument.key + kind` 做 promise 记忆，`finally` 清除（照抄 `localWeb.getTrend`）。

### 3-7 【中】轮询循环中的 floating promise → 未处理的 rejection，且原因丢失 —— 已修复（见 §0.1 #19）

- 位置：`main.ts:745, 762, 1894, 1895, 1896`（另 `:783-784, :371-372, :1657-1659, :1870-1871`；`localWeb.ts:46`）。
- 真实抛错路径：`refreshQuotes` 在 `try` **之外** `await refreshRisk`（`main.ts:842`）→ 进而 `deliverAlertEvents`（`Notification.show()`、`tray.setToolTip`，`:965-978`）；`refreshNews` 在 `try` 之外调用 `pushSnapshot()`（`main.ts:1060`）→ `updateTrayMenu()`/`webContents.send`。`.finally()` 会把 rejection 重新抛进已被丢弃的派生 promise → 主进程 `unhandledRejection`，且原始原因被吞掉。
- 修复：改为 `void p.catch(reportError).finally(...)`，并把尾部的 `await refreshRisk(...)`/`pushSnapshot()` 移进 `try`。

### 3-8 【中】用 32 位 FNV 作 SQLite 主键与 AI 缓存键 → 碰撞导致静默丢数据 —— 已修复（见 §0.1 #18）

- 位置：`src/domain/events.ts:78-85`（`stableHash`）→ `:13-21` → `src/services/newsEvents.ts:256`（`news_documents.id` 主键，`:257-271` 用 `ON CONFLICT(id) DO UPDATE`）；`src/ai/batch.ts:127-143` → `:78-79`。
- 影响：按 30 天保留期与东财快讯约 30 条/分钟估算，累计约 1.5 万份文档时，32 位哈希至少发生一次碰撞的概率约 **2–3% / 月**。碰撞会把两条无关文档**静默合并成一行**（标题/URL 取第一条，第二条永不入库、永不计数）→ 永久且无提示的数据丢失。AI 缓存碰撞则会**把另一个事件的结论当成这条新闻的分析**展示。
- 修复：改用 ≥128 位摘要（如 `createHash("sha256").update(input).digest("hex").slice(0,32)`）或直接用来源 URL/外部 id 作键，并在插入时做碰撞校验。

### 3-9 【中】`CachedNewsAnalyzer` 的内存 Map 既无上限也无 TTL（磁盘缓存两者都有） —— 已修复（见 §0.1 #15）

- 位置：`src/ai/batch.ts:59`（`memory` Map）`:99` 写入，只在 `clearMemory()`（`:117-119`）清空，而后者只被 `clearAiApiKey`（`main.ts:1275`）调用；持久缓存则有 `maxEntries=1000` 与过期策略（`:22, :32-38, :48`）。且 namespace 被编进 key，切换模型/端点会留下旧条目。
- 影响：常驻运行会累积数千条分析（数十 MB），无淘汰。
- 修复：把持久缓存的 LRU/过期策略套用到 `memory`，或在 `aiAnalysisNamespace()` 变化时清空。

### 3-10 【中】用 UTC 日期构造「上海日期」查询窗口 → 08:00 前差一天 —— 已修复（见 §0.1 #14）

- 位置：`src/providers/cninfo.ts:91-93` 的 `value.toISOString().slice(0,10)` 用于 `seDate`（`:62`）；`src/providers/exchangeAnnouncements.ts:147-149` 同款助手用于 SSE 的 beginDate/endDate（`:92-93`）与 SZSE 的 seDate（`:121`）。
- 影响：上海时间 07:00 时 UTC 日期还是前一天，7 天窗口整体前移，**上海时间午夜之后发布的公告被排除**；随后空结果被判定为"empty response"（`:94/:104`）→ 该来源被错误退避为失败。
- 修复：用 `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" })` 格式化（`alerts.ts:228-237` 已有现成实现）。

---

## 4. 渲染层

5 个渲染器共 **3,787 行 / 169 KB**、181 个顶层函数（6 个 >50 行，3 个 >100 行且**全在 `settingsRenderer.ts`**）、**43 个模块级可变绑定**、约 **453 行重复或可推导代码**（占渲染器总行数约 12%）。**没有任何测试 import 过这 5 个模块。**

### 4-1 【高·已核实】「滚动保持」是无效代码 —— 上一轮 P1-12 实际未修复

- `src/renderer.ts:207-209` 读取、`:249-252` 恢复 `rootElement.querySelector(".page-body").scrollTop`；但 `src/styles.css:174-178` 中 `.page-body { flex: 1; overflow: hidden; }` —— **该元素根本不滚动**（控制方逐行核实）。真正的滚动容器是 `.scroll-list`（`styles.css:180-186`，`overflow-y: auto`），而它被 `renderer.ts:221` 的 `rootElement.innerHTML = ...` 整体替换。
- 后果：持仓/自选/新闻列表**仍每约 3 秒跳回顶部**（`refreshPolicy.ts:10 FOREGROUND_QUOTE_INTERVAL_MS = 3_000`），而那段代码提供了虚假的安全感。上一轮审计将其记为"已修复"，属误判。
- 修复（一行级）：把滚动目标改为 `.scroll-list`。

### 4-2 【高·已核实】主悬浮窗每次刷新全量重建 DOM

- `renderer.ts:221` 重建整个部件，频率为每次快照推送。`main.ts:861-866` 虽有"指纹相同且 15 秒内"去重（控制方已核实），但实盘价格每 tick 都变 → 实际每 3 秒（前台）/ 5 秒重建一次，每次约上千节点。
- 后果：焦点丢失、文本选区销毁、IME 组合中断、`<details>` 展开态丢失、CSS 过渡重启；典型现象是 `renderer.ts:290-293` 的标签溢出 `<select>` 下拉打开时被重建，用户切换被打断。
- **不是**监听器泄漏：事件采用委托注册，全文件仅 3 处 `addEventListener`（`:952/:1023/:1039`），模块初始化时注册一次 → 重建不累积监听器。这点实现正确。
- 修复：header/footer/标签栏只渲染一次，仅重建 `.page-body` 并用 `pageKey` 守卫跳过无变化的重建。

### 4-3 【高·已核实】README 的表格工作台声明被证伪

`README.md:81`：*"行情变化只更新对应单元格，切换工作表和当前选区不会被刷新打断。"*

| 声明 | 结论 | 证据（控制方核实） |
| --- | --- | --- |
| 只更新对应单元格 | **假** | `excelRenderer.ts:280-291` 无条件遍历重写**全部 18 列 × 60 行 = 1,080 个** `td[data-cell]` 的 `textContent` 与 `className`，无变更检测；实际仅约 100 格有值，>90% 是空写，并触发 1,080 次 `cellClasses` 正则（`:300`） |
| 当前选区不被打断 | **网格为真，编辑为假** | 优点：`<td>` 不重建，`.selected` 与 `format-*` 在 `:285-289` 重新应用 → 选区保住。**但** `:292-293` 每 tick 重写 `formulaInput.textContent`（控制方核实无 `activeElement` 守卫），用户在内容可编辑编辑栏（`:342`）输入时下一次轮询会**静默还原**；`commitCustomCell` 只在 blur 提交（`:211`）→ 输入丢失 |
| 切换工作表不被打断 | **假** | `:264` 每 tick 调 `renderSheetTabs()` → `:328` `sheetTabs.innerHTML = ...`（控制方核实），标签按钮销毁重建，焦点与 `:hover`/`:active` 在点击中途丢失（活动索引本身保留正确，这点是好的） |
| 趋势分析页 | **假** | `:275-277` → `:460` `trendPanel.innerHTML` 每 tick 重建整个 SVG **及** `<select id="trend-security">`（`:463`）→ 是重新生成而非更新 |

- 修复：加 `lastCells: Map<address,string>` 跳过未变单元格；`sheetTabs`/`trendPanel` 只渲染一次并改用 `textContent`/`classList`/`selectedIndex` 打补丁；`document.activeElement === formulaInput` 时不得写入。

### 4-4 【高】`window.api` 的类型是编译期幻觉，字段重命名会静默失败

- `electron/preload.cts` 全部 30 个方法都用 `as` 断言（`:14 invoke("snapshot:get") as Promise<AppSnapshot>`、`:62 as ReturnType<FloatingStockApi["applyProfile"]>`）。`invoke` 返回 `Promise<any>`，`as` 不做校验，渲染器也不重新收窄（`renderer.ts:1037 getSnapshot().then(render)`）。
- **具体静默失败**：主进程若重命名字段，`renderFeedStatus`（`renderer.ts:1084-1092`）读到的 `degraded/stalled/conflictCount/...` 全为 `undefined` → 所有比较为 `false` → **底部状态栏显示"一切正常"，没有任何错误**。`renderQuoteQuality`（`:1113`）读 `quality.reasons.length` 会抛错；`renderNews`（`:744-767`）读 `analysis.relatedCodes.length` 也会抛错。`tsc` 只看到声明的类型，**边界处不可能产生编译错误**。
- 相关：`global.d.ts:56` 把 `floatingStock` 声明为可选 + 各渲染器用 `?.` → 桥接失败时部件永久停留在 `emptySnapshot`（`renderer.ts:1042`），不报错不重试；`workRenderer.ts:196/281/208` 对两个网络载荷零校验（`as PublicSnapshot`/`as PublicTrend`），形状不符时 `renderSnapshot` 抛错，却被 `:199` 的 catch 报成误导性的"访问已失效 / 请从应用托盘重新打开"。
- 修复：边界校验一次——`parseSnapshot(unknown)` 用于 `preload.cts` 的 `getSnapshot`/`onSnapshot`，`normalizePublicSnapshot(unknown)` 放进 `presentation/publicSnapshot.ts`（与已有 `normalizeExcelCustomSheet` 对称，后者正是可照抄的范式）；启动时断言桥接存在并渲染可见错误态。

### 4-5 【高】`settingsRenderer.ts` 单文件承担六种职责

三个巨型函数占该文件 **636 行 = 42.5%**：`render`（`:74-361`，288 行）、`handleClick`（`:829-1005`，177 行，30 分支/18 动作）、`handleFormChange`（`:657-827`，171 行，40 分支 `if (setting === "...")`，靠读 DOM 行索引定位状态并就地改 `settings`）。DOM、状态、校验、序列化、事件接线全在其中。
- 修复（三步，各自可独立发布）：① 抽纯视图构造到 `src/settings/views/*.ts`（零行为变更，约减 350 行）；② 抽 `src/settings/controllers/{ai,profile,bossKey}.ts`，以 `{get, patch, send}` 注入；③ 抽声明式字段表 `src/settings/fields.ts`，把 171 行 dispatcher 变查表（约 40 行）。**先做③**，它会暴露真实状态形状。
  - **进度：③ 与 ① 已完成**（`fields.ts` 340 行、`views.ts` 362 行、共 27 个新用例；`settingsRenderer.ts` 1580 → **1131 行**，见 §0.1 #49/#50）。② 待做：`handleClick`（177 行/18 动作）、`render()` 外壳与三块控制器逻辑。

### 4-6 【中】`settingsRenderer.ts` 整页重渲染的连带 bug

`:81` 的整页重建被约 10 个入口调用（每个 `showMessage` `:1424`、各 busy 开关、7 个 `change` 即重渲染的控件 `:671/:752/:766/:794/:839`）。后果：刚操作的控件焦点/光标丢失；`:520` 的 `<details class="holding-rule-details">` 折叠 → 点击"清空规则"`:957`、"加入持仓"`:1170`、"添加风险组"`:988` 会让用户正在操作的面板收起。作者已意识到焦点问题但只对**一个**控件打了补丁（`focusBossKeyRecorder` `:1379-1381`）。
> 校准：这**不是**每 tick 发生——`pushSettings` 只在保存流程触发（`main.ts:1655`），`onSettings` 被 `settingsDirty` 正确守卫（`:1489`，这点写得好）。

### 4-7 【中】重复实现：15 类辅助函数，且两个同名 `escapeHtml` 语义不同

| 函数 | 份数 | 位置 |
| --- | --- | --- |
| `escapeHtml` | **5** | `renderer.ts:1214`、`settingsRenderer.ts:1463`、`quickRenderer.ts:85`、`excelRenderer.ts:557`、`workRenderer.ts:412` |
| HH:mm 时间 | **6** | `renderer.ts:1204`、`renderer.ts:1192`、`quickRenderer.ts:79`、`workRenderer.ts:407`、`excelWorkbook.ts:131`、`excelRenderer.ts:306` |
| 数字格式化 | **6** | `renderer.ts:1146`、`renderer.ts:692`、`quickRenderer.ts:67`、`workRenderer.ts:404`、`excelWorkbook.ts:116`、`excelRenderer.ts:493` |
| 涨跌方向 | 5 | `renderer.ts:1125`、`renderer.ts:1130`、`quickRenderer.ts:63`、`workRenderer.ts:406`、`excelRenderer.ts:300` |
| 金额压缩 | 3，**3 种结果** | `renderer.ts:1179`（`toFixed(1)亿`）、`renderer.ts:696`（`万亿`/`toFixed(0)亿`）、`excelWorkbook.ts:124`（`toFixed(2)亿`） |

**两个 `escapeHtml` 语义不同却同名**（控制方已核实）：`renderer.ts:1214` / `settingsRenderer.ts:1463` 只转义 `& < > "`（另有 `escapeAttr` 补 `'`），而 `quickRenderer.ts:85` / `excelRenderer.ts:557` / `workRenderer.ts:412` 转义 `& < > " '`。在渲染器间复制粘贴标记会**静默改变属性转义行为**。

**已有的共享层被绕过**：`src/config.ts` 已导出 `securityForCode()`(`:411`)、`displayNameForCode()`(`:418`)、`inferSecurityMarket()`(`:427`)、`activeSecurityCodes()`(`:394`)、`QUOTE_FIELDS`(`:14`)、`TAB_TYPES`(`:19`)，但 `renderer.ts:940`/`settingsRenderer.ts:1404` 各自重写 `securityFor`，`settingsRenderer.ts:1408` 与 `inferSecurityMarket` 逐字节相同；`alias || name || quote.name || code` 链出现 **9 次**。另有两处用户可见不一致：`QuoteField` 标签表两份（`renderer.ts:177-188` "现价/涨跌/涨幅" vs `settingsRenderer.ts:19-30` "当前价/涨跌额/涨跌幅"）；同一价格精度不同（`renderer.ts:1147` 对 ≤100 的价用 3 位小数，`quickRenderer.ts:68`/`workRenderer.ts:404` 用 2 位）→ 12.345 在悬浮窗显示 "12.345"、在速览显示 "12.35"。
- 修复：新建 `src/presentation/format.ts` + `src/renderer/dom.ts`，5 个渲染器统一迁移（约减 450 行），同时消除上述不一致。

### 4-8 【中】43 个模块级可变绑定，同一事实多份拷贝

`settingsRenderer.ts:55` `let settings: UserSettings | null = null`，其后 13 个同级可变全局，**7 处 `settings!` 非空断言**（`:166/:469/:494/:517/:600/:601/:634`）→ 任一渲染路径在 `settings` 加载前执行即运行时 `TypeError`，而该文件**无任何测试**。其他具体簇：`excelRenderer` 的自定义单元格需同时写 4 处（`commitCustomCell` `:370-385` 的 `:375/:379/:381/:382`）；`message`(`:56`) + `messageKind`(`:57`) 在 5 处成对手工设置（漏一个就渲染无样式的 `class="message "`）；`pendingAiApiKey`(`:60`) 是输入框的影子副本；`renderer.ts` 的"当前标签页"存在 **4 处**；点击穿透状态存在 **3 处**且 `:1003-1004` 乐观切换**无回滚**，IPC 失败时按钮 `aria-pressed`(`:231`) 与实际不符。
另有一处 UI 说谎：`handleFormChange` 的 `profile-text` 分支（`:663-667`）改写文本后**不重渲染**（每键触发，有意为之）→ "预览差异"成功后改动一个字符，旧预览面板仍在屏幕上、"确认导入"仍为启用态（`:426`），只在点击时才被 `:1065` 的复查拦住。
- 修复：`settings` 参数化 + 单一 state 对象；`profile-text` 分支做定点更新而非整页 `render()`。

### 4-9 【中】复制反馈定时器写给已脱离文档的节点

`renderer.ts:1008-1015`：设置 `textContent = "已复制"`，随后 `window.setTimeout(..., 1_500)` **未保存句柄**。下一次 `render()`（`:221`）替换该节点 → 回调写到脱离文档的元素，用户**看不到**提示。修复：按按钮保存句柄并在重渲染时取消。

### 4-10 【中】CSS 无 token 层、含约 24 行死规则

硬编码 hex：`settings.css` **127**、`workweb.css` 117、`excel.css` 103、`styles.css` 46、`quick.css` 18；`var(--…)` 使用数：`styles.css` 2、`workweb.css` 23、其余三个 **0**。`settings.css` 有 13 个近似灰色承担 4 种用途；5 个页面用了 3 套字体栈。
**已核实无引用的死规则**：`styles.css:214` `.news-title`、`:864-867` `.news-title`、`:869-872` `.news-summary`、`:912` stealth `.news-summary`、`:1172-1178` `.driver-inference` + `:1180-1182` stealth 覆盖（新闻卡片已改用 `.driver-card`/`.driver-heading`/`.driver-meta`）、`settings.css:153-156` `.code-input`、`:235-239`/`:363` `.split-panel`。
语义色漂移：涨/跌在 `styles.css` 为 `#ff6b6b`/`#4ecdc4`，`quick.css:43-44` 为 `#ad3b38`/`#287a52`，`workRenderer.ts:406` 又用 `positive`/`negative` 词汇，`excelRenderer` 用 Excel 绿 `#107c41`。且 `data-theme="stealth"` 只存在于 `styles.css`（`renderer.ts:945` 设置 `dataset.theme`），`quickRenderer` 从不设置 → **低调灰阶只影响悬浮窗**。
- 修复：新增 `src/styles/tokens.css`（约 14 个 token）`@import` 进各页面（`build-renderer.mjs` 原样复制 CSS，故为纯增量）；删死规则；加 `stylelint`。

---

## 5. 配置、导入与版本演进

### 5-1 【中】导入静默截断超过 100 只证券，且后续报错误导 —— 已修复（见 §0.1 #20）

`src/settings/profile.ts:270` `value.slice(0, 100)` 未推任何 issue；`assertSavableSettings` 的"证券资料最多100只"只看截断后的列表。复现：含 120 只证券的包 → `valid: true, issues: []`，实际 `securities.length === 100`（20 只静默丢弃）；若某持仓引用被丢弃的代码 → 报 `"必须先在 securities 中定义"`（`profile.ts:316`），而用户确实定义了。修复：`value.length > 100` 时推 error。

### 5-2 【中】两份市场推断实现互相矛盾，合法 B 股代码被拒 —— 已修复（见 §0.1 #10）

`config.ts:427-431` `inferSecurityMarket`：`^[48]`→BJ、`^[569]`→SH、其余→SZ（与两个 provider 一致）。`profile.ts:570-574` `inferMarket`：`6|5`→SH、`0|3`→SZ、其余→BJ。复现（子审计执行）：`{"securities":[{"code":"900001","market":"SH"}]}` → `valid:false`，报"市场与代码不匹配，应为 BJ"；`200001` + `"SZ"` 同样被拒。修复：删除 `profile.ts:570-574`，改用 `config.ts` 的 `inferSecurityMarket`。

### 5-3 【中】导入拒绝 `cooldownMinutes: 0`，而 config 明确允许 0 —— 已修复（见 §0.1 #21）

`profile.ts:80` 把 `cooldownMinutes` 列入 `RISK_NUMBER_FIELDS`，由 `nullablePositive`（`:595-602`）校验，对 `<= 0` 报错；但 `config.ts:678` `clampInteger(..., 0, 1_440)` 与 `:487-489`（只拦 `< 0`）允许 0。复现：`{"profileVersion":1,"risk":{"cooldownMinutes":0}}` → `valid:false`，"必须是正数或 null"，**整个包被拒**。修复：该字段改用 `nonNegativeNumber`。

### 5-4 【中】导入接受非空字段的显式 `null`，产生违反自身类型的 `UserSettings` —— 已修复（见 §0.1 #22）

`profile.ts:445-449`（`nullablePositive` 把显式 `null`→`null`）作用于 `stopWarningPercent`/`hysteresisPercent`/`cooldownMinutes`，而它们在 `config.ts:86-88` 声明为 `number`；`assertSavableSettings`（`config.ts:483`）跳过 `null`（`value != null && ...`）。复现（子审计执行）：`{"risk":{"stopWarningPercent":null}}` → `valid: true`，`nextSettings.risk.stopWarningPercent === null`。内存态下 `stopDistancePercent <= null`（→0）会**禁用临近止损预警**；保存后重载又静默变回 `2`（`config.ts:676`）。修复：区分"必填正数"（拒绝 null）与"真正可空"。

### 5-5 【中】merge 模式无法调整自选顺序，并报出误导性的"没有差异" —— 已修复（见 §0.1 #23）

`profile.ts:500-505` + `mergeBy`（`:564-568`）保留既有 Map 插入顺序、只追加新代码，再按数组下标重编号；而 `validateWatchlist` 已把传入行排序编号 → 对已存在代码的 `order` 变更被丢弃。复现：现有 `[600519:0, 000001:1]`，包（merge）`[000001:0, 600519:1]` → 结果不变、`hasChanges: false` → `main.ts:1487` 抛 `"配置包与当前设置没有差异，无需导入"`；同一包在 replace 模式下正常。修复：merge 模式下对双方都存在的代码应用传入顺序，或明确文档化为 replace-only。

### 5-6 【中】`assertSavableSettings` 是不健全的类型断言 —— 已修复（见 §0.1 #24）

`config.ts:946-950` 的 `asNumber` 会把字符串/布尔/数组强转为数字（`const number = typeof value === "number" ? value : Number(value)`），而 `config.ts:433` 声明 `asserts value is UserSettings`。已执行验证：`quantity: true` → `1`，`quantity: [100]` → `100`，`"100"` → `100`；且该断言**接受** `holdings[0].quantity = "100"`（字符串）与 `risk.accountBaseline = [100000]`（数组）。完全未被检查的部分：`navigation`、`quotes`、`news`、`appearance`、`ai.enabled`、`securities[].market/name/alias`、全部 `tabs` 字段、`refreshPolicy`、`schemaVersion`。复现：`tabs:[{visible:true}]` 能通过断言，尽管 `TabConfig.id/type/securityCodes` 是必填。修复：断言路径改用严格的 `asStrictNumber`（拒绝非 `number`），并重命名/补齐该守卫，使 `is UserSettings` 不再是一句空话。

### 5-7 【中】托盘"注意"状态永不消退，而应用内横幅会过期 —— 已修复（见 §0.1 #25）

`src/domain/trayStatus.ts:26` `hasRecentAlert = snapshot.risk.recentEvents.length > 0 && !snapshot.risk.paused` —— **无时间过滤**；`recentEvents` 只被限制为最多 50 条（`services/alerts.ts:166`）且不做老化。对比 `renderer.ts:1047-1048` 要求 `age <= 30*60_000`。复现：周一触发一次告警 → 周五托盘仍为 `attention` 且 tooltip 仍显示该告警。修复：复用 30 分钟规则，抽成共享助手。

### 5-8 【中】数量校验在三个层不一致，非整数被静默四舍五入 —— 已修复（见 §0.1 #1）

`profile.ts:585-593` 要求整数；`config.ts:500-504`（`assertSavableSettings`）不要求；`config.ts:616` 静默 `Math.round`。已执行验证：`loadAppConfigFromObject({quantity:100.7})` → `quantity === 101`；`assertSavableSettings` **接受** `quantity = 100.7`（也接受 `"100"`）。修复：在断言中加 `Number.isInteger(quantity)`。

### 5-9 【中】无"配置由更新版本写入"的守卫，也没有迁移注册表 —— 已修复（见 §0.1 #26，未做迁移注册表）

`config.ts:230` `sourceSchemaVersion = clampInteger(asNumber(raw.schemaVersion) ?? 0, 0, 1_000_000)` —— **不与 `SETTINGS_SCHEMA_VERSION = 8`（`:9`）比较上界**；`:270` 无条件写出 `schemaVersion: 8`。`store.ts:47-52` 只在 `source < 8` 时重写。已执行验证：`loadAppConfigFromObject({schemaVersion: 99})` 返回 `schemaVersion: 8`。复现：用户用新版（v9 字段）后降级回本版 → v9 独有字段被静默忽略，下一次保存即永久丢失，无警告无备份。迁移是三个零散 `if (sourceSchemaVersion < N)`（`config.ts:537, 553, 775`），7/8 无任何迁移。修复：`sourceSchemaVersion > SETTINGS_SCHEMA_VERSION` 时**拒绝持久化**并报错，降级写入前保留 `.v<source>` 备份。

### 5-10 【中】`normalizeWatchlist` 在自选为空/无效时静默回退为"全部证券" —— 已修复（见 §0.1 #27）

`config.ts:694-704`：`const source = rows.length > 0 ? rows : securities.map(...)`。已执行验证：`{securities:[600519,000001], watchlist:[]}` → 凭空生成 2 行自选。用户（或被截断的导入）本意是"没有自选"，却静默获得全部证券进入自选/托盘计数。修复：仅在 `raw.watchlist === undefined`（真正的旧版迁移）时回退，显式 `[]` 视为空。

---

## 6. 工程化门禁

### 6-1 【高】无任何 lint / formatter 配置 —— 已修复（见 §0.1 #11）
仓库根目录不存在 `.eslintrc*`、`eslint.config.*`、`.prettierrc*`、`.editorconfig`、`stylelint`、`biome.json`；`package.json` 无 `lint`/`format` 脚本，devDependencies 仅 `@types/node`、`electron`、`electron-builder`、`tsx`、`typescript`。`tsconfig.json` 开了 `strict` 但未开 `noUnusedLocals`/`noUnusedParameters`/`noUncheckedIndexedAccess`/`noImplicitOverride`/`exactOptionalPropertyTypes`——这也是 §9 死代码与未使用桥接方法未被发现的原因。当前树的类型纪律其实很好（§11-26：`as any` 0、`@ts-ignore` 0、空 `catch {}` 0、`any` 1），正因如此更该用工具把它固定。
- 修复：接 `typescript-eslint` + `prettier`（或 `oxlint`），开 `no-unused-vars`/`no-explicit-any`/`no-floating-promises`，补齐 tsconfig 标志，`npm run lint` 接入构建。
- **实际落地**：已接 `eslint` 10 + `typescript-eslint` 8（类型感知），`eslint .` 0 问题，`npm run lint`/`typecheck`/`verify` 就位。prettier 与 tsconfig 严格标志**有意暂缓**（全量重排/会新增大量报错，宜独立提交）。

### 6-2 【中】无 CI —— 已修复（见 §0.1 #12）
无 `.github/`。159 个测试、类型检查、构建与打包校验全靠手动执行。修复：最小 workflow（无需外网）`npm ci` → `tsc -p tsconfig.json` → `npm test` → `npm run build`；真实接口 smoke 单列为 allow-failure 或定时任务。
- **实际落地**：`.github/workflows/ci.yml` 执行 Node 24 + `npm ci` → `typecheck` → `lint` → `test` → `build`；真实接口 smoke 不进 CI（结果随行情波动），发布前手动跑。

### 6-3 【中】覆盖率数字不可复现
`docs/2026-07-11-final-pre-macos-release-audit.md:25, :134` 引用"行 91.23% / 分支 72.77% / 函数 87.70%"，但仓库无 `c8`/`nyc`、无 `coverage` 脚本。修复：引入 `c8` + `test:coverage`，核心模块设阈值。

### 6-4 【中】约 5,500 行无直接测试
无同名测试的源文件：`electron/main.ts` 1845、`src/settingsRenderer.ts` 1496、`src/renderer.ts` 1224、`src/excelRenderer.ts` 561、`src/workRenderer.ts` 414、`src/providers/exchangeAnnouncements.ts` 143、`cninfo.ts` 98、`shortcut.ts` 95、`csrc.ts` 49。
**没有任何测试 import 过 5 个渲染器模块**；`src/rendererBuild.test.ts` 是源码文本冒烟测试（3 个用例全在 `readFile` + `assert.match`，例如断言构建脚本里出现字面量 `compileTypeScript("src/excelRenderer.ts", "excel.js")`），不 import、不执行，无法发现运行时回归，且对 §8-3 的漏检照样通过。真正被充分测试的是 `src/presentation/*`（含一条"不泄漏持仓成本"的隐私断言）。
**子审计列出的具体测试缺口**：`singleFlight` 的 reject 路径、`fetchWithTimeout` 非 ok 路径、腾讯 `volume`/`amount` 偏移、localWeb 向死客户端广播/心跳、`MarketDataCoordinator` 同键并发去重、`newsEvents` 的 limit-vs-filter 交互。
- 修复优先级：① 3 个 provider（纯解析、最易漂移）；② 把 `main.ts` 纯逻辑抽成可测模块（轮询延迟、配置读写、IPC 参数校验、快照组装）——"抽纯函数再测"，而非引入 Electron 集成测试；③ 渲染层先抽共享格式化函数再测。

---

## 7. 依赖与运行时安全

### 7-1 【高】Electron 39 已停止维护（EOL 2026-05-05）
`package.json:33` `"electron": "^39.2.7"`，实装 **39.8.10**（Chromium M142 / Node v22.20.0）。官方日程显示 **39.0.0 的 EOL 为 2026-05-05**；截至审计日受支持的是 42（EOL 2026-10-20）、43（EOL 2027-01-05）、44（EOL 2027-03-02）。见 [Electron Releases Schedule](https://releases.electronjs.org/schedule)。
- 影响：Electron 随 Chromium 收安全补丁，落入 EOL 后**渲染引擎不再获得 CVE 修复**，当前已脱管约 4.5 个月。本项目渲染进程要处理多个第三方来源与用户自配端点的不可信文本并写入 DOM；CSP 与转义已做得很好，但把"最后一层防线"停在没有补丁的引擎上，对展示持仓与凭证的应用是最高优先级的**维护**风险（不是现存漏洞）。
- 修复：升级到 44.x（至少 43.x）。升级后回归：透明窗口、无边框、点击穿透、置顶、托盘、全局老板键、`safeStorage` 往返、`node:sqlite` 可用性（内置 Node 22.20 → 24.x）。

### 7-2 【中】完整依赖树告警与文档结论不一致
`docs/2026-07-11-final-pre-macos-release-audit.md:27` 声称"生产依赖及完整依赖树均为 0 个已知漏洞"。实测完整树 8 条（`electron`(经 `extract-zip`)、`extract-zip`、`tar`、`undici`、`@xmldom/xmldom`、`fast-uri`、`js-yaml`、`brace-expansion`），`--omit=dev` 复核为 **0**，全部位于 electron 下载/解包工具链、仅影响开发机安装阶段。修复：文档改为可复现命令与范围，完整树检查降级为信息项。

---

## 8. 安全复核结论（无 High/Medium 漏洞）

独立安全审计 + 控制方复核：**没有 Critical / High / Medium 漏洞**；README 关于凭证的核心声明**经核实成立**。残余 5 Low + 3 Info：

| # | 级别 | 位置 | 问题 | 实用性 |
| --- | --- | --- | --- | --- |
| 1 | Low | `main.ts:1865`、`localWeb.ts:27,158-163,166` | 若 `MOYU_WEB_PREVIEW_TOKEN` 被设为**空串**，`??` 不回退 → `token === ""` → `timingSafeEqual` 对两个 0 长度 buffer 返回 **true**，`POST /api/session` 用空 token 即通过，`Cookie: moyu_local=` 也被接受 | 仅开发态（打包态恒为 `randomBytes(24)`），暴露的只是刻意脱敏的 `PublicSnapshot` |
| 2 | Low | `runtimeSecurity.ts:24-29` | `file:` 分支只比较 `pathname`、**不比较 host**（控制方已核实），而它是 `will-navigate` 与全部 IPC sender 校验的**唯一**闸门 | 实际不可利用：Windows 共享名不能含 `:`，Linux/macOS 的 Chromium 不解析远程 `file:` host。属逻辑弱点 |
| 3 | Low | `main.ts:1471-1473` | `link:open` 用 `/^https?:\/\//` 放行**明文 http** 并把原始字符串交给 `shell.openExternal` | 已挡住 `file:`/`javascript:` 等；残留下只是"用未加密链接打开浏览器"。建议 `new URL` 解析、仅允许 `https:` 且无 userinfo |
| 4 | Low | `localWeb.ts:166` | 会话 cookie 用 `===` 比较，而 header 路径用 `timingSafeEqual`（`:158-163`）→ 不一致 | 24 字节随机 token，时序攻击不现实。建议统一走 `matchesToken` |
| 5 | Low | `main.ts:657-676` | 打包态仍从 exe 目录/userData 读 `.env`（仅认 3 个 `AI_*`，且 `AI_API_BASE_URL` 优先于已保存设置，`config.ts:298`）→ 能写入该目录者可把已存密钥指向攻击者 HTTPS 端点 | 不构成提权：同用户攻击者本就能解密 `safeStorage`，且 env 密钥无法覆盖已有安全存储密钥（`main.ts:1230-1239` 优先 `secureKey`）。建议打包态跳过这两个候选 |
| 6 | Info | `verify-packaged-app.mjs:26-38` | 只断言必需文件存在，**未断言** `.env`/`personal.local.json`/`settings.json`/`ai-credential.json` 不存在（而 `docs/2026-07-11…:31` 正是这样声称的） | 加负向断言 |
| 7 | Info | `runtimeSecurity.ts:32-34` | dev 白名单只含 `/`、`/index.html`、`/settings.html`，但 `main.ts:297/347` 从 dev server 加载 `quick.html`/`excel.html` → 这两个窗口的 IPC 抛"拒绝来自非受信页面的请求" | fail-closed，属**功能性** bug（仅 `VITE_DEV_SERVER_URL` 模式；当前 `dev` 脚本不启 dev server，很少触发） |
| 8 | Info | `main.ts:1632`、`:1426` | 加固建议：`settings:save` 在校验前对载荷 `structuredClone` 且无体积上限（profile 有 2 MB 上限）；`app:online` 无防抖即可触发外网请求；未设 `setPermissionRequestHandler`；未检查 `safeStorage.getSelectedStorageBackend()`（Linux 可能为 `basic_text`）；token 经 URL fragment 传给 ShellExecute，同用户进程可从命令行读取 | 影响低（快照刻意非敏感） |

`validOrigin`（`localWeb.ts:154-156`）对**缺失** `Origin` 放行在此组合下是安全的：浏览器跨源 POST 必发 `Origin`，`SameSite=Strict` 阻止跨站 cookie，无 CORS 头，Origin-less 子资源 GET 只能读到跨源不可读的只读 JSON。

---

## 9. 其他小项

| 编号 | 位置 | 问题 | 建议 |
| --- | --- | --- | --- |
| S-1 已修 | `alerts.ts:88-95` | 规则只被置 `evaluable=false`、**从不删除** → `state.rules` 随自选/持仓编辑持续增长并落盘 | 删除 N 天未见的规则 |
| S-2 已修 | `alerts.ts:183-186` | `isPaused(now)` 形参未使用（`void now`），调用方也不传（`main.ts:1829`）→ 签名暗示"按日过期"但实际没有；跨日重启后 `latestRisk.paused` 直到首次 `refreshRisk` 都是陈旧的 | 删参或实现按日判断 |
| S-3 已修 | `main.ts:967` | `deliverAlertEvents` 用 `events.at(-1)` 当"最新"，而同批事件时间戳相同 → 取的是最后一个候选而非最严重的 | 按严重度挑选 |
| S-4 已修 | `risk.ts:100/:148/:396` | 亏损类事件的 `threshold` 被取负，而配置里是正数（`risk.test.ts:123` 断言 `daily_loss → -50`）→ 任何渲染 `event.threshold` 的地方会显示 `-50` | 统一符号或在展示层取绝对值 |
| S-5 已修 | `localWeb.ts:224-231`、`:59-67` | body 超限/JSON 解析失败经外层 `catch` 返回 **500**（应为 413/400）；SSE 写入无 `error` 处理与背压，客户端异常断开时可能抛出未捕获异常 | 区分错误类型；`response.on("error", …)` 并逐条保护广播循环 |
| S-6 已修 | `localWeb.ts:133-143` | `visibleClients` 无存活回收，只在 SSE close 或显式 `visible:false` 时删除 → 被强杀的标签页会让 `quoteSurfaceIsForeground()` 保持为真，轮询停在 3 秒前台频率（15 秒心跳碰巧回收了大多数死连接，故为 Low） | 记录时间戳并回收 5 分钟无活动的 id |
| S-7 已修 | `newsEvents.ts:128-142` | `LIMIT` 在 relatedCodes 过滤**之前**生效 → 实际窗口是"最新 100–160 条"，超出该窗口的高优先级事件永远无法显示（影响 `news.mode="important"`） | 在 SQL 内过滤或分页 |
| S-8 已修 | `newsEvents.ts:251-253` | `close()` **从未被调用**（关闭路径 `main.ts:1900-1929` 无 close）→ 退出时不做 WAL checkpoint，`pruneBefore` 的 checkpoint 最多每天一次 | 在 `before-quit` 关闭 store |
| S-9 已修 | `main.ts:1052` | `catch {` 丢弃 `newsData.ts:73` 抛出的错误信息 | 记录或上报 |
| S-10 已修 | `newsData.ts:53, 122-145` | `fetchOfficial` 每 5 分钟最多 50 个 cninfo POST、4 路并发、**无总预算**（单请求 10 秒超时 → 最坏约 130 秒突发），期间单飞的新闻刷新一直返回同一 in-flight promise | 加聚合预算 |
| S-11 已修 | `market.ts:98, 132` | 把东财的 `Referer`（`:344-351`）发给了 `web.ifzq.gtimg.cn`，而 `:50` 正确只发 UA | 用腾讯专用请求头 |
| S-12 已修 | `market.ts:223-247` vs `:265-271` | 分时成交量语义因来源而异：东财在代码里累加（`cumulativeVolume +=`），腾讯取原始值；`IntradayPoint.volume`（`domain/types.ts:207`）两者都没说明 → 图表成交量含义随 fallback 变化 | 明确语义并统一 |
| S-13 已修 | `credentials.ts:39-42` | 重抛 `new Error(...)` 时未带 `{ cause: error }`，丢失解密错误细节 | 加 `cause` |
| S-14 已修 | `batch.ts:37, :48` | 用 `Object.entries(...).slice(-n)` 裁剪，会把形如数组下标的纯数字哈希键重排 → **新条目可能被优先裁掉** | 改用 LRU 或显式顺序 |
| S-15 已修 | `quotes.ts:470-480` | 每次调用都新建一个临时 `QuoteCoordinator` → 熔断与 `lastTrusted` 状态永不保留（仅 `scripts/smoke-profile.mjs` 使用，但被导出且被测试） | 复用单例 |
| S-16 已修 | `newsEvents.ts:119` | 返回的 `listEvents()` 结果被调用方丢弃（`newsData.ts:62`）→ 每 60 秒一次无用的 JOIN+SELECT（最多 100 行） | 去掉该调用 |
| S-17 已修 | `config.ts:889-894` | `asCustomTabType` 永远返回不了 `"watchlist"`，尽管 `TabType` 含它 → 类型为 `watchlist` 的自定义页静默变成 `stock-list` | 支持或收窄 `TabType` |
| S-18 已修 | `config.ts:786-800, 836-840` | `tabs` 数量与 `tabs[].securityCodes` 无上限（其他集合同事都有：证券≤100、自选≤50、风险组≤20），而 `activeSecurityCodes` 会把它们并入行情请求 | 加 `tabs` ≤30、`securityCodes` ≤200 |
| S-19 已修 | `store.ts:158` | 隔离文件 `${filePath}.corrupt-<ts>` 从不清理 → 反复损坏会持续占盘。另 `restoreImportBackup`（`:105-108`）会重跑 `assertSavableSettings`，旧版本写的备份若含现已禁止的老板键（`shortcut.ts:45-51`）会**抛错而非恢复** | 清理旧隔离文件；恢复路径放宽为迁移 |
| S-20 已修 | `profile.ts:50, :254` | `hasRuleContent` 对任何 `raw.risk` 对象都为 `true`（含仅 `{"risk":{"notifications":…}}`）→ 语义是"包动过 risk"而非"包含规则"，却用它门控强制影子模式提示 | 改名或改判定 |
| S-21 | `renderer.ts:357-358` | 逐行盈亏用**原始** `quote?.price`，而 `risk.ts:188-199` 用 `finitePositive` 清洗 → 今天一致仅因上游不变量（`price === 0` 无法到达渲染器，已核实）；属潜在漂移 | 让渲染器消费 `risk.totalPnl/totalPnlPercent` |
| S-22 已修 | `tsconfig.json:17` | `"jsx": "react-jsx"` 但无 React 依赖 → 死配置 | 删除 |
| S-23 已修 | `resources/icons/app.png` | **606 KB** 仅由 `scripts/generate-icons.py:56` 生成，运行时只读 `app-256.png`/`tray.png`/`tray@2x.png`（`main.ts:124-125`），但打包清单含 `resources/icons/**` → 死重随包发布 | 移出打包清单 |
| S-24 | `docs/marketing/**` | 约 **2.0 MB** PNG 进入 Git 历史，仅用于 README | 压缩或外链 |
| S-25 已修 | 死代码（已 grep 核实仅测试/内部引用）：`marketClock.ts:49-58` `quotePollDelayMs`、`domain/news.ts:24-46` `dedupeNewsItems`、`config.ts:409` `activeWatchlistCodes`、`config.ts:411-425` `securityForCode`/`displayNameForCode` | — | 清理 |

**重复实现（已漂移）**：`formatNumber` 在 `risk.ts:511-513` 用 `>= 100`、在 `renderer.ts:1146-1148` 用 `> 100`；`formatMoney` 三份（`risk.ts:504`、`renderer.ts:1163`、`excelRenderer.ts:494`）；两个标题归一化器（`news.ts:44` 仅空白 vs `events.ts:5` 完整归一化）；两份市场推断（§5-2）；两份 FNV 哈希（`events.ts:78-85` / `batch.ts:137-142`）；两个 secid 构造器（`eastmoney.ts:23-29` vs `market.ts:22-24`）；`f13` 两套矛盾映射（`eastmoney.ts:77-82` → 2=BJ 否则 UNKNOWN vs `market.ts:150` → 非 1/0 一律 "BJ"）；`asRecord/asText/asNumber` 三份（`market.ts:385-403`、`eastmoney.ts:91-99`、`tencent.ts:72-76`，后者逐字复制前者）。

---

## 10. P3 — 发布流程

- **P3-1 版本号漂移 + macOS 无法复现**：`package.json:3` 为 `0.1.0`，`README.md:32-33` 同时列 Windows v0.1.0 与 macOS v0.1.1，且 `package.json` **只有 `package:win`**。修复：统一版本策略，补 `package:mac`/签名公证说明。
- **P3-2 打包新鲜度校验是启发式**：`verify-packaged-app.mjs:15-20` 以"产物 mtime 在 20 分钟内"判断新鲜 → 干净 clone 打包后隔段时间会**误报 stale**，旧产物被触碰过则**漏检**。修复：打包前强制清空 `release/`，或比对哈希/清单。
- **P3-3 构建校验漏掉三个渲染器入口**：`verify-electron-build.mjs:23-26` 只以 `main.js`/`settings.js` 为 import 图入口 → `quick.js`/`excel.js`/`workweb.js` 若引用未生成模块，构建**不会发现**（当前干净，风险在下一次新增 import）。另：`build-renderer.mjs:64-88` 的 `ts.transpileModule` **不做类型检查**，`:70` 的 `strict: true` 是无效选项；真正的类型检查来自先跑的 `tsc -p tsconfig.json`（`include: ["src"]` + `noEmit`，已确认覆盖渲染器）。修复：补齐三个入口；加注释澄清，避免未来有人删掉 `tsc`。

---

## 11. 已验证良好（本轮不需要改动）

**安全与隐私**
1. **凭证安全（README 声明成立）**：`safeStorage` 接线（`main.ts:1805-1812`）；安全存储不可用时**拒绝明文落盘**（`credentials.ts:48-50`）且拒绝读取（`:35-37`）；原子写入 + 串行写队列（`:51-61`）；错误脱敏（`:41`）。密钥不落盘：`settings.json` 写 `toUserSettings(config)`（无 `apiKey`）且 `assertSavableSettings` **拒绝**渲染器提供的 `ai.apiKey`（`config.ts:459-461`，`config.test.ts:105/176` 断言持久化后为空串）；`exportProfile` 无 AI 字段；AI 缓存只存分析（`batch.ts:47-55`，测试断言文件不含 `"apiKey"`）；Coze 交接载荷与 AI 提示词只带公开新闻字段；`safeAiError` 白名单化、从不回显密钥。
2. **公开快照确为白名单投影**：`publicSnapshot.ts:49-92` 只导出 code/name/price/changePercent/质量状态/时间与新闻标题，**不含**数量、成本、账户规模、原始 URL、本机路径。README:89 成立。
3. **导入的 Coze 配置无法越权**：只接受白名单根键（`profile.ts:71-74`，未知字段拒绝 `:220-222`），未知嵌套字段拒绝，导入规则**强制 `risk.mode="shadow"`**（`:438-444, :512-517`）；无法触碰 `ai`/`baseUrl`/`window`/`providers`/`pollIntervals` → 无法重定向密钥或劫持老板键。
4. **无原型污染（已执行验证）**：用真实 `mergeRawConfig` + `structuredClone` 验证——对象展开/`JSON.parse`/`structuredClone` 只会创建**自有** `__proto__` 属性、从不触发 setter，`({}).polluted` 仍为 `undefined`；所有动态键都是数组承载或来自固定列表。唯一残留：`mergeRawConfig` 会保留一个自有 `__proto__` 键，可能干扰 `store.ts:198` 的空判断（改用 `Object.create(null)` 可彻底消除）。

**Electron 边界**
5. **窗口基线一致**：4 个窗口（`main.ts:232-238`、`:287-293`、`:337-343`、`:398-404`）安全字段完全相同：`preload: path.join(__dirname, "preload.cjs")`、`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`；无 `allowRunningInsecureContent`/`webviewTag`/`experimentalFeatures`。preload 路径正确，编译产物只 `require("electron")`（沙箱兼容；`preload.cts` 的 `../src/*.js` 均为 `import type` 已擦除）。
6. **导航与弹窗统一封堵**：`hardenRendererWindow`（`:700-705`）对每个窗口生效，`setWindowOpenHandler` 全 deny，`will-navigate` 限定本地页面或 loopback dev origin；无 `<webview>`，`frame-src 'none'` 另加一层。
7. **IPC 面无高危能力**：恰好 **29 个 `ipcMain.handle`、0 个 `ipcMain.on`**，全部经 `handleTrusted`（`:711-718`）逐次校验 sender URL。**没有任何通道接收文件系统路径**；主进程 `fs` 只用固定 userData 文件名；无 `child_process`、无 `shell.openPath`、无系统文件对话框、无协议注册、忽略 `second-instance` argv、无 `--no-sandbox`。参数校验真实存在：`market:detail` 用 `config.securities` 交叉校验；`navigation:setActiveTab` 在 `config.tabs` 查表；`ai:testConnection` 强制 HTTPS-or-loopback；`ai:setApiKey` 2000 字符上限；`profile:*` 纯文本 + 2 MB 上限。**没有通道返回 API 密钥**。
8. **上一轮 P0-1 确认修复且有回归测试**：`resolveDevServerUrl(true, …)` 打包态恒为 `null`（`runtimeSecurity.ts:5`，断言 `runtimeSecurity.test.ts:11-12`）；生产态 `.env` 只注入 `ALLOWED_ENV_KEYS`（`main.ts:123`：仅 3 个 AI 变量），`VITE_DEV_SERVER_URL` 与 `MOYU_WEB_PREVIEW_*` 全部包在 `!app.isPackaged` 内。
9. **CSP 严格且逐页生成**：`build-renderer.mjs:97` 输出 `script-src 'self'`（无 `unsafe-inline`/`unsafe-eval`）、`connect-src 'none'`（仅 `work.html` 为 `'self'`）；实测 5 个 HTML 均带 CSP。全树 `eval`/`new Function`/`document.write`/`createContextualFragment` **0 命中**；所有远端或用户派生字符串在写入 `innerHTML` 前均转义。
10. **无 SSRF**：所有出站 URL 均为硬编码 HTTPS；AI 目标经 HTTPS-or-loopback 校验；**从不抓取远端提供的 URL**（公告 URL 仅存储展示，经 scheme 校验的 `link:open` 打开）。SQLite 全用占位符绑定；文件写入为临时文件 + rename。
11. **本地网页服务（全项目最扎实的部分）**：显式绑 `127.0.0.1`（`localWeb.ts:51`）；精确 `Host` 校验（`:150-152`）挡 DNS rebinding；token `randomBytes(24)` + `timingSafeEqual`（`:27, :158-163`）；`POST /api/session` 同时要求同源 `Origin` **和** token 后下发 `HttpOnly; SameSite=Strict`（`:94-102`）；**所有**数据端点（含 SSE `/api/events`）都在 `:105` 之后（**不向未认证客户端泄漏**）；静态服务为固定 3 项映射（`:41-45`）→ 无路径穿越；`/api/trend` 要求 `^\d{6}$` **且**在自选可见列表中（`:113`、`main.ts:1849-1852`）；body ≤1 KB；静态响应带 CSP + `nosniff` + `frame-ancestors 'none'` + CORP。

**数据与正确性**
12. **金额计算的公式与单位正确（已执行核对）**：当日盈亏 `(price − previousClose) × quantity`（`risk.ts:193-195`）定义正确，`previousClose` 为空/0（停牌）→ `null` → `"--"`，绝不产生 NaN；累计盈亏与百分比公式正确；`ratio()`（`:455-457`）守卫 `denominator > 0`；`sumComplete()` 在任一持仓缺数据时返回 `null` 而非部分求和，风险面板因此是对的；所有金额全流程为**元**，未发现分/万元混用；`quoteQuality.ts:54-59` 的百分比比较（0.08pp 容差）与 `risk.ts:197-208, 267-268, 350-351` 的 `*100` 一致。
13. **行情路径无法注入 NaN**：`providers/eastmoney.ts:95-99`、`tencent.ts:72-76`、`providers/market.ts` 都拒绝非有限数；`quoteQuality.ts:30-31` 拒绝非正的价格/昨收；`risk.ts:427` 的 `addCandidate` 丢弃 null/非有限值。
14. **提醒引擎核心语义正确**：首 tick 只 arm 不告警、条件持续期间不重复、必须回抽越过回差才重新 arm（`:139-142, :201-205`）、冷却（`:146-148`）、每日一次按**上海日期**且跨日正确翻转（`:79, :149, :228-237`）、暂停按日清除、不安全数据/缺数据/阈值变化/规则移除后**只 rebase 不补发**（`:116-137`）、状态持久化与重启恢复。**仅 §2-2（恰好等于阈值）与 §2-3（影子→正式）两处有误。**
15. **行情质量与降级**：`quotes.ts` 具备按证券粒度校验、熔断（`:136`）、恢复探测（`:144`）、跨源冲突检测与保留（`:167-184`）、`lastTrusted` 保留值、按 code 的状态（fresh/fallback/conflict/stale/retained）、健康度与冲突率评分（`:251-255, :438-439`）。`lastTrusted` 以证券代码为键，非无界增长。
16. **single-flight 正确**：11 行，用 `.finally()` 清理 → **resolve 与 reject 两条路径都会清理**（缺口：测试只覆盖 resolve 路径）。
17. **失败与"没有新闻"被正确区分**（README:112 声明成立）：`if (!items.length) throw new Error("empty response")`（`newsData.ts:93, 104, 162`）+ 持久化的按来源指数退避，封顶 30 分钟（`newsEvents.ts:192`；分析重试 `:159`）。断言见 `newsData.test.ts:83-101`。
18. **HTTP 超时覆盖响应体（上一轮 P1-1 确认修复）**：`fetch.ts:30-49` 用 `Proxy` 包装 `Response`，body 方法在同一 `AbortController` 下执行并在 `finally` 清理（残留见 §3-5）。
19. **新闻真实成功时间与 AI namespace（上一轮 P1-4/P1-5 确认修复）**：`newsData.ts:22, :79` 返回 `attempted`；`newsEvents.ts:144/166/175/323-328` 实现 namespace 隔离（`:175` 不匹配即视为待分析）；测试 `newsEvents.test.ts:90-104` 断言跨 namespace 不复用。
20. **新闻库保留策略已落地（上一轮 P2-1 确认修复）**：`newsEvents.ts:226-244` 的 `pruneBefore` 删除旧事件与孤立文档并 `PRAGMA wal_checkpoint(PASSIVE)`，由 `newsData.ts:65` 以 **30 天**窗口调用。
21. **持久化原子性与回滚正确**：`atomicFile.ts:9-33` 是写临时文件 + `rename` 并带 `preserveExisting` 恢复副本；导入前建备份（`main.ts:1488`）；`SettingsStore` 维护 `.last-good.json`、隔离损坏文件、可恢复或回退默认（`store.ts:151-173`）。字节层面畸形文件不会破坏好的文件。SQLite 开启 WAL/foreign_keys/busy_timeout（`newsEvents.ts:47`），prune 有事务（`:226-249`），损坏 DB 会被隔离重建（`:364-378`）。
22. **多标签不放大上游请求（README:87）对网页路径成立**：`/api/trend` 用同步设置的 in-flight map + 5 分钟缓存（`localWeb.ts:173-184`），快照/SSE 端点只读缓存，可见性触发的刷新是单飞的（`main.ts:1888-1891, 1866-1873`），客户端每个趋势最多请求一次（`workRenderer.ts:251-262`）。缺口见 §3-6。
23. **有界状态**：健康采样封顶（`quotes.ts:348-349`）、`recentEvents` ≤50（`alerts.ts:166`）、`latestErrors` ≤4（`main.ts:1779`）、cninfo 并发 ≤4（`newsData.ts:183-195`）、列表上限 500（`newsEvents.ts:128`）。
24. **定时器管理正确**：行情/快指数/市场用自重置 `setTimeout` + start-to-start 延迟 + 抖动（`main.ts:728-778`、`refreshPolicy.ts:30-39`），慢 tick 不会重叠；四个定时器都在 `before-quit` 清理（`main.ts:1909-1913`）。停市时段轮询是**降速**（60 秒）而非停止，新闻 24/7 轮询。
25. **时区处理基本正确**：`marketClock.ts:3-12, 29-42` 用 `Intl` Asia/Shanghai + `hourCycle: "h23"`，边界 09:30/11:30/13:00/15:00 正确；所有 provider 时间戳都带显式 `+08:00` 解析（`market.ts:366-382`、`tencent.ts:60-68`、`eastmoneyNews.ts:75-79`、`exchangeAnnouncements.ts:139-145`、`csrc.ts:45-50`）。**唯一例外是 §3-10。**
26. **类型纪律好**：全树 `@ts-ignore`/`@ts-expect-error` **0 处**、`as any` **0 处**、空 `catch {}` **0 处**、`any` **1 处**（`main.ts:709`）。两个 tsconfig 均 `strict: true` 且类型检查通过。
27. **渲染器无定时器与监听器泄漏**：5 个渲染器**零 `setInterval`**（全树唯一在 `localWeb.ts:59` 的主进程心跳）；24 个监听器全在模块作用域注册一次并委托处理，被重建的子元素不重复绑定。`renderer.ts:661-667/669-678` 正确清理行情详情定时器。
28. **表格网格保留选区与手动格式**：`excelRenderer.ts:280-291` 不重建 `<td>`，且重新应用 `.selected`（`:288`）与 `format-*`（`:286/:289`）——正确范式，只需扩展到标签栏/趋势面板/编辑栏并收窄到变化单元格。`activeSheetIndex` 从不被 `applySnapshot` 重置，`withUtilitySheets`（`:353-359`）保证顺序稳定。
29. **异步竞态处理到位**：`renderer.ts:199/635/645/653` 与 `excelRenderer.ts:63/436/444` 有请求代数守卫；关闭时取消（`renderer.ts:670`）；`trendCache` 避免重复取数（`excelRenderer.ts:430-435`）。
30. **本地存储内容被规范化而非盲信**：`workRenderer.ts:357-375` 的 `loadContent` 与 `excelCustomSheet.ts:20-32` 的 `normalizeExcelCustomSheet` 会截断长度、拒绝非字符串、校验地址与协议（`safeUrl` `:400-403`）。
31. **展示层是真实且被测试的**：`buildExcelWorkbook`/`buildPublicSnapshot`/`buildExcelBollChart`/`normalizeExcelCustomSheet` 均为纯 ViewModel 构造，由 4 个测试文件覆盖，含显式的"不泄漏持仓成本"断言（`excelWorkbook.test.ts:39`）。渲染器绕过的只是它的**格式化那一半**。
32. **构建完整性校验强于同规模项目**：`verify-electron-build.mjs:28-58` 做真正的传递 import 闭包检查（preload 必须 CJS、main 必须引用 `preload.cjs`、渲染器 import 不得逃出 `assets` 且目标模块必须存在）——唯一缺陷是入口只有 2 个（§10 P3-3）。
33. **配置校验对**类型**是严格的**：`parseProfileJson`（去代码围栏 + 对象检查）、每层 `rejectUnknown`、`profileVersion === 1`、`typeof value === "number"` + `Number.isFinite`、风险组 id 正则、市场/代码一致性、重复代码检测、应用后 `assertSavableSettings`。漏洞在**量级**（§2-1）、`assertSavableSettings` 缺整数校验（§5-8）、可空与必填不匹配（§5-4）、静默截断 100 条（§5-1），而非未知键校验。
34. **merge/replace 语义正确**（除 §5-5、§5-10）：replace 只动显式出现的集合，证券合并保持非破坏性，导入规则强制影子模式，被省略的既有提醒规则被保留（`profile.ts:484-517`，`profile.test.ts:118-127`）。
35. **提醒字段无漂移**：`HoldingAlertRules`（11 字段）、`normalizeHoldingAlertRules`、`EMPTY_ALERT_RULES`、`ALERT_KEYS`、`assertSavableSettings` 的规则列表、`profile.ts` 的列表**六处一致**；`AlertRuleType`（18 个成员）被 `risk.ts` 完整覆盖；`RiskSettings` 的 10 个数值字段在三个校验器中都列出。
36. **其他纯函数正确**：`domain/market.ts:32-50` 的 BOLL（20 周期、总体方差）、`windowBounds.ts`/`quickWindowBounds.ts` 的钳制、`runtimeSecurity.ts` 的 loopback/HTTPS/file-URL 检查、`refreshPolicy.ts` 的间隔计算、`newsEvents`/`decision`/`handoff`/`analysis` 的守卫与算术；AI 返回的 `NewsAnalysis` 数组不可能是 `undefined`（`openaiCompatible.ts:355-413` 的 `readStringArray`）→ `decision.ts:65`/`news.ts:62` 不会抛错。

---

## 12. 优化路线图（建议执行顺序）

| 顺序 | 动作 | 规模 | 理由 |
| --- | --- | --- | --- |
| 1 | 给 `costPrice`/`quantity`/`accountBaseline` 加量级界，`round` 溢出安全，`positiveOrNull` 归零返回 null | 小 | **唯一会破坏用户数据**的缺陷（§2-1） |
| 2 | 提醒穿越改非严格比较；模式切换时 rebase | 小 | 两条"该响不响"，且改动小、有现成测试可回归（§2-2/§2-3） |
| 3 | 持仓汇总卡改用 `risk.portfolio` 的 null-safe 值 | 小 | 消除"看起来确定的错数"（§2-4） |
| 4 | 修 4 处渲染层用户可见缺陷（滚动目标→`.scroll-list`、编辑栏焦点守卫、标签栏原位更新、复制定时器句柄） | 小 | 最低风险、立即可见（§4-1…§4-4） |
| 5 | 升级 Electron 至 44.x 并回归打包 | 中 | 唯一"时间在恶化"的安全项（§7-1） |
| 6 | 交易日历跨年显式降级 + 2027 测试 | 小 | 2027-01-01 起必然出错（§3-3） |
| 7 | 修正腾讯 `amount` 字段并固定测试；行情路径传 market | 小 | 两个"显示错数/永远无数据"（§3-1/§3-2） |
| 8 | 加 CI（typecheck + test + build） | 小 | 门槛最低，立刻防止退化（§6-2） |
| 9 | 接 eslint + prettier + tsconfig 严格标志；删死 CSS | 中 | 把现有良好纪律固定（§6-1、§4-10） |
| 10 | 引入 c8 覆盖率并设阈值 | 小 | 让覆盖率重新可验证（§6-3） |
| 11 | 补 3 个 provider 测试 + 抽 `main.ts` 纯逻辑 + 补所列测试缺口 | 中 | 覆盖最易漂移的盲区（§6-4） |
| 12 | `fetchWithTimeout` 定时器与错误体；轮询加 `.catch`；`fetchDetail` 单飞 | 中 | 消除定时器泄漏、未处理 rejection 与重复上游请求（§3-5…§3-7） |
| 13 | FNV 换 SHA-256；`details` 缓存加 LRU；AI 内存缓存加淘汰 | 中 | 消除静默数据丢失与无界增长（§3-8/§3-4/§3-9） |
| 14 | 上海日期窗口 + 配置项收敛（导入/截断/枚举/整数/版本守卫） | 中 | 修一组"输入被静默改写/拒绝"的问题（§3-10、§5） |
| 15 | 建 `presentation/format.ts` + `renderer/dom.ts` 共享层并迁移 5 个渲染器 | 中 | 一次消除 5 个 `escapeHtml`/6 个时间/6 个数字格式化与组内不一致（§4-7） |
| 16 | 表格视图改增量更新 + 修正 README 声明 | 中 | 让 `README.md:81` 成为事实（§4-3） |
| 17 | 加边界校验 `parseSnapshot`/`normalizePublicSnapshot` | 中 | 把静默 `undefined` 与误导性错误变成具名错误（§4-4） |
| 18 | 统一版本策略 + macOS 打包脚本 + 打包负向断言 | 中 | 恢复"从仓库可复现发布"（§10） |
| 19 | 拆分 `settingsRenderer.ts`（字段表 → 控制器 → 视图） | 大 | 先做字段表，它会暴露真实状态形状（§4-5） |
| 20 | 拆分 `renderer.ts` 并停止全量重渲染 | 大 | 消除 3 秒级焦点/选区丢失，需 GUI 回归（§4-2） |

---

## 13. 审计局限

- **未做 GUI 实机验证**：透明窗口、无边框、点击穿透、置顶、托盘状态、全局老板键、系统通知、多显示器边界、表格工作台与本地网页的实际交互均未运行验证。§4 的缺陷是**静态代码事实**，修复后必须做 GUI 回归。
- **未验证 macOS 行为**（Dock 同步、快捷键、签名、公证）与安装包安装/卸载流程。
- **未做长时间运行测试**（内存增长、SQLite 长期膨胀、定时器漂移）。
- **`src/settingsRenderer.ts` 未纳入深度审计**，因此无法判断设置界面本身能否产生 §2-1 的超界值；已确认可达的路径是**不可信配置包导入**与手工编辑 `settings.json`。
- **需联网才能确认的项**：腾讯/东财实时字段映射与单位（§3-1、S-12）、`trends2` 的 `f55` 是每分钟还是累计、2026 休市表是否与交易所日历完全一致（§3-3 的**触发日期**由代码确定，表内容未核对）。
- **需实机确认的项**：Electron 39 在主进程出现未处理 rejection 时是弹窗还是退出（只影响 §3-7 的影响面，不影响其存在）。
- 依赖漏洞结论为 2026-09-25 快照，有时效性。
- 本轮未经 `tsc`/测试套件复核子审计提出的类型层面结论（如 §5-4 的 `null` 赋给 `number`）——该结论由构造上必然成立，但未跑类型检查器确认。
