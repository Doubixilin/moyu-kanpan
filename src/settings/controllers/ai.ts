import type { AiSettings, UserSettings } from "../../config.js";
import type { AiRuntimeStatus } from "../../domain/types.js";
import { describeError, type SettingsShellPorts } from "./ports.js";

/**
 * AI 设置面板的控制器：持有"待保存的 API Key / 连接状态 / 忙碌标记"三个渲染层状态。
 *
 * 以前这三项是 `settingsRenderer.ts` 的模块级 `let`，与 DOM 和 IPC 直接耦合；
 * 现在通过 `AiPorts` 注入，可以脱离 Electron 单测（审计报告 §4-5 第二步、§4-8）。
 */

/** 主进程侧 AI 相关 IPC 的最小形状（`FloatingStockApi` 结构上兼容）。 */
export interface AiIpc {
  testAiConnection(request: { ai: AiSettings; apiKey?: string }): Promise<AiRuntimeStatus>;
  setAiApiKey(apiKey: string): Promise<AiRuntimeStatus>;
  clearAiApiKey(): Promise<AiRuntimeStatus>;
  getAiStatus(): Promise<AiRuntimeStatus>;
}

export interface AiPorts extends SettingsShellPorts {
  /** 返回 null 表示 preload 未就绪（例如在浏览器里打开设置页）。 */
  ipc(): AiIpc | null;
}

/** API Key 输入框的长度上限（与原实现一致）。 */
export const AI_API_KEY_MAX_LENGTH = 2_000;

export class AiSettingsController {
  /** 最近一次从主进程拿到的状态；null = 还在读取。 */
  status: AiRuntimeStatus | null = null;
  /** 输入框里的草稿 Key：不写进 settings，保存时由主进程加密存储。 */
  pendingApiKey = "";
  busy = false;

  constructor(private readonly ports: AiPorts) {}

  setPendingApiKey(value: string): void {
    this.pendingApiKey = value.slice(0, AI_API_KEY_MAX_LENGTH);
  }

  /** Key 输入框的占位提示：告诉用户留空会发生什么。 */
  keyPlaceholder(): string {
    if (this.status?.credentialSource === "secure") return "已安全保存；留空表示不变";
    if (this.status?.credentialSource === "environment") {
      return "环境变量已配置；输入可改用安全存储";
    }
    return "输入后由系统安全存储加密";
  }

  /** AI 状态徽标的文案。`settings` 为 null（尚未加载）时按"读取中"处理。 */
  statusLabel(settings: UserSettings | null): string {
    if (!this.status) return "读取中";
    if (this.status.state === "testing") return "测试中";
    if (this.status.state === "success") return "连接正常";
    if (this.status.state === "error") return "需要处理";
    if (this.status.configured && !settings?.ai.enabled) return "已配置 · 未启用";
    if (this.status.configured) {
      return this.status.credentialSource === "secure" ? "已安全配置" : "环境变量";
    }
    return "本地规则";
  }

  /** 测试连接：用当前草稿 Key（若有）覆盖已保存配置，只测不写。 */
  async test(settings: UserSettings): Promise<void> {
    const ipc = this.ports.ipc();
    if (!ipc || this.busy) return;
    this.busy = true;
    this.ports.clearMessage();
    this.ports.render();
    try {
      const apiKey = this.pendingApiKey.trim();
      this.status = await ipc.testAiConnection({
        ai: { ...settings.ai },
        ...(apiKey ? { apiKey } : {})
      });
      this.ports.notify(this.status.message, this.status.state === "success" ? "ok" : "error");
    } catch (error) {
      this.ports.notify(describeError(error), "error");
    } finally {
      this.busy = false;
      this.ports.render();
    }
  }

  /** 清除系统安全存储里的 Key（草稿同时清空）。 */
  async clearCredential(): Promise<void> {
    const ipc = this.ports.ipc();
    if (!ipc || this.busy) return;
    this.busy = true;
    this.ports.render();
    try {
      this.status = await ipc.clearAiApiKey();
      this.pendingApiKey = "";
      this.ports.notify(this.status.message, "ok");
    } catch (error) {
      this.ports.notify(describeError(error), "error");
    } finally {
      this.busy = false;
      this.ports.render();
    }
  }

  /**
   * 设置保存成功后的收尾：有草稿 Key 就落盘，否则刷新状态。
   *
   * 抛出的异常由调用方（`save()`）统一提示——它已经在自己的 try 里。
   */
  async syncAfterSave(): Promise<void> {
    const ipc = this.ports.ipc();
    if (!ipc) return;
    const apiKey = this.pendingApiKey.trim();
    if (apiKey) {
      this.status = await ipc.setAiApiKey(apiKey);
      this.pendingApiKey = "";
      return;
    }
    this.status = await ipc.getAiStatus();
  }
}
