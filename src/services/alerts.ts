import { readFile } from "node:fs/promises";
import type { AlertEvent } from "../domain/types.js";
import type { AlertCandidate } from "../domain/risk.js";
import { shanghaiDateKey } from "../domain/marketClock.js";
import { atomicWriteText } from "./atomicFile.js";

export interface AlertRuleState {
  lastValue: number;
  threshold: number;
  direction: "above" | "below";
  armed: boolean;
  evaluable: boolean;
  lastTriggeredAt: string | null;
  lastTriggeredDate: string | null;
  /** 上次评估时的提醒模式；缺省表示旧版本持久化状态，首次评估会 rebase 一次。 */
  mode?: "shadow" | "active";
  /** 该规则上次缺席（候选中不再出现）的时间；用于清理长期不再使用的条目。 */
  absentSince?: string;
}

export interface AlertEngineState {
  version: 1;
  pausedThroughDate: string | null;
  rules: Record<string, AlertRuleState>;
  recentEvents: AlertEvent[];
}

/**
 * 缺席规则在状态表里的保留时长。
 * 必须大于 cooldownMinutes 的上限（1440 分钟）与 oncePerDay 的窗口，
 * 否则重新启用时会丢掉冷却/当日一次状态，从而重复提醒。
 */
const RULE_RETENTION_MS = 7 * 24 * 60 * 60_000;

export interface AlertEvaluationContext {
  now: Date;
  mode: "shadow" | "active";
  cooldownMinutes: number;
  oncePerDay: boolean;
  onlyDuringTrading: boolean;
  tradingSession: boolean;
}

export interface AlertEvaluationResult {
  events: AlertEvent[];
  paused: boolean;
  stateChanged: boolean;
}

export interface AlertStateStore {
  read: () => Promise<AlertEngineState | null>;
  write: (state: AlertEngineState) => Promise<void>;
}

export class JsonAlertStateStore implements AlertStateStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async read(): Promise<AlertEngineState | null> {
    try {
      const value = JSON.parse(await readFile(this.filePath, "utf8")) as unknown;
      return isAlertEngineState(value) ? value : null;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return null;
      return null;
    }
  }

  async write(state: AlertEngineState): Promise<void> {
    const snapshot = structuredClone(state);
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(async () => {
        await atomicWriteText(this.filePath, JSON.stringify(snapshot));
      });
    await this.writeQueue;
  }
}

export class AlertEngine {
  private state: AlertEngineState;

  constructor(initialState?: AlertEngineState | null) {
    this.state = initialState ? normalizeState(initialState) : emptyAlertEngineState();
  }

  evaluate(candidates: AlertCandidate[], context: AlertEvaluationContext): AlertEvaluationResult {
    const nowMs = context.now.getTime();
    const date = shanghaiDate(context.now);
    let stateChanged = false;
    if (
      this.state.pausedThroughDate &&
      this.state.pausedThroughDate !== date &&
      context.tradingSession
    ) {
      this.state.pausedThroughDate = null;
      stateChanged = true;
    }
    const paused = this.state.pausedThroughDate != null;
    const events: AlertEvent[] = [];
    const activeRuleIds = new Set(candidates.map((candidate) => candidate.ruleId));

    for (const [ruleId, rule] of Object.entries(this.state.rules)) {
      if (activeRuleIds.has(ruleId)) {
        if (rule.absentSince !== undefined) {
          delete rule.absentSince;
          stateChanged = true;
        }
        continue;
      }
      if (rule.evaluable) {
        rule.evaluable = false;
        rule.absentSince = context.now.toISOString();
        stateChanged = true;
        continue;
      }
      const absentSince =
        rule.absentSince === undefined ? Number.NaN : Date.parse(rule.absentSince);
      if (!Number.isFinite(absentSince)) {
        // 旧版本落盘的状态没有 absentSince：从现在开始计时。
        rule.absentSince = context.now.toISOString();
        stateChanged = true;
      } else if (nowMs - absentSince > RULE_RETENTION_MS) {
        delete this.state.rules[ruleId];
        stateChanged = true;
      }
    }

    for (const candidate of candidates) {
      const canEvaluate =
        candidate.safe && !paused && (!context.onlyDuringTrading || context.tradingSession);
      let rule = this.state.rules[candidate.ruleId];
      if (!rule) {
        rule = {
          lastValue: candidate.value,
          threshold: candidate.threshold,
          direction: candidate.direction,
          armed: true,
          evaluable: canEvaluate,
          lastTriggeredAt: null,
          lastTriggeredDate: null,
          mode: context.mode
        };
        this.state.rules[candidate.ruleId] = rule;
        stateChanged = true;
        continue;
      }

      if (rule.threshold !== candidate.threshold || rule.direction !== candidate.direction) {
        rule.lastValue = candidate.value;
        rule.threshold = candidate.threshold;
        rule.direction = candidate.direction;
        rule.armed = true;
        rule.evaluable = canEvaluate;
        rule.mode = context.mode;
        stateChanged = true;
        continue;
      }
      // 模式切换（影子 → 正式，或反向）必须 rebase：否则影子模式触发时消耗掉的 armed
      // 会让"切到正式模式后正处在越线状态"的规则永久静默，直到价格回抽再重新穿越。
      // 与既有语义一致：只 rebase，不补发停用期间的旧穿越。
      if (rule.mode !== context.mode) {
        rule.mode = context.mode;
        rule.lastValue = candidate.value;
        rule.armed = true;
        rule.evaluable = canEvaluate;
        stateChanged = true;
        continue;
      }
      if (!canEvaluate) {
        if (rule.evaluable) {
          rule.evaluable = false;
          stateChanged = true;
        }
        continue;
      }
      if (!rule.evaluable) {
        rule.lastValue = candidate.value;
        rule.evaluable = true;
        stateChanged = true;
        continue;
      }

      if (!rule.armed && retreated(candidate)) {
        rule.armed = true;
        stateChanged = true;
      }
      // 上一笔用非严格比较：A 股最小变动价位 0.01，用户常设整数阈值，
      // 若上一笔恰好等于阈值（lastValue === threshold），严格 `<` 会漏掉这次真实穿越。
      const crossed =
        candidate.direction === "above"
          ? rule.lastValue <= candidate.threshold && candidate.value >= candidate.threshold
          : rule.lastValue >= candidate.threshold && candidate.value <= candidate.threshold;
      const cooldownMs = Math.max(0, context.cooldownMinutes) * 60_000;
      const outsideCooldown =
        !rule.lastTriggeredAt || nowMs - Date.parse(rule.lastTriggeredAt) >= cooldownMs;
      const dailyAllowed = !context.oncePerDay || rule.lastTriggeredDate !== date;

      if (rule.armed && crossed && outsideCooldown && dailyAllowed) {
        const event = toEvent(candidate, context.mode, context.now);
        events.push(event);
        rule.armed = false;
        rule.lastTriggeredAt = event.triggeredAt;
        rule.lastTriggeredDate = date;
        stateChanged = true;
      }
      if (rule.lastValue !== candidate.value) {
        rule.lastValue = candidate.value;
        stateChanged = true;
      }
    }

    if (events.length > 0) {
      this.state.recentEvents = [...events.reverse(), ...this.state.recentEvents].slice(0, 50);
      events.reverse();
      stateChanged = true;
    }
    return { events, paused, stateChanged };
  }

  pauseForToday(now = new Date()): void {
    this.state.pausedThroughDate = shanghaiDate(now);
    for (const rule of Object.values(this.state.rules)) rule.evaluable = false;
  }

  resume(): void {
    this.state.pausedThroughDate = null;
    for (const rule of Object.values(this.state.rules)) rule.evaluable = false;
  }

  /**
   * 是否处于"今日暂停"状态。
   *
   * 暂停的解除发生在 `evaluate()` 里（进入下一个交易时段时清空 `pausedThroughDate`），
   * 因此这里不带 `now` 参数——此前签名上有个被 `void` 掉的 `now`，暗示存在按日过期的判断，
   * 实际上并没有。跨日重启后要等首次 `evaluate()` 才会刷新该状态。
   */
  isPaused(): boolean {
    return this.state.pausedThroughDate != null;
  }

  recentEvents(): AlertEvent[] {
    return structuredClone(this.state.recentEvents);
  }

  exportState(): AlertEngineState {
    return structuredClone(this.state);
  }
}

export function emptyAlertEngineState(): AlertEngineState {
  return { version: 1, pausedThroughDate: null, rules: {}, recentEvents: [] };
}

function retreated(candidate: AlertCandidate): boolean {
  return candidate.direction === "above"
    ? candidate.value <= candidate.threshold - candidate.hysteresis
    : candidate.value >= candidate.threshold + candidate.hysteresis;
}

function toEvent(candidate: AlertCandidate, mode: "shadow" | "active", now: Date): AlertEvent {
  const triggeredAt = now.toISOString();
  return {
    id: `${triggeredAt}:${candidate.ruleId}`,
    ruleId: candidate.ruleId,
    type: candidate.type,
    title: candidate.title,
    message: candidate.message,
    ...(candidate.securityCode ? { securityCode: candidate.securityCode } : {}),
    ...(candidate.groupId ? { groupId: candidate.groupId } : {}),
    value: candidate.value,
    threshold: candidate.threshold,
    triggeredAt,
    mode
  };
}

function shanghaiDate(value: Date): string {
  // 复用 marketClock 的上海时钟，避免第三份时区实现漂移。
  return shanghaiDateKey(value);
}

function normalizeState(value: AlertEngineState): AlertEngineState {
  return {
    version: 1,
    pausedThroughDate: typeof value.pausedThroughDate === "string" ? value.pausedThroughDate : null,
    rules: value.rules && typeof value.rules === "object" ? structuredClone(value.rules) : {},
    recentEvents: Array.isArray(value.recentEvents)
      ? structuredClone(value.recentEvents).slice(0, 50)
      : []
  };
}

function isAlertEngineState(value: unknown): value is AlertEngineState {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    Boolean(record.rules) &&
    typeof record.rules === "object" &&
    Array.isArray(record.recentEvents)
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
