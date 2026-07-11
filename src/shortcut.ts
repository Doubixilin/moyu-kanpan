export const DEFAULT_BOSS_KEY_ACCELERATOR = "CommandOrControl+Alt+Space";
export const LEGACY_DEFAULT_BOSS_KEY_ACCELERATORS = [
  "CommandOrControl+Alt+S",
  "CommandOrControl+Shift+F11"
] as const;

const NAMED_KEYS: Record<string, string> = {
  plus: "Plus",
  space: "Space",
  tab: "Tab",
  capslock: "Capslock",
  numlock: "Numlock",
  scrolllock: "Scrolllock",
  backspace: "Backspace",
  delete: "Delete",
  insert: "Insert",
  return: "Enter",
  enter: "Enter",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  escape: "Escape",
  esc: "Escape",
  volumeup: "VolumeUp",
  volumedown: "VolumeDown",
  volumemute: "VolumeMute",
  medianexttrack: "MediaNextTrack",
  mediaprevioustrack: "MediaPreviousTrack",
  mediastop: "MediaStop",
  mediaplaypause: "MediaPlayPause",
  printscreen: "PrintScreen"
};

const PUNCTUATION_KEYS = new Set([
  ")", "!", "@", "#", "$", "%", "^", "&", "*", "(", ":", ";", "+", "=",
  "<", ",", "_", "-", ">", ".", "?", "/", "~", "`", "{", "]", "[", "|",
  "\\", "}", "\""
]);

const FORBIDDEN_ACCELERATORS = new Set([
  "Alt+F4",
  "Super+L",
  "Super+D",
  "CommandOrControl+Alt+Delete",
  "CommandOrControl+Shift+Escape"
]);

export function normalizeBossKeyAccelerator(value: unknown): string {
  return parseBossKeyAccelerator(value) ?? DEFAULT_BOSS_KEY_ACCELERATOR;
}

export function parseBossKeyAccelerator(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const tokens = value.split("+").map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0) return null;

  const modifiers = new Set<string>();
  let key = "";
  for (const token of tokens) {
    const normalized = token.toLowerCase();
    if (["ctrl", "control", "commandorcontrol", "cmdorctrl"].includes(normalized)) {
      modifiers.add("CommandOrControl");
    } else if (["alt", "option"].includes(normalized)) {
      modifiers.add("Alt");
    } else if (normalized === "shift") {
      modifiers.add("Shift");
    } else if (["super", "meta", "command", "cmd"].includes(normalized)) {
      modifiers.add("Super");
    } else if (!key) {
      key = normalizeKey(token);
      if (!key) return null;
    } else {
      return null;
    }
  }

  if (!key || key === "F11") return null;
  if (modifiers.size === 0 && !canUseWithoutModifier(key)) return null;

  const ordered = ["CommandOrControl", "Alt", "Shift", "Super"]
    .filter((modifier) => modifiers.has(modifier));
  const accelerator = [...ordered, key].join("+");
  return FORBIDDEN_ACCELERATORS.has(accelerator) ? null : accelerator;
}

function normalizeKey(token: string): string {
  if (/^[a-z0-9]$/i.test(token)) return token.toUpperCase();
  if (/^f(?:[1-9]|1\d|2[0-4])$/i.test(token)) return token.toUpperCase();
  if (/^num[0-9]$/i.test(token)) return token.toLowerCase();
  if (/^num(?:dec|add|sub|mult|div)$/i.test(token)) return token.toLowerCase();
  if (PUNCTUATION_KEYS.has(token)) return token;
  return NAMED_KEYS[token.toLowerCase()] ?? "";
}

function canUseWithoutModifier(key: string): boolean {
  return (/^F(?:[1-9]|1\d|2[0-4])$/.test(key) && key !== "F11") ||
    key.startsWith("Media") ||
    key.startsWith("Volume") ||
    key === "PrintScreen";
}
