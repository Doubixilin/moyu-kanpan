import type {
  HoldingAlertRules,
  NewsMode,
  QuoteField,
  QuoteSort,
  RefreshMode,
  ThemeMode,
  UserSettings
} from "../config.js";

/**
 * 设置表单字段的声明式定义。
 *
 * 这里只做"把控件的值写进 settings"这一件事：不碰 DOM、不碰模块级状态，因此可以直接
 * 用普通对象做单元测试（设置界面此前完全没有测试覆盖——见审计报告 §6-4）。
 * 副作用（整页重渲染、错误提示、重置老板键录制、更新不透明度标签）通过返回值交给渲染层。
 *
 * 拆出这张表的原因见审计报告 §4-5：原来是一个 190 行、40 多个 `if (setting === "…")`
 * 分支的派发函数，字段散落在其中，既难查也难测。
 */

/** 结构性控件类型：真实 DOM 元素天然满足，测试里用普通对象即可。 */
export interface FieldElement {
  value: string;
  checked?: boolean;
  dataset?: { [key: string]: string | undefined };
}

/** 一次字段变更的上下文。`eventType` 用于保持"只在 change 时重渲染"的原行为。 */
export interface FieldContext {
  element: FieldElement;
  eventType: string;
}

export interface FieldMessage {
  text: string;
  kind: "ok" | "error";
}

export interface FieldUpdateResult {
  /** 是否需要在本次输入后整页重渲染 */
  rerender?: boolean;
  message?: FieldMessage;
  /** 需要重置老板键录制状态（关闭老板键时） */
  resetBossKeyRecording?: boolean;
  /** 需要同步更新的不透明度标签（原样回显输入值 + "%"） */
  opacityLabel?: string;
}

export type FieldUpdater = (settings: UserSettings, context: FieldContext) => FieldUpdateResult;
export type RowUpdater = (settings: UserSettings, index: number, element: FieldElement) => void;

/** 空输入 → null；只接受有限正数（与保存路径的规范化口径一致）。 */
export function nullableInputNumber(value: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function nullableInputInteger(value: string): number | null {
  const number = nullableInputNumber(value);
  return number == null ? null : Math.max(1, Math.round(number));
}

type HoldingAlertNumberField = Exclude<keyof HoldingAlertRules, "enabled">;

/** `data-setting` → 持仓提醒的数值字段。 */
export const HOLDING_ALERT_NUMBER_FIELDS: Record<string, HoldingAlertNumberField> = {
  "holding-stop-loss": "stopLossPrice",
  "holding-watch-price": "watchPrice",
  "holding-price-above": "priceAbove",
  "holding-price-below": "priceBelow",
  "holding-rise-percent": "risePercent",
  "holding-fall-percent": "fallPercent",
  "holding-daily-profit": "dailyProfitAmount",
  "holding-daily-loss": "dailyLossAmount",
  "holding-total-profit": "totalProfitAmount",
  "holding-total-loss": "totalLossAmount"
};

/** 自选行的字段。 */
export const WATCH_ROW_FIELDS: Record<string, RowUpdater> = {
  visible: (settings, index, element) => {
    settings.watchlist[index]!.visible = element.checked === true;
  },
  alias: (settings, index, element) => {
    const item = settings.watchlist[index]!;
    const security = settings.securities.find((entry) => entry.code === item.securityCode);
    if (security) security.alias = element.value.trimStart().slice(0, 16);
  }
};

/** 持仓行的字段。 */
export const HOLDING_ROW_FIELDS: Record<string, RowUpdater> = {
  "holding-quantity": (settings, index, element) => {
    settings.holdings[index]!.quantity = Math.max(1, Math.round(Number(element.value) || 1));
  },
  "holding-cost": (settings, index, element) => {
    settings.holdings[index]!.costPrice = Math.max(0.0001, Number(element.value) || 0.0001);
  },
  "holding-group": (settings, index, element) => {
    settings.holdings[index]!.groupId = element.value || "all";
  },
  "holding-note": (settings, index, element) => {
    settings.holdings[index]!.note = element.value.slice(0, 120);
  },
  "holding-alert-enabled": (settings, index, element) => {
    settings.holdings[index]!.alertRules.enabled = element.checked === true;
  }
};

/** 风险组行的字段。 */
export const RISK_GROUP_ROW_FIELDS: Record<string, RowUpdater> = {
  "risk-group-enabled": (settings, index, element) => {
    settings.risk.groups[index]!.enabled = element.checked === true;
  },
  "risk-group-name": (settings, index, element) => {
    settings.risk.groups[index]!.name = element.value.trimStart().slice(0, 16);
  },
  "risk-group-profit": (settings, index, element) => {
    settings.risk.groups[index]!.profitThreshold = nullableInputNumber(element.value);
  },
  "risk-group-loss": (settings, index, element) => {
    settings.risk.groups[index]!.lossThreshold = nullableInputNumber(element.value);
  }
};

/** 页面（tab）行内的字段。 */
export const TAB_ROW_FIELDS: Record<string, RowUpdater> = {
  "tab-visible": (settings, index, element) => {
    settings.tabs[index]!.visible = element.checked === true;
  },
  "tab-title": (settings, index, element) => {
    const tab = settings.tabs[index]!;
    if (!tab.builtIn) tab.title = element.value.trimStart().slice(0, 12);
  }
};

const bool =
  (apply: (settings: UserSettings, value: boolean) => void): FieldUpdater =>
  (settings, { element }) => {
    apply(settings, element.checked === true);
    return {};
  };

const number =
  (apply: (settings: UserSettings, value: number | null) => void): FieldUpdater =>
  (settings, { element }) => {
    apply(settings, nullableInputNumber(element.value));
    return {};
  };

/** `Math.min(max, Math.max(min, raw))`，`raw` 为 0/NaN 时用 fallback；可选取整。 */
const clamped =
  (
    min: number,
    max: number,
    fallback: number,
    round: boolean,
    apply: (settings: UserSettings, value: number) => void
  ): FieldUpdater =>
  (settings, { element }) => {
    const raw = Number(element.value) || fallback;
    const bounded = Math.min(max, Math.max(min, raw));
    apply(settings, round ? Math.round(bounded) : bounded);
    return {};
  };

/** 左侧去空白并截断（用于文本输入）。 */
const trimmed =
  (max: number, apply: (settings: UserSettings, value: string) => void): FieldUpdater =>
  (settings, { element }) => {
    apply(settings, element.value.trimStart().slice(0, max));
    return {};
  };

/** 只在 `change` 事件上重渲染（输入过程中不要打断焦点）。 */
const rerenderOnChange = (eventType: string): boolean => eventType === "change";

/**
 * 顶层字段：`data-setting` → 一个只写 settings 的更新函数。
 * 需要整页重渲染、提示或重置其它状态时，在返回值里说明。
 */
export const SETTINGS_FIELD_UPDATERS: Record<string, FieldUpdater> = {
  "tab-security": (settings, { element }) => {
    const tab = settings.tabs.find((item) => item.id === element.dataset?.tabId);
    if (!tab) return {};
    const code = element.value;
    if (element.checked === true) {
      if (!tab.securityCodes.includes(code)) tab.securityCodes.push(code);
    } else {
      tab.securityCodes = tab.securityCodes.filter((entry) => entry !== code);
    }
    return {};
  },
  // 不做 trim/截断：与原实现一致（下拉框给的是已知 id）。
  "default-tab": (settings, { element }) => {
    settings.navigation.defaultTabId = element.value;
    return {};
  },
  "remember-tab": bool((settings, value) => {
    settings.navigation.rememberLastTab = value;
  }),
  "always-on-top": bool((settings, value) => {
    settings.window.alwaysOnTop = value;
  }),
  "tray-only": bool((settings, value) => {
    settings.window.trayOnly = value;
  }),
  "click-through": bool((settings, value) => {
    settings.window.clickThrough = value;
  }),
  "window-locked": bool((settings, value) => {
    settings.window.locked = value;
  }),
  // 关闭老板键时结束录制状态；只在 change 上重渲染以更新按钮文案。
  "boss-key-enabled": (settings, { element, eventType }) => {
    settings.window.bossKeyEnabled = element.checked === true;
    return {
      rerender: rerenderOnChange(eventType),
      resetBossKeyRecording: !settings.window.bossKeyEnabled
    };
  },
  "ai-enabled": bool((settings, value) => {
    settings.ai.enabled = value;
  }),
  // 切换服务商时填入该服务商的默认地址与模型。
  "ai-provider": (settings, { element, eventType }) => {
    settings.ai.provider = element.value === "custom" ? "custom" : "deepseek";
    if (settings.ai.provider === "deepseek") {
      settings.ai.baseUrl = "https://api.deepseek.com";
      settings.ai.model = "deepseek-v4-flash";
    } else {
      settings.ai.baseUrl = "https://api.openai.com/v1";
      settings.ai.model = "gpt-4.1-mini";
    }
    return { rerender: rerenderOnChange(eventType) };
  },
  "ai-base-url": trimmed(300, (settings, value) => {
    settings.ai.baseUrl = value;
  }),
  "ai-model": trimmed(100, (settings, value) => {
    settings.ai.model = value;
  }),
  "ai-timeout": clamped(5, 120, 20, true, (settings, value) => {
    settings.ai.timeoutSeconds = value;
  }),
  field: (settings, { element }) => {
    const quoteField = element.value as QuoteField;
    if (element.checked === true) {
      if (settings.quotes.fields.includes(quoteField)) return {};
      if (settings.quotes.fields.length >= 5) {
        // 纯函数不直接改 DOM：由渲染层取消勾选并提示。
        return { message: { text: "行情字段最多选择 5 项", kind: "error" } };
      }
      settings.quotes.fields.push(quoteField);
      return {};
    }
    settings.quotes.fields = settings.quotes.fields.filter((entry) => entry !== quoteField);
    return {};
  },
  "risk-mode": (settings, { element, eventType }) => {
    settings.risk.mode = element.value === "active" ? "active" : "shadow";
    return { rerender: rerenderOnChange(eventType) };
  },
  "risk-account-baseline": number((settings, value) => {
    settings.risk.accountBaseline = value;
  }),
  "risk-one-r": number((settings, value) => {
    settings.risk.oneR = value;
  }),
  "risk-max-position": number((settings, value) => {
    settings.risk.maxPositionValue = value;
  }),
  "risk-max-count": (settings, { element }) => {
    settings.risk.maxHoldingCount = nullableInputInteger(element.value);
    return {};
  },
  "risk-max-exposure": number((settings, value) => {
    settings.risk.maxTotalExposurePercent = value;
  }),
  "risk-daily-profit": number((settings, value) => {
    settings.risk.portfolioDailyProfitThreshold = value;
  }),
  "risk-daily-loss": number((settings, value) => {
    settings.risk.portfolioDailyLossThreshold = value;
  }),
  "risk-stop-warning": (settings, { element }) => {
    settings.risk.stopWarningPercent = Math.max(0.1, Number(element.value) || 0.1);
    return {};
  },
  "risk-hysteresis": (settings, { element }) => {
    settings.risk.hysteresisPercent = Math.max(0.01, Number(element.value) || 0.01);
    return {};
  },
  "risk-cooldown": (settings, { element }) => {
    settings.risk.cooldownMinutes = Math.max(0, Math.round(Number(element.value) || 0));
    return {};
  },
  "risk-once-per-day": bool((settings, value) => {
    settings.risk.oncePerDay = value;
  }),
  "risk-trading-only": bool((settings, value) => {
    settings.risk.onlyDuringTrading = value;
  }),
  "risk-widget": bool((settings, value) => {
    settings.risk.notifications.widget = value;
  }),
  "risk-tray": bool((settings, value) => {
    settings.risk.notifications.tray = value;
  }),
  "risk-windows": bool((settings, value) => {
    settings.risk.notifications.windows = value;
  }),
  "quote-sort": (settings, { element }) => {
    settings.quotes.sort = element.value as QuoteSort;
    return {};
  },
  "news-mode": (settings, { element }) => {
    settings.news.mode = element.value as NewsMode;
    return {};
  },
  "news-max": (settings, { element }) => {
    settings.news.maxItems = Math.min(30, Math.max(1, Number(element.value) || 1));
    return {};
  },
  theme: (settings, { element }) => {
    settings.appearance.theme = element.value as ThemeMode;
    return {};
  },
  "refresh-mode": (settings, { element }) => {
    settings.refreshPolicy = { mode: element.value as RefreshMode };
    return {};
  },
  "background-opacity": (settings, { element }) => {
    settings.appearance.backgroundOpacity = Number(element.value) / 100;
    // 标签原样回显输入值，保持与原来一致。
    return { opacityLabel: `${element.value}%` };
  }
};
