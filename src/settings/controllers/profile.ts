import type { UserSettings } from "../../config.js";
import type { ProfileImportMode, ProfilePreview } from "../profile.js";
import { describeError, type SettingsShellPorts } from "./ports.js";

/**
 * 配置导入面板的控制器：持有"草稿文本 / 导入方式 / 预览结果 / 忙碌标记 / 是否有备份"。
 *
 * 此前这 5 个状态与 6 个异步流程（读文件、复制提示词、复制配置包、预览、导入、恢复）
 * 直接写在 `settingsRenderer.ts` 里，既读模块级变量又直接调 `window.floatingStock`，
 * 因此零测试且无法单独推理。现在通过 `ProfilePorts` 注入（审计报告 §4-5 第二步）。
 */

/** 主进程侧配置包相关 IPC 的最小形状（`FloatingStockApi` 结构上兼容）。 */
export interface ProfileIpc {
  previewProfile(request: { text: string; mode: ProfileImportMode }): Promise<ProfilePreview>;
  applyProfile(request: {
    text: string;
    mode: ProfileImportMode;
  }): Promise<{ settings: UserSettings; backupCreated: boolean }>;
  restoreProfileBackup(): Promise<UserSettings>;
  copyProfilePrompt(): Promise<string>;
  copyProfileExport(): Promise<string>;
}

export interface ProfilePorts extends SettingsShellPorts {
  /** 返回 null 表示 preload 未就绪。 */
  ipc(): ProfileIpc | null;
  /** 需要用户确认的破坏性操作（替换导入 / 恢复备份）。 */
  confirm(message: string): boolean;
  /** 导入或恢复成功：把新设置交回宿主，宿主负责清空 dirty 标记与提示。 */
  applySettings(next: UserSettings, backupCreated: boolean): void;
}

/** 配置文件体积上限：超过直接拒绝，避免把整个进程卡在解析上。 */
export const PROFILE_MAX_BYTES = 2_000_000;
export const PROFILE_REPLACE_CONFIRM = "确认按预览内容替换明确提供的持仓/自选？导入前会自动备份。";
export const PROFILE_RESTORE_CONFIRM = "确认恢复到上次导入前的配置？";

/** 预览结果 → 提示语。三种情况必须给出不同的话，否则用户不知道能不能点"确认导入"。 */
export function profilePreviewOutcome(preview: ProfilePreview): {
  message: string;
  kind: "ok" | "error";
} {
  if (!preview.valid) return { message: "配置包存在错误，不会应用", kind: "error" };
  if (!preview.hasChanges) return { message: "配置包与当前设置没有差异", kind: "ok" };
  return { message: "配置包校验通过，请核对差异后确认导入", kind: "ok" };
}

export class ProfileImportController {
  text = "";
  mode: ProfileImportMode = "merge";
  preview: ProfilePreview | null = null;
  busy = false;
  hasBackup = false;

  constructor(private readonly ports: ProfilePorts) {}

  /** 手动编辑 JSON：改动即作废旧预览（否则屏幕上的差异与实际文本不一致）。 */
  setText(value: string): void {
    this.text = value;
    this.preview = null;
  }

  setMode(value: string): void {
    this.mode = value === "replace" ? "replace" : "merge";
    this.preview = null;
  }

  clear(): void {
    this.text = "";
    this.preview = null;
  }

  /** 读取用户选择的文件（体积超限直接拒绝，不读进内存）。 */
  async readFile(file: File): Promise<void> {
    if (file.size > PROFILE_MAX_BYTES) {
      this.ports.notify("配置包不能超过 2MB", "error");
      return;
    }
    try {
      this.text = await file.text();
      this.preview = null;
      this.ports.notify(`已读取 ${file.name}，请预览差异`, "ok");
    } catch (error) {
      this.ports.notify(describeError(error), "error");
    }
  }

  async copyPrompt(): Promise<void> {
    const ipc = this.ports.ipc();
    if (!ipc) return;
    try {
      this.ports.notify((await ipc.copyProfilePrompt()) ?? "已复制配置包提示词", "ok");
    } catch (error) {
      this.ports.notify(describeError(error), "error");
    }
  }

  async copyExport(): Promise<void> {
    const ipc = this.ports.ipc();
    if (!ipc) return;
    try {
      this.ports.notify((await ipc.copyProfileExport()) ?? "已复制当前配置包", "ok");
    } catch (error) {
      this.ports.notify(describeError(error), "error");
    }
  }

  /** 请求主进程算差异（纯计算，不写盘）。 */
  async previewDiff(): Promise<void> {
    const ipc = this.ports.ipc();
    if (!ipc || !this.text.trim()) return;
    this.busy = true;
    this.ports.render();
    try {
      this.preview = await ipc.previewProfile({ text: this.text, mode: this.mode });
      const outcome = profilePreviewOutcome(this.preview);
      this.ports.notify(outcome.message, outcome.kind);
    } catch (error) {
      this.preview = null;
      this.ports.notify(describeError(error), "error");
    } finally {
      this.busy = false;
      this.ports.render();
    }
  }

  async apply(): Promise<void> {
    const ipc = this.ports.ipc();
    if (!ipc || !this.preview?.valid || !this.preview.hasChanges) return;
    if (this.mode === "replace" && !this.ports.confirm(PROFILE_REPLACE_CONFIRM)) return;

    this.busy = true;
    this.ports.render();
    try {
      const result = await ipc.applyProfile({ text: this.text, mode: this.mode });
      this.ports.applySettings(result.settings, result.backupCreated);
      if (result.backupCreated) this.hasBackup = true;
      this.text = "";
      this.preview = null;
      this.ports.notify(
        result.backupCreated
          ? "配置已导入并进入影子模式；已保存导入前备份"
          : "配置已导入并进入影子模式",
        "ok"
      );
    } catch (error) {
      this.ports.notify(describeError(error), "error");
    } finally {
      this.busy = false;
      this.ports.render();
    }
  }

  async restore(): Promise<void> {
    const ipc = this.ports.ipc();
    if (!ipc || !this.hasBackup) return;
    if (!this.ports.confirm(PROFILE_RESTORE_CONFIRM)) return;

    this.busy = true;
    this.ports.render();
    try {
      this.ports.applySettings(await ipc.restoreProfileBackup(), false);
      this.preview = null;
      this.ports.notify("已恢复上次导入前配置", "ok");
    } catch (error) {
      this.ports.notify(describeError(error), "error");
    } finally {
      this.busy = false;
      this.ports.render();
    }
  }
}
