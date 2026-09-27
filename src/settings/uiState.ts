/**
 * 整页重渲染时的界面状态保留（审计报告 §4-6）。
 *
 * `settingsRenderer.ts` 用 `rootElement.innerHTML = …` 整页重建，副作用是：
 * 正在编辑的输入框失焦、光标回到开头、展开的 `<details>` 面板自己收起、
 * 滚动位置被重置。这三件事都会让"点一下按钮看看效果"变成"从头再来一遍"。
 *
 * 这里只做一件事：重建前后把**界面状态**（哪些 details 开着、焦点在哪个控件、
 * 光标在哪、滚到哪）搬过去。元素用 `data-setting` / `data-action` / 行索引拼成
 * 稳定 key 定位，因此不依赖 DOM 顺序。
 *
 * 本模块只依赖 DOM，浏览器安全；改动后别忘记它要在
 * `scripts/build-renderer.mjs` 的编译清单里。
 */
export interface FocusedControl {
  /** `uiKey()` 生成的稳定标识。 */
  key: string;
  /** 光标/选区；不支持选区的控件（number/checkbox 等）为 null。 */
  start: number | null;
  end: number | null;
}

export interface RenderUiState {
  /** 重建前处于展开状态的 details key。 */
  details: string[];
  focus: FocusedControl | null;
  scrollY: number;
}

export const EMPTY_UI_STATE: RenderUiState = { details: [], focus: null, scrollY: 0 };

/** 行级容器属性，用于把同一个 `data-setting` 的不同行区分开。 */
const ROW_ATTRIBUTES = ["holdingIndex", "tabIndex", "riskGroupIndex", "index"] as const;
/** 可以作为状态锚点的元素。 */
const KEYABLE_SELECTOR = "[data-setting],[data-action],details";

function rowContext(element: Element): string {
  const row = element.closest<HTMLElement>(
    "[data-holding-index],[data-tab-index],[data-risk-group-index],[data-index]"
  );
  if (!row) return "";
  for (const attribute of ROW_ATTRIBUTES) {
    const value = row.dataset[attribute];
    if (value != null) return `${attribute}=${value}`;
  }
  return "";
}

/**
 * 元素的稳定标识；返回空串表示它不适合做锚点（例如纯布局节点）。
 *
 * 注意 `details` 用 class 作区分，因此同一个面板在不同行里仍能靠行上下文区分开。
 */
export function uiKey(element: Element | null): string {
  if (!element) return "";
  const local =
    element.getAttribute("data-setting") != null
      ? `setting=${element.getAttribute("data-setting")}`
      : element.getAttribute("data-action") != null
        ? `action=${element.getAttribute("data-action")}`
        : element instanceof HTMLDetailsElement
          ? `details=${element.className}`
          : "";
  if (!local) return "";
  return `${rowContext(element)}|${local}`;
}

/** 支持 `setSelectionRange` 的输入类型（number/checkbox 等调用会抛 InvalidStateError）。 */
function supportsSelection(element: Element): element is HTMLInputElement | HTMLTextAreaElement {
  if (element instanceof HTMLTextAreaElement) return true;
  if (!(element instanceof HTMLInputElement)) return false;
  return ["text", "search", "url", "tel", "password", "email"].includes(element.type);
}

/** 重建前抓取界面状态。 */
export function captureUiState(root: HTMLElement | null): RenderUiState {
  if (!root) return EMPTY_UI_STATE;
  // 用 Array.from 而不是展开运算符：本文件同时被 tsconfig.electron.json 编译，
  // 那个工程的 lib 里没有 DOM.Iterable，NodeList 直接展开会报 TS2488。
  const details = Array.from(root.querySelectorAll("details[open]"))
    .map((element) => uiKey(element))
    .filter((key) => key.length > 0);

  const active = document.activeElement;
  let focus: FocusedControl | null = null;
  if (active && root.contains(active)) {
    const key = uiKey(active);
    if (key) {
      focus = {
        key,
        start: supportsSelection(active) ? active.selectionStart : null,
        end: supportsSelection(active) ? active.selectionEnd : null
      };
    }
  }
  return { details, focus, scrollY: window.scrollY };
}

/** 重建后把界面状态放回去；找不到锚点就安静跳过（元素可能已被操作删除）。 */
export function restoreUiState(root: HTMLElement | null, state: RenderUiState): void {
  if (!root || state === EMPTY_UI_STATE) return;
  const anchor = new Map<string, Element>();
  // 同上：不用 for…of 直接遍历 NodeList。
  for (const element of Array.from(root.querySelectorAll(KEYABLE_SELECTOR))) {
    const key = uiKey(element);
    if (key && !anchor.has(key)) anchor.set(key, element);
  }

  for (const key of state.details) {
    const element = anchor.get(key);
    if (element instanceof HTMLDetailsElement) element.open = true;
  }

  if (state.focus) {
    const element = anchor.get(state.focus.key);
    if (element instanceof HTMLElement) {
      // preventScroll：稍后统一恢复滚动位置，避免 focus() 先把页面拽走。
      element.focus({ preventScroll: true });
      if (state.focus.start != null && supportsSelection(element)) {
        element.setSelectionRange(state.focus.start, state.focus.end ?? state.focus.start);
      }
    }
  }

  if (state.scrollY > 0) window.scrollTo({ top: state.scrollY });
}
