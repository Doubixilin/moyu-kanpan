/**
 * IPC 载荷校验：`settings:save` 此前没有任何体积上限（配置导入包有 2 MB 上限），
 * 恶意/异常渲染器可以一次写入超大 settings.json（审计报告 §8 Info-8）。
 *
 * 放在这里而不是 `main.ts`：`main.ts` 需要 Electron 运行时，无法直接单测。
 */

/** 与配置导入包一致的 2 MB 上限。 */
export const MAX_SETTINGS_PAYLOAD_BYTES = 2_000_000;

/** 载荷过大或根本无法序列化时返回 true（两者都应拒绝）。 */
export function isOversizedSettingsPayload(value: unknown): boolean {
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return true;
    return json.length > MAX_SETTINGS_PAYLOAD_BYTES;
  } catch {
    // 循环引用、BigInt 等：不是合法设置载荷。
    return true;
  }
}
