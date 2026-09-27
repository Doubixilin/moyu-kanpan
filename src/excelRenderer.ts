import type { AppSnapshot, MarketDetail } from "./domain/types.js";
import { buildExcelWorkbook, type ExcelSheetData } from "./presentation/excelWorkbook.js";
import {
  defaultExcelCustomSheet,
  isEditableExcelAddress,
  normalizeExcelCustomSheet,
  sanitizeExcelCellText,
  type ExcelCustomSheetState
} from "./presentation/excelCustomSheet.js";
import { buildExcelBollChart } from "./presentation/excelTrend.js";
import {
  escapeHtml,
  formatClockTimeWithSeconds,
  formatFixedOrDash
} from "./presentation/format.js";

type RibbonTab = "home" | "insert" | "layout" | "formulas" | "data" | "review" | "view";

const columns = Array.from({ length: 18 }, (_, index) => columnName(index + 1));
const rowCount = 60;
const customStorageKey = "moyu.excel.custom-sheet.v1";
let sheets: ExcelSheetData[] = [
  {
    id: "overview",
    name: "项目总览",
    cells: {
      A1: "2026年7月项目数据汇总",
      A3: "序号",
      B3: "项目名称",
      C3: "项目代码",
      D3: "负责人",
      E3: "计划进度",
      F3: "实际进度",
      G3: "本周变化",
      H3: "当前状态",
      I3: "更新时间",
      J3: "备注",
      A4: 1,
      B4: "年度重点项目",
      C4: "XM-001",
      D4: "王宁",
      E4: "72%",
      F4: "74%",
      G4: "+2.0%",
      H4: "正常",
      I4: "10:32",
      J4: "按计划推进",
      A5: 2,
      B5: "运营效率提升",
      C5: "XM-002",
      D5: "李然",
      E5: "58%",
      F5: "55%",
      G5: "-1.2%",
      H5: "关注",
      I5: "10:32",
      J5: "等待外部确认",
      A6: 3,
      B6: "供应链优化",
      C6: "XM-003",
      D6: "陈嘉",
      E6: "66%",
      F6: "69%",
      G6: "+3.4%",
      H6: "正常",
      I6: "10:32",
      J6: "阶段目标完成",
      A7: 4,
      B7: "客户服务改造",
      C7: "XM-004",
      D7: "赵屿",
      E7: "81%",
      F7: "80%",
      G7: "+0.6%",
      H7: "正常",
      I7: "10:32",
      J7: "本周验收",
      A10: "本周摘要",
      A11: "完成事项",
      B11: 12,
      A12: "进行中",
      B12: 7,
      A13: "待核验",
      B13: 2,
      D10: "关键指标",
      D11: "整体完成率",
      E11: "69.5%",
      D12: "正常项目",
      E12: 3,
      D13: "关注项目",
      E13: 1
    }
  },
  {
    id: "tracking",
    name: "进度跟踪",
    cells: {
      A1: "项目执行进度跟踪表",
      A3: "日期",
      B3: "项目",
      C3: "工作事项",
      D3: "计划完成",
      E3: "实际完成",
      F3: "偏差",
      G3: "状态",
      H3: "下一步动作",
      I3: "责任人",
      A4: "7月8日",
      B4: "XM-001",
      C4: "需求确认",
      D4: "100%",
      E4: "100%",
      F4: "0%",
      G4: "完成",
      H4: "进入实施",
      I4: "王宁",
      A5: "7月9日",
      B5: "XM-002",
      C5: "数据核验",
      D5: "80%",
      E5: "72%",
      F5: "-8%",
      G5: "关注",
      H5: "补充数据",
      I5: "李然",
      A6: "7月10日",
      B6: "XM-003",
      C6: "方案评审",
      D6: "60%",
      E6: "65%",
      F6: "+5%",
      G6: "正常",
      H6: "形成纪要",
      I6: "陈嘉",
      A7: "7月11日",
      B7: "XM-004",
      C7: "阶段验收",
      D7: "75%",
      E7: "74%",
      F7: "-1%",
      G7: "正常",
      H7: "修订材料",
      I7: "赵屿"
    }
  },
  {
    id: "activity",
    name: "动态记录",
    cells: {
      A1: "工作动态与事项记录",
      A3: "时间",
      B3: "类别",
      C3: "关联项目",
      D3: "事项摘要",
      E3: "优先级",
      F3: "处理状态",
      G3: "记录人",
      A4: "09:20",
      B4: "会议",
      C4: "XM-001",
      D4: "完成阶段方案评审",
      E4: "普通",
      F4: "已处理",
      G4: "王宁",
      A5: "10:05",
      B5: "数据",
      C5: "XM-002",
      D5: "收到最新外部数据",
      E5: "关注",
      F5: "核验中",
      G5: "李然",
      A6: "10:28",
      B6: "进度",
      C6: "XM-003",
      D6: "里程碑状态更新",
      E6: "普通",
      F6: "已处理",
      G6: "陈嘉",
      A7: "11:10",
      B7: "提醒",
      C7: "XM-004",
      D7: "阶段材料待补充",
      E7: "重要",
      F7: "待处理",
      G7: "赵屿"
    }
  }
];
const customSheetState = loadCustomSheet();
let latestSnapshot: AppSnapshot | null = null;
let selectedTrendCode = "";
let trendRequestGeneration = 0;
const trendCache = new Map<string, MarketDetail>();
sheets = withUtilitySheets(sheets);

const root = document.querySelector<HTMLDivElement>("#excel-root");
if (!root) throw new Error("Missing excel root");
const rootElement = root;
let activeRibbon: RibbonTab = "home";
let activeSheetIndex = 0;
let selectedRow = 4;
let selectedColumn = 2;
let zoom = 100;
let gridlines = true;
/** 上一次写入 DOM 的单元格文本，键为单元格地址（网格重建时清空）。 */
const lastRenderedCells = new Map<string, string>();

rootElement.innerHTML = `
  <main class="excel-app">
    <header class="titlebar drag-region">
      <div class="quick-access no-drag"><button aria-label="保存">▣</button><button aria-label="撤销">↶</button><button aria-label="恢复">↷</button></div>
      <div class="workbook-title">月度工作台　-　数据表</div>
      <div class="title-search no-drag">搜索</div>
      <div class="account no-drag"><span>A</span></div>
      <div class="window-controls no-drag">
        <button data-window="minimize" aria-label="最小化">─</button>
        <button data-window="maximize" aria-label="最大化">□</button>
        <button class="close" data-window="close" aria-label="关闭">×</button>
      </div>
    </header>
    <nav class="ribbon-tabs">
      <button class="file-tab">文件</button>
      ${ribbonTab("home", "开始", true)}${ribbonTab("insert", "插入")}${ribbonTab("layout", "页面布局")}
      ${ribbonTab("formulas", "公式")}${ribbonTab("data", "数据")}${ribbonTab("review", "审阅")}${ribbonTab("view", "视图")}
      <span class="share-hint">共享</span>
    </nav>
    <section class="ribbon" id="ribbon-content"></section>
    <section class="formula-bar">
      <div class="name-box" id="name-box">B4</div><button class="formula-cancel">×</button><button class="formula-accept">✓</button>
      <div class="fx">fx</div><div class="formula-input" id="formula-input"></div>
    </section>
    <section class="worksheet-shell">
      <div class="grid-viewport" id="grid-viewport" tabindex="0">
        <table class="sheet-grid" id="sheet-grid"></table>
        <div class="trend-panel" id="trend-panel" hidden></div>
      </div>
      <div class="sheetbar">
        <div class="sheet-nav"><button>◀</button><button>▶</button></div>
        <div class="sheet-tabs" id="sheet-tabs"></div><button class="new-sheet" title="新建工作表">＋</button>
        <div class="horizontal-placeholder"></div>
      </div>
    </section>
    <footer class="statusbar">
      <span id="status-text">就绪</span><span class="status-summary" id="status-summary">项目总览　记录: 0</span>
      <div class="view-buttons"><button>▦</button><button>▤</button><button>▥</button></div>
      <div class="zoom-control"><button data-zoom="down">−</button><input id="zoom-range" type="range" min="75" max="125" value="100"><button data-zoom="up">＋</button><span id="zoom-label">100%</span></div>
    </footer>
  </main>`;

const ribbonContent = required("#ribbon-content");
const grid = required<HTMLTableElement>("#sheet-grid");
const trendPanel = required("#trend-panel");
const gridViewport = required("#grid-viewport");
const sheetTabs = required("#sheet-tabs");
const nameBox = required("#name-box");
const formulaInput = required("#formula-input");
const zoomRange = required<HTMLInputElement>("#zoom-range");
const zoomLabel = required("#zoom-label");
const statusText = required("#status-text");
const statusSummary = required("#status-summary");

renderRibbon();
renderSheetTabs();
renderGrid();
selectCell(selectedRow, selectedColumn, false);
void window.floatingStock?.getSnapshot().then(applySnapshot);
window.floatingStock?.onSnapshot(applySnapshot);

rootElement.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("button,[data-cell]");
  if (!target) return;
  if (target.dataset.ribbon) {
    activeRibbon = target.dataset.ribbon as RibbonTab;
    document
      .querySelectorAll("[data-ribbon]")
      .forEach((item) => item.classList.toggle("active", item === target));
    renderRibbon();
  }
  if (target.dataset.sheetIndex !== undefined) {
    activeSheetIndex = Number(target.dataset.sheetIndex);
    selectedRow = 4;
    selectedColumn = 2;
    renderSheetTabs();
    renderGrid();
    selectCell(selectedRow, selectedColumn, false);
    updateStatusSummary();
    if (activeSheet()?.id === "trend") void loadTrendChart();
  }
  if (target.dataset.cell) {
    const match = /^([A-Z]+)(\d+)$/.exec(target.dataset.cell);
    if (match) selectCell(Number(match[2]), columnNumber(match[1]), true);
  }
  if (target.dataset.command === "bold") selectedCell()?.classList.toggle("format-bold");
  if (target.dataset.command === "center") selectedCell()?.classList.toggle("format-center");
  if (target.dataset.command === "fill") selectedCell()?.classList.toggle("format-fill");
  if (target.dataset.command === "gridlines") {
    gridlines = !gridlines;
    grid.classList.toggle("hide-gridlines", !gridlines);
  }
  if (target.dataset.zoom) setZoom(zoom + (target.dataset.zoom === "up" ? 5 : -5));
  if (target.dataset.command === "trend-refresh") void loadTrendChart(true);
  if (target.dataset.window)
    void window.floatingStock?.controlExcelWindow(
      target.dataset.window as "minimize" | "maximize" | "close"
    );
});

rootElement.addEventListener("dblclick", (event) => {
  const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-cell]");
  if (
    !cell?.dataset.cell ||
    activeSheet()?.id !== "custom" ||
    !isEditableExcelAddress(cell.dataset.cell)
  )
    return;
  formulaInput.focus();
  selectAllText(formulaInput);
});

rootElement.addEventListener("change", (event) => {
  const select = (event.target as HTMLElement).closest<HTMLSelectElement>("#trend-security");
  if (!select) return;
  selectedTrendCode = select.value;
  void loadTrendChart();
});

gridViewport.addEventListener("keydown", (event) => {
  if (activeSheet()?.id === "trend") return;
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Tab"].includes(event.key))
    return;
  event.preventDefault();
  if (event.key === "ArrowUp") selectedRow -= 1;
  if (event.key === "ArrowDown" || event.key === "Enter") selectedRow += 1;
  if (event.key === "ArrowLeft") selectedColumn -= 1;
  if (event.key === "ArrowRight" || event.key === "Tab") selectedColumn += 1;
  selectedRow = Math.min(rowCount, Math.max(1, selectedRow));
  selectedColumn = Math.min(columns.length, Math.max(1, selectedColumn));
  selectCell(selectedRow, selectedColumn, true);
});

formulaInput.addEventListener("keydown", (event) => {
  if (activeSheet()?.id !== "custom") return;
  if (event.key === "Enter") {
    event.preventDefault();
    formulaInput.blur();
  }
  if (event.key === "Escape") {
    event.preventDefault();
    formulaInput.textContent =
      activeSheet()?.cells[`${columnName(selectedColumn)}${selectedRow}`]?.toString() ?? "";
    formulaInput.blur();
  }
});
formulaInput.addEventListener("blur", commitCustomCell);

zoomRange.addEventListener("input", () => setZoom(Number(zoomRange.value)));

function renderRibbon(): void {
  const content: Record<RibbonTab, string> = {
    home: `${group("剪贴板", largeButton("▤", "粘贴") + smallStack(["剪切", "复制", "格式刷"]))}${group("字体", fontPanel())}${group("对齐方式", commandButton("≡", "左对齐") + commandButton("☰", "居中", "center") + commandButton("↵", "自动换行"))}${group("数字", numberPanel())}${group("样式", commandButton("▦", "条件格式") + commandButton("▤", "套用表格格式"))}${group("单元格", smallStack(["插入", "删除", "格式"]))}`,
    insert: `${group("表格", largeButton("▦", "数据透视表") + largeButton("▤", "表格"))}${group("插图", largeButton("▧", "图片") + largeButton("◇", "形状") + largeButton("▥", "图标"))}${group("图表", largeButton("▥", "推荐的图表") + commandButton("▥", "柱形图") + commandButton("⌁", "折线图"))}${group("链接", largeButton("⌁", "链接"))}`,
    layout: `${group("主题", largeButton("▧", "主题") + commandButton("A", "颜色") + commandButton("Aa", "字体"))}${group("页面设置", smallStack(["页边距", "方向", "纸张大小"]) + largeButton("▦", "打印区域"))}${group("调整为合适大小", smallStack(["宽度: 自动", "高度: 自动", "缩放: 100%"]))}`,
    formulas: `${group("函数库", largeButton("fx", "插入函数") + commandButton("Σ", "自动求和") + smallStack(["财务", "逻辑", "文本"]))}${group("定义的名称", smallStack(["名称管理器", "定义名称", "用于公式"]))}${group("公式审核", smallStack(["追踪引用单元格", "追踪从属单元格", "显示公式"]))}`,
    data: `${group("获取和转换数据", largeButton("⇩", "获取数据") + commandButton("▤", "来自表格") + commandButton("⟳", "全部刷新"))}${group("排序和筛选", largeButton("AZ", "排序") + commandButton("⌄", "筛选") + commandButton("×", "清除"))}${group("数据工具", smallStack(["分列", "快速填充", "删除重复项"]))}`,
    review: `${group("校对", largeButton("✓", "拼写检查") + largeButton("文", "翻译"))}${group("批注", largeButton("＋", "新建批注") + smallStack(["上一条", "下一条", "显示批注"]))}${group("保护", commandButton("▣", "保护工作表") + commandButton("▦", "保护工作簿"))}`,
    view: `${group("工作簿视图", largeButton("▦", "普通") + largeButton("▤", "分页预览") + largeButton("▥", "页面布局"))}${group("显示", commandButton("✓", "网格线", "gridlines") + commandButton("✓", "标题") + commandButton("✓", "编辑栏"))}${group("窗口", smallStack(["新建窗口", "全部重排", "冻结窗格"]))}${group("缩放", largeButton("100%", "缩放到100%"))}`
  };
  ribbonContent.innerHTML = content[activeRibbon];
}

function renderGrid(): void {
  const sheet = sheets[activeSheetIndex]!;
  const isTrend = sheet.id === "trend";
  grid.hidden = isTrend;
  trendPanel.hidden = !isTrend;
  if (isTrend) {
    renderTrendPanel(trendCache.get(selectedTrendCode), "选择项目后按需载入趋势数据");
    nameBox.textContent = "图表 1";
    formulaInput.textContent = "";
    setFormulaEditing(false);
    return;
  }
  grid.dataset.sheetId = sheet.id;
  const head = `<thead><tr><th class="corner"></th>${columns.map((column) => `<th>${column}</th>`).join("")}</tr></thead>`;
  const rows = Array.from({ length: rowCount }, (_, rowIndex) => {
    const row = rowIndex + 1;
    return `<tr><th class="row-number">${row}</th>${columns
      .map((column, columnIndex) => {
        const address = `${column}${row}`;
        const value = sheet.cells[address] ?? "";
        const classes = cellClasses(sheet, row, columnIndex, value);
        if (row === 1 && columnIndex === 0) {
          return `<td colspan="6" class="${classes}" data-cell="${address}" data-row="${row}" data-column="1">${escapeHtml(String(value))}</td>`;
        }
        if (row === 1 && columnIndex > 0 && columnIndex < 6) return "";
        return `<td class="${classes}" data-cell="${address}" data-row="${row}" data-column="${columnIndex + 1}">${escapeHtml(String(value))}</td>`;
      })
      .join("")}</tr>`;
  }).join("");
  grid.innerHTML = `${head}<tbody>${rows}</tbody>`;
  // 网格被整体重建，之前记录的单元格文本全部失效。
  lastRenderedCells.clear();
  grid.classList.toggle("hide-gridlines", !gridlines);
  setZoom(zoom);
}

function applySnapshot(snapshot: AppSnapshot): void {
  latestSnapshot = snapshot;
  sheets = withUtilitySheets(buildExcelWorkbook(snapshot));
  if (!trendOption(selectedTrendCode)) selectedTrendCode = trendOptions()[0]?.code ?? "";
  renderSheetTabs();
  updateVisibleCells();
  const updatedAt = snapshot.feeds.quotes.lastSuccessAt;
  statusText.textContent = updatedAt ? `已同步 ${formatStatusTime(updatedAt)}` : "等待数据";
  updateStatusSummary();
}

function updateVisibleCells(): void {
  const sheet = sheets[activeSheetIndex]!;
  if (sheet.id === "trend") {
    renderTrendPanel(
      trendCache.get(selectedTrendCode),
      trendCache.has(selectedTrendCode) ? "" : "选择项目后按需载入趋势数据"
    );
    return;
  }
  grid.dataset.sheetId = sheet.id;
  grid.querySelectorAll<HTMLTableCellElement>("td[data-cell]").forEach((cell) => {
    const address = cell.dataset.cell!;
    const raw = sheet.cells[address] ?? "";
    const value = String(raw);
    // 只更新真正变化的单元格：未变化时保留 DOM 上已有的 class（含手动格式）与选区，
    // 同时避免每次推送重写全部 18×60 个单元格。
    if (lastRenderedCells.get(address) === value) return;
    lastRenderedCells.set(address, value);
    const row = Number(cell.dataset.row);
    const columnIndex = Number(cell.dataset.column) - 1;
    const selected = cell.classList.contains("selected");
    const manualFormats = [...cell.classList].filter((name) => name.startsWith("format-"));
    // 传原始值给 cellClasses：它会按 typeof 区分数字与文本。
    cell.className = cellClasses(sheet, row, columnIndex, raw);
    if (selected) cell.classList.add("selected");
    cell.classList.add(...manualFormats);
    cell.textContent = value;
  });
  const address = `${columnName(selectedColumn)}${selectedRow}`;
  // 用户正在编辑栏输入时不得覆盖，否则每次轮询都会把进行中的编辑静默还原
  // （commitCustomCell 只在 blur 时提交，输入会直接丢失）。
  if (document.activeElement !== formulaInput) {
    formulaInput.textContent = sheet.cells[address]?.toString() ?? "";
  }
}

function cellClasses(
  sheet: ExcelSheetData,
  row: number,
  columnIndex: number,
  value: string | number
): string {
  return [
    row === 1 && columnIndex === 0 ? "sheet-title" : "",
    row === 3 && columnIndex < (sheet.id === "activity" ? 7 : sheet.id === "custom" ? 5 : 10)
      ? "table-header"
      : "",
    typeof value === "number" || /%$|^[-+]?\d/.test(String(value)) ? "numeric" : "",
    ["关注", "重要", "延迟", "冲突", "备用"].includes(String(value)) ? "attention-cell" : "",
    ["正常", "完整"].includes(String(value)) ? "ok-cell" : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function formatStatusTime(value: string): string {
  return formatClockTimeWithSeconds(value);
}

function updateStatusSummary(): void {
  const sheet = sheets[activeSheetIndex]!;
  if (sheet.id === "trend") {
    statusSummary.textContent = `趋势分析　${selectedTrendCode || "未选择项目"}`;
    return;
  }
  const populatedRows = new Set(
    Object.keys(sheet.cells)
      .map((address) => Number(address.match(/\d+$/)?.[0]))
      .filter((row) => row >= 4 && (sheet.id !== "overview" || row <= 13))
  );
  statusSummary.textContent = `${sheet.name}　记录: ${populatedRows.size}`;
}

function renderSheetTabs(): void {
  // 就地更新标签按钮，避免每次快照推送都销毁重建（会丢失焦点与 :hover/:active 状态）。
  const buttons = [...sheetTabs.querySelectorAll<HTMLButtonElement>("button[data-sheet-index]")];
  if (buttons.length !== sheets.length) {
    sheetTabs.innerHTML = sheets
      .map(
        (sheet, index) =>
          `<button class="${index === activeSheetIndex ? "active" : ""}" data-sheet-index="${index}">${escapeHtml(sheet.name)}</button>`
      )
      .join("");
    return;
  }
  buttons.forEach((button, index) => {
    button.classList.toggle("active", index === activeSheetIndex);
    const label = sheets[index]?.name ?? "";
    if (button.textContent !== label) button.textContent = label;
  });
}

function selectCell(row: number, column: number, focus: boolean): void {
  if (activeSheet()?.id === "trend") return;
  grid.querySelectorAll("td.selected").forEach((cell) => cell.classList.remove("selected"));
  const address = `${columnName(column)}${row}`;
  const cell = grid.querySelector<HTMLTableCellElement>(`[data-cell="${address}"]`);
  if (!cell) return;
  cell.classList.add("selected");
  selectedRow = row;
  selectedColumn = column;
  nameBox.textContent = address;
  formulaInput.textContent = sheets[activeSheetIndex]!.cells[address]?.toString() ?? "";
  const editable = activeSheet()?.id === "custom" && isEditableExcelAddress(address);
  setFormulaEditing(editable);
  statusText.textContent = editable
    ? "双击单元格或在编辑栏输入"
    : formulaInput.textContent
      ? "就绪"
      : "输入";
  cell.scrollIntoView({ block: "nearest", inline: "nearest" });
  if (focus) gridViewport.focus({ preventScroll: true });
}

function activeSheet(): ExcelSheetData | undefined {
  return sheets[activeSheetIndex];
}

function withUtilitySheets(base: ExcelSheetData[]): ExcelSheetData[] {
  return [
    ...base,
    { id: "custom", name: "工作记录", cells: { ...customSheetState.cells } },
    { id: "trend", name: "趋势分析", cells: {} }
  ];
}

function loadCustomSheet(): ExcelCustomSheetState {
  try {
    const saved = localStorage.getItem(customStorageKey);
    return saved ? normalizeExcelCustomSheet(JSON.parse(saved)) : defaultExcelCustomSheet();
  } catch {
    return defaultExcelCustomSheet();
  }
}

function commitCustomCell(): void {
  if (activeSheet()?.id !== "custom") return;
  const address = `${columnName(selectedColumn)}${selectedRow}`;
  if (!isEditableExcelAddress(address)) return;
  const value = sanitizeExcelCellText(formulaInput.textContent ?? "");
  if (value) customSheetState.cells[address] = value;
  else delete customSheetState.cells[address];
  localStorage.setItem(customStorageKey, JSON.stringify(customSheetState));
  const sheet = activeSheet();
  if (sheet) sheet.cells = { ...customSheetState.cells };
  const cell = grid.querySelector<HTMLTableCellElement>(`[data-cell="${address}"]`);
  if (cell) cell.textContent = value;
  formulaInput.textContent = value;
  statusText.textContent = "已自动保存";
  updateStatusSummary();
}

function setFormulaEditing(enabled: boolean): void {
  formulaInput.contentEditable = enabled ? "true" : "false";
  formulaInput.classList.toggle("editable", enabled);
  formulaInput.setAttribute("aria-label", enabled ? "编辑当前工作记录单元格" : "当前单元格内容");
}

function selectAllText(element: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function trendOptions(): Array<{ code: string; market: "SH" | "SZ" | "BJ"; name: string }> {
  if (!latestSnapshot) return [];
  const securities = new Map(latestSnapshot.settings.securities.map((item) => [item.code, item]));
  const quotes = new Map(latestSnapshot.quotes.map((item) => [item.code, item]));
  return latestSnapshot.settings.watchlist
    .filter((item) => item.visible)
    .sort((a, b) => a.order - b.order)
    .slice(0, 10)
    .flatMap((item) => {
      const security = securities.get(item.securityCode);
      return security
        ? [
            {
              code: security.code,
              market: security.market,
              name:
                security.alias || security.name || quotes.get(security.code)?.name || security.code
            }
          ]
        : [];
    });
}

function trendOption(code: string): ReturnType<typeof trendOptions>[number] | undefined {
  return trendOptions().find((item) => item.code === code);
}

async function loadTrendChart(force = false): Promise<void> {
  const option = trendOption(selectedTrendCode) ?? trendOptions()[0];
  if (!option) {
    renderTrendPanel(undefined, "暂无可用项目");
    return;
  }
  selectedTrendCode = option.code;
  const cached = trendCache.get(option.code);
  if (cached && !force) {
    renderTrendPanel(cached);
    updateStatusSummary();
    return;
  }
  const generation = ++trendRequestGeneration;
  renderTrendPanel(cached, "正在读取趋势数据…");
  try {
    const detail = await window.floatingStock?.getMarketDetail({
      kind: "stock",
      market: option.market,
      code: option.code
    });
    if (!detail || generation !== trendRequestGeneration || activeSheet()?.id !== "trend") return;
    trendCache.set(option.code, detail);
    renderTrendPanel(detail);
    statusText.textContent = `趋势数据 ${formatStatusTime(detail.fetchedAt)}`;
    updateStatusSummary();
  } catch {
    if (generation === trendRequestGeneration) renderTrendPanel(cached, "趋势数据暂时不可用");
  }
}

function renderTrendPanel(detail?: MarketDetail, message = ""): void {
  const options = trendOptions();
  const optionHtml = options
    .map(
      (item) =>
        `<option value="${escapeHtml(item.code)}" ${item.code === selectedTrendCode ? "selected" : ""}>${escapeHtml(item.name)}　${escapeHtml(item.code)}</option>`
    )
    .join("");
  const model = detail ? buildExcelBollChart(detail.daily.items) : null;
  trendPanel.innerHTML = `
    <div class="trend-toolbar">
      <div><strong>项目趋势分析</strong><span>最近 ${model?.count ?? 60} 个交易日</span></div>
      <label>项目 <select id="trend-security">${optionHtml}</select></label>
      <button data-command="trend-refresh">刷新数据</button>
    </div>
    ${message ? `<div class="trend-message">${escapeHtml(message)}</div>` : ""}
    ${model ? renderTrendSvg(model) : ""}
  `;
}

function renderTrendSvg(model: NonNullable<ReturnType<typeof buildExcelBollChart>>): string {
  const gridLines = [0.25, 0.5, 0.75]
    .map((ratio) => {
      const y = 24 + ratio * (model.height - 62);
      return `<line x1="54" x2="${model.width - 18}" y1="${y}" y2="${y}" />`;
    })
    .join("");
  return `<div class="trend-chart-card">
    <div class="trend-legend"><span class="close-key">收盘</span><span class="upper-key">上轨</span><span class="mid-key">中轨</span><span class="lower-key">下轨</span></div>
    <svg class="trend-chart" viewBox="0 0 ${model.width} ${model.height}" role="img" aria-label="项目布林线趋势图">
      <g class="trend-grid">${gridLines}</g>
      <polyline class="trend-close" points="${model.close}" />
      <polyline class="trend-upper" points="${model.upper}" />
      <polyline class="trend-mid" points="${model.mid}" />
      <polyline class="trend-lower" points="${model.lower}" />
      <text x="4" y="30">${formatChartNumber(model.max)}</text>
      <text x="4" y="${model.height - 38}">${formatChartNumber(model.min)}</text>
      <text x="54" y="${model.height - 12}">${escapeHtml(model.startDate)}</text>
      <text class="end-label" x="${model.width - 18}" y="${model.height - 12}">${escapeHtml(model.endDate)}</text>
    </svg>
    <div class="trend-stats"><span>最新值 <b>${formatChartNumber(model.latest.close)}</b></span><span>中轨 <b>${formatChartNumber(model.latest.bollMid)}</b></span><span>区间 <b>${formatChartNumber(model.latest.low)} – ${formatChartNumber(model.latest.high)}</b></span></div>
  </div>`;
}

function formatChartNumber(value: number | null): string {
  return formatFixedOrDash(value, 2);
}

function selectedCell(): HTMLTableCellElement | null {
  return grid.querySelector<HTMLTableCellElement>("td.selected");
}

function setZoom(value: number): void {
  zoom = Math.min(125, Math.max(75, Math.round(value)));
  zoomRange.value = String(zoom);
  zoomLabel.textContent = `${zoom}%`;
  grid.style.zoom = String(zoom / 100);
}

function ribbonTab(id: RibbonTab, label: string, active = false): string {
  return `<button class="${active ? "active" : ""}" data-ribbon="${id}">${label}</button>`;
}

function group(label: string, content: string): string {
  return `<div class="ribbon-group"><div class="ribbon-group-content">${content}</div><div class="ribbon-group-label">${label}</div></div>`;
}

function largeButton(icon: string, label: string): string {
  return `<button class="ribbon-large"><span>${icon}</span><small>${label}</small></button>`;
}

function commandButton(icon: string, label: string, command = ""): string {
  return `<button class="ribbon-command" ${command ? `data-command="${command}"` : ""}><b>${icon}</b><small>${label}</small></button>`;
}

function smallStack(labels: string[]): string {
  return `<div class="ribbon-stack">${labels.map((label) => `<button>${label}</button>`).join("")}</div>`;
}

function fontPanel(): string {
  return `<div class="font-panel"><div><select aria-label="字体"><option>等线</option></select><select aria-label="字号"><option>11</option></select></div><div>${commandButton("B", "", "bold")}${commandButton("I", "")}${commandButton("U", "")}${commandButton("A", "", "fill")}</div></div>`;
}

function numberPanel(): string {
  return `<div class="number-panel"><select><option>常规</option></select><div><button>￥</button><button>%</button><button>,</button><button>.0←</button><button>.00→</button></div></div>`;
}

function required<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = rootElement.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

function columnName(index: number): string {
  let result = "";
  let value = index;
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function columnNumber(name: string): number {
  return [...name].reduce((value, character) => value * 26 + character.charCodeAt(0) - 64, 0);
}
