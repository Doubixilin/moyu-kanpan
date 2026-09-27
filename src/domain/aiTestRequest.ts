import type { AiSettings, AppConfig } from "../config.js";
import { isSecureApiBaseUrl } from "./runtimeSecurity.js";

/**
 * `ai:testConnection` 的 IPC 参数校验。
 *
 * 渲染器传来的 `ai` 是不可信输入（自配端点），这里是唯一入口，因此必须把
 * "端点必须是 https（或本机回环）"、"模型名长度"、"超时范围" 收口在一处。
 * 从 `electron/main.ts` 抽出来之后可以直接单测（审计报告 §6-4）。
 *
 * 返回值形状与 `AppConfig["ai"]` 一致（含 `apiKey`），只用于这次测试、不写盘。
 */
export function normalizeAiTestRequest(value: unknown, fallbackApiKey: string): AppConfig["ai"] {
  if (!value || typeof value !== "object") throw new Error("AI 测试参数无效");
  const request = value as { ai?: Partial<AiSettings>; apiKey?: unknown };
  const incoming = request.ai;
  if (!incoming || (incoming.provider !== "deepseek" && incoming.provider !== "custom")) {
    throw new Error("AI 服务类型无效");
  }
  const baseUrl = typeof incoming.baseUrl === "string" ? incoming.baseUrl.trim() : "";
  const model = typeof incoming.model === "string" ? incoming.model.trim() : "";
  const timeoutSeconds = Number(incoming.timeoutSeconds);
  if (!isSecureApiBaseUrl(baseUrl)) throw new Error("AI API 地址无效");
  if (!model || model.length > 100) throw new Error("AI 模型名称无效");
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 5 || timeoutSeconds > 120) {
    throw new Error("AI 请求超时必须为 5–120 秒");
  }
  const transientKey = typeof request.apiKey === "string" ? request.apiKey.trim() : "";
  return {
    enabled: incoming.enabled !== false,
    provider: incoming.provider,
    baseUrl: baseUrl.replace(/\/$/, ""),
    model,
    timeoutSeconds: Math.round(timeoutSeconds),
    // 草稿 Key 优先；留空表示沿用已保存的凭据（只用于这次测试，不写盘）。
    apiKey: transientKey || fallbackApiKey
  };
}
