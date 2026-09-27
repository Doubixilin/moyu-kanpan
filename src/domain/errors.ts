/**
 * 错误文案与错误列表去重。
 *
 * 从 `electron/main.ts` 抽出（审计报告 §6-4）；`errorMessage` 同时取代了
 * `src/settings/controllers/ports.ts` 里那份同语义的 `describeError`（§4-7 的重复实现）。
 */

/** 把任意异常转成可以直接展示给用户的一句话。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 追加错误：按 `scope:` 前缀去重（同一来源只保留最新一条），最多 4 条。
 *
 * 行为与 `main.ts` 原实现逐字一致——注意它按**前缀**去重而不是按整串，
 * 所以 `settings:xxx` 与 `ai:yyy` 属于不同来源、可以并存。
 */
export function upsertError(errors: string[], next: string): string[] {
  const prefix = next.split(":")[0];
  return [next, ...errors.filter((error) => !error.startsWith(`${prefix}:`))].slice(0, 4);
}
