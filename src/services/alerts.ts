import { readFile } from "node:fs/promises";
import type { AlertEvent } from "../domain/types.js";
import type { AlertCandidate } from "../domain/risk.js";
import { atomicWriteText } from "./atomicFile.js";

export interface AlertRuleState {
  lastValue: number;
  threshold: number;
  direction: "above" | "below";
  armed: boolean;
  evaluable: boolean;
  lastTriggeredAt: string | null;
  lastTriggeredDate: string | null;
}

export interface AlertEngineState {
  version: 1;
  pausedThroughDate: string | null;
  rules: Record<string, AlertRuleState>;
  recentEvents: AlertEvent[];
}

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
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
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

  evaluate(
    candidates: AlertCandidate[],
    context: AlertEvaluationContext
  ): AlertEvaluationResult {
    const nowMs = context.now.getTime();
    const date = shanghaiDate(context.now);
    let stateChanged = false;
    if (this.state.pausedThroughDate && this.state.pausedThroughDate !== date &&
        context.tradingSession) {
      this.state.pausedThroughDate = null;
      stateChanged = true;
    }
    const paused = this.state.pausedThroughDate != null;
    const events: AlertEvent[] = [];
    const activeRuleIds = new Set(candidates.map((candidate) => candidate.ruleId));

    for (const [ruleId, rule] of Object.entries(this.state.rules)) {
      if (!activeRuleIds.has(ruleId) && rule.evaluable) {
        rule.evaluable = false;
        stateChanged = true;
      }
    }

    for (const candidate of candidates) {
      const canEvaluate = candidate.safe && !paused &&
        (!context.onlyDuringTrading || context.tradingSession);
      let rule = this.state.rules[candidate.ruleId];
      if (!rule) {
        rule = {
          lastValue: candidate.value,
          threshold: candidate.threshold,
          direction: candidate.direction,
          armed: true,
          evaluable: canEvaluate,
          lastTriggeredAt: null,
          lastTriggeredDate: null
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
      const crossed = candidate.direction === "above"
        ? rule.lastValue < candidate.threshold && candidate.value >= candidate.threshold
        : rule.lastValue > candidate.threshold && candidate.value <= candidate.threshold;
      const cooldownMs = Math.max(0, context.cooldownMinutes) * 60_000;
      const outsideCooldown = !rule.lastTriggeredAt ||
        nowMs - Date.parse(rule.lastTriggeredAt) >= cooldownMs;
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

  isPaused(now = new Date()): boolean {
    void now;
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

function toEvent(
  candidate: AlertCandidate,
  mode: "shadow" | "active",
  now: Date
): AlertEvent {
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
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const record = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${record.year}-${record.month}-${record.day}`;
}

function normalizeState(value: AlertEngineState): AlertEngineState {
  return {
    version: 1,
    pausedThroughDate: typeof value.pausedThroughDate === "string"
      ? value.pausedThroughDate
      : null,
    rules: value.rules && typeof value.rules === "object" ? structuredClone(value.rules) : {},
    recentEvents: Array.isArray(value.recentEvents)
      ? structuredClone(value.recentEvents).slice(0, 50)
      : []
  };
}

function isAlertEngineState(value: unknown): value is AlertEngineState {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.version === 1 && Boolean(record.rules) &&
    typeof record.rules === "object" && Array.isArray(record.recentEvents);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
