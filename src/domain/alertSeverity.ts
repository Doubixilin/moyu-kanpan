import type { AlertEvent, AlertRuleType } from "./types.js";

/**
 * 提醒事件的严重度排序。
 *
 * 同一批事件的 `triggeredAt` 完全相同，`events.at(-1)` 取到的只是候选生成顺序里的最后一个，
 * 并不是最严重的（审计报告 §9 S-3）。这里把权重表与挑选逻辑从 `electron/main.ts` 拿出来，
 * 于是可以单测（§6-4）。
 */
export const ALERT_SEVERITY: Record<AlertRuleType, number> = {
  stop_loss: 100,
  price_below: 90,
  fall_percent: 85,
  total_loss: 80,
  daily_loss: 75,
  portfolio_daily_loss: 70,
  group_loss: 65,
  near_stop: 60,
  exposure: 55,
  position_value: 50,
  holding_count: 45,
  price_above: 40,
  rise_percent: 35,
  watch_price: 30,
  daily_profit: 20,
  total_profit: 15,
  portfolio_daily_profit: 10,
  group_profit: 5
};

/** 最严重的那条；并列时保留先生成的（严格大于才替换）。 */
export function mostSevereAlert(events: AlertEvent[]): AlertEvent | undefined {
  let best: AlertEvent | undefined;
  for (const event of events) {
    if (!best || (ALERT_SEVERITY[event.type] ?? 0) > (ALERT_SEVERITY[best.type] ?? 0)) best = event;
  }
  return best;
}
