import { parseBossKeyAccelerator } from "../../shortcut.js";

/**
 * 老板键录制：把一次键盘事件解释成"取消 / 只是修饰键 / 不支持 / 接受"。
 *
 * 原先这套映射（F1–F24 正则、40 项 `code` → Electron accelerator 对照表）直接写在
 * `settingsRenderer.ts` 里、依赖真实 `KeyboardEvent`，因此从没被测试过；这里改成
 * 只要求事件的结构形状（`KeyEventLike`），于是可以脱离 DOM 单测。
 */

/** 控制器真正需要的事件字段；`KeyboardEvent` 结构上兼容。 */
export interface KeyEventLike {
  code: string;
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/** 单独的修饰键不能作为老板键（等待后续按键）。 */
const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight"
]);

/** 展示用：把 Electron 的修饰键名换成人能读的名字。 */
export function displayBossKey(accelerator: string): string {
  return accelerator.replace("CommandOrControl", "Ctrl").replace("Super", "Win");
}

/** 非字母数字键的 `code` → accelerator 片段。 */
const NAMED_KEYS: Record<string, string> = {
  Space: "Space",
  Tab: "Tab",
  CapsLock: "Capslock",
  NumLock: "Numlock",
  ScrollLock: "Scrolllock",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Enter: "Enter",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  PrintScreen: "PrintScreen",
  NumpadDecimal: "numdec",
  NumpadAdd: "numadd",
  NumpadSubtract: "numsub",
  NumpadMultiply: "nummult",
  NumpadDivide: "numdiv",
  Backquote: String.fromCharCode(96),
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: '"',
  Comma: ",",
  Period: ".",
  Slash: "/",
  AudioVolumeUp: "VolumeUp",
  AudioVolumeDown: "VolumeDown",
  AudioVolumeMute: "VolumeMute",
  MediaTrackNext: "MediaNextTrack",
  MediaTrackPrevious: "MediaPreviousTrack",
  MediaStop: "MediaStop",
  MediaPlayPause: "MediaPlayPause"
};

/** 单个按键 → accelerator 片段；空串表示不认识这个键。 */
export function keyFromKeyboardEvent(event: KeyEventLike): string {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  if (/^F(?:[1-9]|1\d|2[0-4])$/.test(event.code)) return event.code;
  if (/^Numpad[0-9]$/.test(event.code)) return "num" + event.code.slice(6);
  return NAMED_KEYS[event.code] ?? "";
}

/** 组合键 → 已校验的 accelerator；`null` 表示不支持或属于危险组合。 */
export function acceleratorFromKeyboardEvent(event: KeyEventLike): string | null {
  const key = keyFromKeyboardEvent(event);
  if (!key) return null;

  const parts: string[] = [];
  if (event.ctrlKey) parts.push("CommandOrControl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Super");
  parts.push(key);
  // 统一交给主进程/共享的解析器判定危险组合（F11、系统保留键等）。
  return parseBossKeyAccelerator(parts.join("+"));
}

export type BossKeyCaptureOutcome =
  | { kind: "cancel"; message: string }
  | { kind: "modifier" }
  | { kind: "unsupported"; message: string }
  | { kind: "accepted"; accelerator: string; message: string };

/** 录制中的一次按键 → 该做什么（`recording` / `repeat` 由调用方先行判断）。 */
export function bossKeyCaptureOutcome(event: KeyEventLike): BossKeyCaptureOutcome {
  if (event.key === "Escape") return { kind: "cancel", message: "已取消老板键录制" };
  if (MODIFIER_CODES.has(event.code)) return { kind: "modifier" };

  const accelerator = acceleratorFromKeyboardEvent(event);
  if (!accelerator) {
    return { kind: "unsupported", message: "该按键不受支持或属于危险组合，请换一个" };
  }
  return {
    kind: "accepted",
    accelerator,
    message: `已记录 ${displayBossKey(accelerator)}，保存后生效`
  };
}
