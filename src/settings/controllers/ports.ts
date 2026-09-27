/**
 * 控制器与宿主（`settingsRenderer.ts`）之间的端口。
 *
 * 控制器只通过这几个方法接触外界：不直接读 DOM、不读模块级变量、不碰 `window`。
 * 好处是可以用假实现单测（原本这些逻辑藏在 1200 行的渲染器里、零测试，
 * 见审计报告 §4-5 第二步与 §4-8）。
 *
 * 约定：`notify` 会重渲染（等价于原来的 `showMessage`）；`clearMessage` 只清空提示，
 * 调用方随后自行 `render()`——这与原实现的调用顺序一致。
 */
export interface SettingsShellPorts {
  /** 整页重渲染。 */
  render(): void;
  /** 设置提示文本并重渲染，通知用户刚才那次操作的结果。 */
  notify(message: string, kind: "ok" | "error"): void;
  /** 只清空提示，不重渲染。 */
  clearMessage(): void;
}

/**
 * 异常 → 可展示文案。
 *
 * 实现在 `domain/errors.ts`（`main.ts` 也用它），这里保留旧名以免改动所有调用点，
 * 同时消掉审计报告 §4-7 记的"同名同语义多份实现"。
 */
export { errorMessage as describeError } from "../../domain/errors.js";
