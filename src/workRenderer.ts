import type { PublicSnapshot, PublicTrend } from "./presentation/publicSnapshot.js";

interface WorkContent {
  title: string;
  subtitle: string;
  theme: "mist" | "blue";
  showData: boolean;
  todos: Array<{ id: string; text: string; done: boolean }>;
  logs: Array<{ id: string; text: string; time: string }>;
  links: Array<{ id: string; label: string; url: string }>;
}

const contentKey = "moyu.work-web.content.v3";
const cacheKey = "moyu.work-web.snapshot.v1";
const clientId = `client_${crypto.randomUUID().replaceAll("-", "")}`;
let content = loadContent();
let latest = loadSnapshotCache();
let events: EventSource | null = null;
let sessionReady = false;
const trends = new Map<string, PublicTrend>();
const trendLoading = new Set<string>();
let selectedTrendCode = "";
let miniPreloadActive = false;

const root = document.querySelector<HTMLDivElement>("#work-root");
if (!root) throw new Error("Missing work root");
const rootElement = root;

rootElement.innerHTML = `
  <div class="work-app">
    <header class="portal-header">
      <div class="masthead">
        <div class="brand-mark"><i></i><i></i><i></i><i></i></div>
        <div class="brand-copy"><input id="page-title" maxlength="32"><input id="page-subtitle" maxlength="80"></div>
        <nav class="portal-nav"><button class="active">首页</button><button>动态</button><button>项目</button><button>任务</button><button>文档</button><button>日程</button><button>资源</button></nav>
        <div class="portal-search"><input placeholder="请输入关键词"><button>搜索</button></div>
        <div class="sync-state"><span id="sync-dot"></span><b id="sync-label">读取缓存</b><small id="sync-time">--:--</small></div>
      </div>
    </header>
    <div class="notice-strip"><b>今日提示</b><span>本周重点工作进入集中推进阶段，请及时更新进度与相关材料。</span><time>今日</time></div>
    <main class="portal-main">
      <div class="portal-columns">
        <aside class="left-column">
          <section class="portal-box todo-card">
            <div class="section-title"><h2>今日待办</h2><span id="todo-count"></span></div>
          <div id="todo-list" class="todo-list"></div>
          <form id="todo-form" class="quick-form"><input id="todo-input" maxlength="60" placeholder="添加一项工作"><button>添加</button></form>
          </section>
          <section class="portal-box service-box"><div class="section-title"><h2>快捷入口</h2><span>全部</span></div><div class="service-grid"><button>任务中心</button><button>会议安排</button><button>联系人</button><button>申请记录</button><button>资料提交</button><button>进度跟踪</button></div></section>
          <section class="portal-box document-box"><div class="section-title"><h2>最近文档</h2><span>全部</span></div><ul><li>重点工作任务分解表</li><li>月度进展填写说明</li><li>会议记录参考模板</li><li>常用工作表单汇编</li><li>项目资料归档规范</li></ul></section>
          <section class="portal-box link-card"><div class="section-title"><h2>常用链接</h2><span>自定义</span></div><div id="link-list"></div>
            <form id="link-form" class="link-form"><input id="link-label" maxlength="20" placeholder="名称"><input id="link-url" maxlength="200" placeholder="https://"><button>添加</button></form>
          </section>
        </aside>
        <section class="center-column">
          <section class="portal-box news-center">
            <div class="section-title tabs"><h2>最新动态</h2><span>全部　团队　项目　行业</span></div>
            <div class="lead-story" id="lead-story"></div>
            <div id="event-list" class="news-list"></div>
          </section>
          <div class="info-pair">
            <section class="portal-box"><div class="section-title"><h2>团队动态</h2><span>全部</span></div><ul class="dense-list"><li><b>协作</b><span>本周重点事项协调会召开</span><time>07-12</time></li><li><b>项目</b><span>阶段性任务进度完成更新</span><time>07-12</time></li><li><b>流程</b><span>工作流程优化意见开始征集</span><time>07-11</time></li><li><b>资料</b><span>资料集中归档工作有序推进</span><time>07-11</time></li><li><b>提醒</b><span>月度工作提示发布</span><time>07-10</time></li></ul></section>
            <section class="portal-box"><div class="section-title"><h2>文档更新</h2><span>全部</span></div><ul class="dense-list"><li><b>说明</b><span>材料提交要求更新</span><time>07-12</time></li><li><b>指引</b><span>项目全过程管理工作指引</span><time>07-11</time></li><li><b>计划</b><span>近期重点工作安排</span><time>07-10</time></li><li><b>规范</b><span>内部信息发布规范</span><time>07-09</time></li><li><b>参考</b><span>常见问题处理方式汇编</span><time>07-08</time></li></ul></section>
          </div>
          <section class="portal-box project-card" id="data-module">
            <div class="section-title"><h2>数据摘要</h2><button data-action="toggle-data">收起</button></div>
            <div class="project-table" id="project-table"></div>
            <div class="trend-detail" id="trend-detail" hidden></div>
          </section>
        </section>
        <aside class="right-column">
          <section class="portal-box notice-box"><div class="section-title"><h2>公告</h2><span>全部</span></div><ul><li><i>12</i><span>本周工作进展更新提醒</span></li><li><i>11</i><span>近期会议安排及材料要求</span></li><li><i>10</i><span>系统维护时间提醒</span></li><li><i>09</i><span>资料目录更新说明</span></li><li><i>08</i><span>月度重点事项提示</span></li></ul></section>
          <section class="portal-box summary-card" id="summary-card"></section>
          <section class="portal-box schedule-box"><div class="section-title"><h2>今日安排</h2><span>日程</span></div><ol><li><time>09:30</time><span>部门例会</span></li><li><time>11:00</time><span>材料进度确认</span></li><li><time>14:30</time><span>项目专题沟通</span></li><li><time>16:20</time><span>当日工作汇总</span></li></ol></section>
          <section class="portal-box log-card">
            <div class="section-title"><h2>工作日志</h2><span>最近记录</span></div>
            <div id="log-list" class="log-list"></div>
            <form id="log-form" class="quick-form"><input id="log-input" maxlength="100" placeholder="记录刚刚完成的事项"><button>记录</button></form>
          </section>
        </aside>
      </div>
    </main>
    <footer><span>Workspace</span><span>动态 · 项目 · 文档 · 日程</span><span>内容保存在当前浏览器</span><span id="footer-state">安全连接</span></footer>
  </div>`;

const titleInput = required<HTMLInputElement>("#page-title");
const subtitleInput = required<HTMLInputElement>("#page-subtitle");
const syncDot = required("#sync-dot");
const syncLabel = required("#sync-label");
const syncTime = required("#sync-time");
const todoList = required("#todo-list");
const todoCount = required("#todo-count");
const logList = required("#log-list");
const linkList = required("#link-list");
const projectTable = required("#project-table");
const trendDetail = required("#trend-detail");
const eventList = required("#event-list");
const leadStory = required("#lead-story");
const summaryCard = required("#summary-card");
const dataModule = required("#data-module");
const footerState = required("#footer-state");

renderContent();
if (latest) renderSnapshot(latest);
void initialize();

rootElement.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action],[data-todo],[data-trend]");
  if (!target) return;
  if (target.dataset.action === "theme") {
    content.theme = content.theme === "mist" ? "blue" : "mist";
    saveContent();
    renderContent();
  }
  if (target.dataset.action === "export") exportContent();
  if (target.dataset.action === "close-trend") {
    selectedTrendCode = "";
    trendDetail.hidden = true;
  }
  if (target.dataset.action === "toggle-data") {
    content.showData = !content.showData;
    saveContent();
    renderContent();
  }
  if (target.dataset.todo) {
    const item = content.todos.find((todo) => todo.id === target.dataset.todo);
    if (item) item.done = !item.done;
    saveContent();
    renderTodos();
  }
  if (target.dataset.trend) void showTrend(target.dataset.trend);
});

required<HTMLFormElement>("#todo-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = required<HTMLInputElement>("#todo-input");
  const text = cleanText(input.value, 60);
  if (!text || content.todos.length >= 12) return;
  content.todos.push({ id: crypto.randomUUID(), text, done: false });
  input.value = "";
  saveContent();
  renderTodos();
});

required<HTMLFormElement>("#log-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = required<HTMLInputElement>("#log-input");
  const text = cleanText(input.value, 100);
  if (!text) return;
  content.logs.unshift({ id: crypto.randomUUID(), text, time: new Date().toISOString() });
  content.logs = content.logs.slice(0, 8);
  input.value = "";
  saveContent();
  renderLogs();
});

required<HTMLFormElement>("#link-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const labelInput = required<HTMLInputElement>("#link-label");
  const urlInput = required<HTMLInputElement>("#link-url");
  const label = cleanText(labelInput.value, 20);
  const url = safeUrl(urlInput.value);
  if (!label || !url || content.links.length >= 8) return;
  content.links.push({ id: crypto.randomUUID(), label, url });
  labelInput.value = "";
  urlInput.value = "";
  saveContent();
  renderLinks();
});

titleInput.addEventListener("change", () => {
  content.title = cleanText(titleInput.value, 32) || defaultContent().title;
  saveContent();
  renderHeading();
});
subtitleInput.addEventListener("change", () => {
  content.subtitle = cleanText(subtitleInput.value, 80);
  saveContent();
  renderHeading();
});

document.addEventListener("visibilitychange", () => void reportVisibility());
window.addEventListener("pagehide", () => void reportVisibility(false));

async function initialize(): Promise<void> {
  const token = decodeURIComponent(location.hash.slice(1));
  try {
    if (token) {
      const response = await fetch("/api/session", { method: "POST", headers: { "X-Local-Token": token } });
      if (!response.ok) throw new Error("session");
      history.replaceState(null, "", location.pathname);
    }
    const response = await fetch("/api/public-snapshot", { cache: "no-store" });
    if (!response.ok) throw new Error("snapshot");
    sessionReady = true;
    applySnapshot(await response.json() as PublicSnapshot);
    connectEvents();
    await reportVisibility();
  } catch {
    setConnection("error", "访问已失效", "请从应用托盘重新打开");
  }
}

function connectEvents(): void {
  events?.close();
  events = new EventSource(`/api/events?client=${encodeURIComponent(clientId)}`);
  events.addEventListener("snapshot", (event) => {
    try { applySnapshot(JSON.parse((event as MessageEvent).data) as PublicSnapshot); } catch { /* keep cache */ }
  });
  events.onopen = () => setConnection("online", "已连接", formatTime(latest?.updatedAt));
  events.onerror = () => setConnection("cached", "使用缓存", "等待自动重连");
}

function applySnapshot(snapshot: PublicSnapshot): void {
  latest = snapshot;
  localStorage.setItem(cacheKey, JSON.stringify(snapshot));
  renderSnapshot(snapshot);
  setConnection(snapshot.feeds.stale ? "cached" : "online", snapshot.feeds.stale ? "数据延迟" : "已同步", formatTime(snapshot.feeds.quotesUpdatedAt));
}

function renderSnapshot(snapshot: PublicSnapshot): void {
  renderProjectTable(snapshot);
  const lead = snapshot.events[0];
  leadStory.innerHTML = lead
    ? `<span>${escapeHtml(lead.category)}</span><h1>${escapeHtml(lead.title)}</h1><p>最新公开信息已汇总更新，相关内容请结合工作安排持续关注。</p>`
    : `<span>专题</span><h1>近期重点工作信息汇总</h1><p>各项工作按计划推进，请及时关注通知与动态更新。</p>`;
  eventList.innerHTML = snapshot.events.slice(1, 8).map((item) => `<article><span>${escapeHtml(item.category)}</span><b>${escapeHtml(item.title)}</b><time>${formatTime(item.publishedAt)}</time></article>`).join("") || `<p class="empty">暂无新增资讯</p>`;
  const up = snapshot.quotes.filter((item) => (item.changePercent ?? 0) > 0).length;
  const down = snapshot.quotes.filter((item) => (item.changePercent ?? 0) < 0).length;
  const indexLabels = ["综合指标一", "综合指标二", "成长指标"];
  summaryCard.innerHTML = `<div class="section-title"><h2>今日概览</h2><span>自动更新</span></div><div class="summary-metrics"><span><b>${snapshot.quotes.length}</b><small>跟踪项</small></span><span><b>${up}</b><small>上行</small></span><span><b>${down}</b><small>下行</small></span></div><div class="index-list">${snapshot.indices.map((item, index) => `<div><span>${indexLabels[index] ?? `指标${index + 1}`}</span><b>${number(item.value)}</b><em class="${direction(item.changePercent)}">${percent(item.changePercent)}</em></div>`).join("")}</div>`;
  if (sessionReady && document.visibilityState === "visible") void preloadMiniTrends(snapshot.quotes.map((item) => item.code));
}

function renderProjectTable(snapshot: PublicSnapshot): void {
  projectTable.innerHTML = `<div class="table-row table-head"><span>编号</span><span>名称</span><span>当前值</span><span>较前期</span><span>状态</span><span>趋势</span></div>` +
    snapshot.quotes.map((item) => `<div class="table-row"><button class="code-button" data-trend="${escapeHtml(item.code)}">${escapeHtml(item.code)}</button><span>${escapeHtml(item.name)}</span><b>${number(item.price)}</b><span class="${direction(item.changePercent)}">${percent(item.changePercent)}</span><em>${escapeHtml(item.status)}</em>${renderMiniTrend(item.code)}</div>`).join("");
}

function renderMiniTrend(code: string): string {
  const trend = trends.get(code);
  if (!trend || trend.items.length < 2) return `<button class="mini-trend loading" data-trend="${escapeHtml(code)}">···</button>`;
  const items = trend.items.slice(-30);
  const values = items.map((item) => item.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const points = items.map((item, index) => `${(index / (items.length - 1) * 88 + 2).toFixed(1)},${(20 - (item.close - min) / (max - min || 1) * 16).toFixed(1)}`).join(" ");
  return `<button class="mini-trend" data-trend="${escapeHtml(code)}" aria-label="查看${escapeHtml(code)}趋势"><svg viewBox="0 0 92 24"><polyline points="${points}" /></svg></button>`;
}

async function preloadMiniTrends(codes: string[]): Promise<void> {
  if (miniPreloadActive) return;
  miniPreloadActive = true;
  try {
    for (const code of codes.slice(0, 8)) {
      if (document.visibilityState !== "visible") return;
      if (!trends.has(code)) await loadTrend(code, false);
    }
  } finally {
    miniPreloadActive = false;
  }
}

async function showTrend(code: string): Promise<void> {
  selectedTrendCode = code;
  trendDetail.hidden = false;
  const cached = trends.get(code);
  if (cached) renderTrendDetail(cached);
  else {
    trendDetail.innerHTML = `<div class="trend-loading">正在读取趋势数据…</div>`;
    await loadTrend(code, true);
  }
}

async function loadTrend(code: string, expand: boolean): Promise<void> {
  if (trendLoading.has(code)) return;
  trendLoading.add(code);
  try {
    const response = await fetch(`/api/trend?code=${encodeURIComponent(code)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("trend");
    const trend = await response.json() as PublicTrend;
    trends.set(code, trend);
    if (latest) renderProjectTable(latest);
    if ((expand || selectedTrendCode === code) && selectedTrendCode === code) renderTrendDetail(trend);
  } catch {
    if (selectedTrendCode === code) trendDetail.innerHTML = `<div class="trend-loading">趋势数据暂时不可用</div>`;
  } finally {
    trendLoading.delete(code);
  }
}

function renderTrendDetail(trend: PublicTrend): void {
  if (trend.items.length < 2) {
    trendDetail.innerHTML = `<div class="trend-loading">暂无足够趋势数据</div>`;
    return;
  }
  const width = 760;
  const height = 210;
  const items = trend.items;
  const values = items.flatMap((item) => [item.close, ...(item.upper == null ? [] : [item.upper]), ...(item.lower == null ? [] : [item.lower])]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (index: number) => 42 + index / (items.length - 1) * (width - 56);
  const y = (value: number) => 16 + (max - value) / (max - min || 1) * (height - 48);
  const line = (field: "close" | "upper" | "mid" | "lower") => items.flatMap((item, index) => item[field] == null ? [] : [`${x(index).toFixed(1)},${y(item[field]!).toFixed(1)}`]).join(" ");
  trendDetail.innerHTML = `<div class="trend-detail-head"><div><b>趋势观察</b><span>${escapeHtml(trend.code)} · 最近 ${items.length} 个交易日</span></div><div class="trend-legend"><i class="close"></i>当前<i class="upper"></i>上轨<i class="mid"></i>中轨<i class="lower"></i>下轨</div><button data-action="close-trend">收起</button></div><svg class="trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(trend.code)}趋势观察图"><g class="chart-grid"><line x1="42" x2="${width - 14}" y1="55" y2="55"/><line x1="42" x2="${width - 14}" y1="105" y2="105"/><line x1="42" x2="${width - 14}" y1="155" y2="155"/></g><polyline class="upper" points="${line("upper")}"/><polyline class="mid" points="${line("mid")}"/><polyline class="lower" points="${line("lower")}"/><polyline class="close" points="${line("close")}"/><text x="2" y="22">${number(max)}</text><text x="2" y="${height - 34}">${number(min)}</text><text x="42" y="${height - 8}">${escapeHtml(items[0]!.date)}</text><text class="end" x="${width - 14}" y="${height - 8}">${escapeHtml(items.at(-1)!.date)}</text></svg>`;
}

function renderContent(): void {
  document.documentElement.dataset.theme = content.theme;
  renderHeading();
  renderTodos();
  renderLogs();
  renderLinks();
  dataModule.classList.toggle("module-hidden", !content.showData);
  const toggle = dataModule.querySelector<HTMLButtonElement>("[data-action=toggle-data]");
  if (toggle) toggle.textContent = content.showData ? "隐藏" : "显示";
}

function renderHeading(): void { titleInput.value = content.title; subtitleInput.value = content.subtitle; }

function renderTodos(): void {
  todoCount.textContent = `${content.todos.filter((item) => !item.done).length} 项待完成`;
  todoList.innerHTML = content.todos.map((item) => `<button class="todo-item ${item.done ? "done" : ""}" data-todo="${item.id}"><i>${item.done ? "✓" : ""}</i><span>${escapeHtml(item.text)}</span></button>`).join("") || `<p class="empty">今天还没有待办</p>`;
}

function renderLogs(): void {
  logList.innerHTML = content.logs.map((item) => `<article><time>${formatTime(item.time)}</time><span>${escapeHtml(item.text)}</span></article>`).join("") || `<p class="empty">完成工作后在这里留一条简短记录</p>`;
}

function renderLinks(): void {
  linkList.innerHTML = content.links.map((item) => `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer"><span>${escapeHtml(item.label)}</span><b>↗</b></a>`).join("") || `<p class="empty">可添加常用工作链接</p>`;
}

function setConnection(state: "online" | "cached" | "error", label: string, detail: string): void {
  syncDot.className = state;
  syncLabel.textContent = label;
  syncTime.textContent = detail;
  footerState.textContent = state === "online" ? "本机安全连接" : label;
}

async function reportVisibility(visible = document.visibilityState === "visible"): Promise<void> {
  try {
    await fetch("/api/visibility", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, visible }), keepalive: true });
  } catch { /* connection state is handled by SSE */ }
}

function exportContent(): void {
  const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), content }, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `工作记录-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function loadContent(): WorkContent {
  try {
    const value = JSON.parse(localStorage.getItem(contentKey) ?? "null") as Partial<WorkContent> | null;
    if (!value) return defaultContent();
    return {
      title: cleanText(value.title, 32) || defaultContent().title,
      subtitle: cleanText(value.subtitle, 80),
      theme: value.theme === "blue" ? "blue" : "mist",
      showData: value.showData !== false,
      todos: Array.isArray(value.todos) ? value.todos.slice(0, 12).flatMap((item) => item && typeof item.text === "string" ? [{ id: String(item.id || crypto.randomUUID()), text: cleanText(item.text, 60), done: item.done === true }] : []) : [],
      logs: Array.isArray(value.logs) ? value.logs.slice(0, 8).flatMap((item) => item && typeof item.text === "string" ? [{ id: String(item.id || crypto.randomUUID()), text: cleanText(item.text, 100), time: String(item.time || new Date().toISOString()) }] : []) : [],
      links: Array.isArray(value.links) ? value.links.slice(0, 8).flatMap((item) => {
        const url = safeUrl(item?.url);
        const label = cleanText(item?.label, 20);
        return url && label ? [{ id: String(item.id || crypto.randomUUID()), label, url }] : [];
      }) : []
    };
  } catch { return defaultContent(); }
}

function defaultContent(): WorkContent {
  return {
    title: "工作空间", subtitle: "动态 · 项目 · 文档", theme: "mist", showData: true,
    todos: [
      { id: "default-1", text: "整理本周项目进展", done: false },
      { id: "default-2", text: "核对待确认事项", done: false },
      { id: "default-3", text: "更新工作记录", done: false }
    ], logs: [], links: []
  };
}

function saveContent(): void { localStorage.setItem(contentKey, JSON.stringify(content)); }
function loadSnapshotCache(): PublicSnapshot | null {
  try { return JSON.parse(localStorage.getItem(cacheKey) ?? "null") as PublicSnapshot | null; } catch { return null; }
}
function required<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = rootElement.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}
function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, max) : "";
}
function safeUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : ""; } catch { return ""; }
}
function number(value: number | null): string { return value == null ? "--" : value.toLocaleString("zh-CN", { maximumFractionDigits: 2 }); }
function percent(value: number | null): string { return value == null ? "--" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`; }
function direction(value: number | null): string { return value == null || value === 0 ? "" : value > 0 ? "positive" : "negative"; }
function formatTime(value: string | null | undefined): string {
  if (!value) return "--:--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--:--" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
