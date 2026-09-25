import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UserSettings } from "../../config";
import { loadAppConfigFromObject, toUserSettings } from "../../config";
import type { AiRuntimeStatus } from "../../domain/types";
import type { ProfileDiff, ProfilePreview } from "../profile";
import { AI_API_KEY_MAX_LENGTH, AiSettingsController, type AiIpc } from "../controllers/ai";
import {
  acceleratorFromKeyboardEvent,
  bossKeyCaptureOutcome,
  displayBossKey,
  keyFromKeyboardEvent,
  type KeyEventLike
} from "../controllers/bossKey";
import {
  PROFILE_MAX_BYTES,
  PROFILE_REPLACE_CONFIRM,
  PROFILE_RESTORE_CONFIRM,
  ProfileImportController,
  profilePreviewOutcome,
  type ProfileIpc
} from "../controllers/profile";

function settings(): UserSettings {
  return toUserSettings(loadAppConfigFromObject({}, {}));
}

function keyEvent(overrides: Partial<KeyEventLike> & { code: string }): KeyEventLike {
  return {
    key: "",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...overrides
  };
}

/** 记录控制器对宿主的每一次回调——这些调用顺序就是原来的 UI 行为。 */
function shell() {
  const renders: number[] = [];
  const messages: Array<{ message: string; kind: "ok" | "error" }> = [];
  const cleared: number[] = [];
  return {
    renders,
    messages,
    cleared,
    ports: {
      render: () => renders.push(renders.length),
      notify: (message: string, kind: "ok" | "error") => messages.push({ message, kind }),
      clearMessage: () => cleared.push(cleared.length)
    }
  };
}

const EMPTY_DIFF: ProfileDiff = {
  securitiesAdded: [],
  securitiesUpdated: [],
  holdingsAdded: [],
  holdingsUpdated: [],
  holdingsRemoved: [],
  watchlistAdded: [],
  watchlistUpdated: [],
  watchlistRemoved: [],
  alertRuleChanges: 0,
  riskSettingsChanged: false
};

function preview(overrides: Partial<ProfilePreview> = {}): ProfilePreview {
  return {
    valid: true,
    hasChanges: true,
    mode: "merge",
    issues: [],
    ...overrides,
    diff: { ...EMPTY_DIFF, ...overrides.diff }
  };
}

function status(overrides: Partial<AiRuntimeStatus> = {}): AiRuntimeStatus {
  return {
    enabled: true,
    configured: true,
    secureStorageAvailable: true,
    credentialSource: "secure",
    state: "ready",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    lastTestedAt: null,
    lastSuccessAt: null,
    message: "ok",
    ...overrides
  };
}

describe("boss key controller", () => {
  it("maps keyboard codes to accelerators", () => {
    assert.equal(keyFromKeyboardEvent(keyEvent({ code: "KeyS" })), "S");
    assert.equal(keyFromKeyboardEvent(keyEvent({ code: "Digit7" })), "7");
    assert.equal(keyFromKeyboardEvent(keyEvent({ code: "F1" })), "F1");
    assert.equal(keyFromKeyboardEvent(keyEvent({ code: "F24" })), "F24");
    assert.equal(keyFromKeyboardEvent(keyEvent({ code: "Numpad4" })), "num4");
    assert.equal(keyFromKeyboardEvent(keyEvent({ code: "Space" })), "Space");
    assert.equal(keyFromKeyboardEvent(keyEvent({ code: "PageDown" })), "PageDown");
    assert.equal(keyFromKeyboardEvent(keyEvent({ code: "NumpadAdd" })), "numadd");
    // 不认识 / 越界的键返回空串，调用方据此报"不支持"
    assert.equal(keyFromKeyboardEvent(keyEvent({ code: "F25" })), "");
    assert.equal(keyFromKeyboardEvent(keyEvent({ code: "IntlYen" })), "");
  });

  it("orders modifiers and rejects dangerous combinations", () => {
    assert.equal(
      acceleratorFromKeyboardEvent(keyEvent({ code: "KeyS", ctrlKey: true })),
      "CommandOrControl+S"
    );
    // 固定顺序 CommandOrControl → Alt → Shift → Super，避免同一个组合出现多种写法
    assert.equal(
      acceleratorFromKeyboardEvent(
        keyEvent({ code: "Digit1", ctrlKey: true, altKey: true, shiftKey: true, metaKey: true })
      ),
      "CommandOrControl+Alt+Shift+Super+1"
    );
    // 单键只允许功能键/媒体键，普通字母必须带修饰键
    assert.equal(acceleratorFromKeyboardEvent(keyEvent({ code: "KeyA" })), null);
    assert.equal(acceleratorFromKeyboardEvent(keyEvent({ code: "F5" })), "F5");
    assert.equal(acceleratorFromKeyboardEvent(keyEvent({ code: "AudioVolumeUp" })), "VolumeUp");
    // F11 与系统保留组合一律拒绝
    assert.equal(acceleratorFromKeyboardEvent(keyEvent({ code: "F11" })), null);
    assert.equal(
      acceleratorFromKeyboardEvent(keyEvent({ code: "F4", altKey: true })),
      null,
      "Alt+F4 必须被拒绝"
    );
  });

  it("interprets a recording keystroke", () => {
    assert.deepEqual(bossKeyCaptureOutcome(keyEvent({ code: "Escape", key: "Escape" })), {
      kind: "cancel",
      message: "已取消老板键录制"
    });
    assert.deepEqual(bossKeyCaptureOutcome(keyEvent({ code: "ControlLeft" })), {
      kind: "modifier"
    });
    assert.deepEqual(bossKeyCaptureOutcome(keyEvent({ code: "KeyA" })), {
      kind: "unsupported",
      message: "该按键不受支持或属于危险组合，请换一个"
    });

    const accepted = bossKeyCaptureOutcome(keyEvent({ code: "KeyS", ctrlKey: true }));
    assert.deepEqual(accepted, {
      kind: "accepted",
      accelerator: "CommandOrControl+S",
      message: "已记录 Ctrl+S，保存后生效"
    });
    // 展示名要写成人能读的（Super → Win）
    assert.equal(displayBossKey("Super+K"), "Win+K");
    assert.equal(displayBossKey("CommandOrControl+Alt+Space"), "Ctrl+Alt+Space");
  });
});

describe("AI settings controller", () => {
  it("describes credential state for the key field", () => {
    const { ports } = shell();
    const ai = new AiSettingsController({ ...ports, ipc: () => null });
    assert.equal(ai.keyPlaceholder(), "输入后由系统安全存储加密");
    assert.equal(ai.statusLabel(null), "读取中");

    ai.status = status({ credentialSource: "secure" });
    assert.equal(ai.keyPlaceholder(), "已安全保存；留空表示不变");
    ai.status = status({ credentialSource: "environment" });
    assert.equal(ai.keyPlaceholder(), "环境变量已配置；输入可改用安全存储");
    ai.status = status({ credentialSource: "none" });
    assert.equal(ai.keyPlaceholder(), "输入后由系统安全存储加密");
  });

  it("labels the AI badge from runtime state and settings", () => {
    const { ports } = shell();
    const ai = new AiSettingsController({ ...ports, ipc: () => null });
    const current = settings();
    const label = (patch: Partial<AiRuntimeStatus>, enabled = true): string => {
      ai.status = status(patch);
      return ai.statusLabel({ ...current, ai: { ...current.ai, enabled } });
    };

    assert.equal(label({ state: "testing" }), "测试中");
    assert.equal(label({ state: "success" }), "连接正常");
    assert.equal(label({ state: "error" }), "需要处理");
    assert.equal(label({ configured: false, credentialSource: "none" }), "本地规则");
    assert.equal(label({}, false), "已配置 · 未启用");
    assert.equal(label({ credentialSource: "environment" }), "环境变量");
    assert.equal(label({}), "已安全配置");
  });

  it("truncates the pending API key", () => {
    const { ports } = shell();
    const ai = new AiSettingsController({ ...ports, ipc: () => null });
    ai.setPendingApiKey("x".repeat(AI_API_KEY_MAX_LENGTH + 50));
    assert.equal(ai.pendingApiKey.length, AI_API_KEY_MAX_LENGTH);
  });

  it("tests the connection with the draft key and reports the result", async () => {
    const { ports, renders, messages, cleared } = shell();
    const requests: Array<{ ai: UserSettings["ai"]; apiKey?: string }> = [];
    const ipc: AiIpc = {
      testAiConnection: async (request) => {
        requests.push(request);
        return status({ state: "success", message: "连接正常" });
      },
      setAiApiKey: async () => status(),
      clearAiApiKey: async () => status(),
      getAiStatus: async () => status()
    };
    const ai = new AiSettingsController({ ...ports, ipc: () => ipc });
    const current = settings();

    ai.setPendingApiKey("  sk-test  ");
    await ai.test(current);

    // 草稿 Key 必须 trim 后发送，且不能写进 settings
    assert.deepEqual(requests, [{ ai: current.ai, apiKey: "sk-test" }]);
    assert.equal(cleared.length, 1, "测试前先清空旧提示");
    assert.deepEqual(messages, [{ message: "连接正常", kind: "ok" }]);
    assert.equal(ai.busy, false);
    assert.equal(renders.length, 2, "忙碌前后各渲染一次");

    messages.length = 0;
    ai.pendingApiKey = "   ";
    await ai.test(current);
    assert.deepEqual(requests[1], { ai: current.ai }, "空白草稿不应带上 apiKey");
  });

  it("surfaces test failures and keeps the last status", async () => {
    const { ports, messages } = shell();
    const ipc: AiIpc = {
      testAiConnection: async () => {
        throw new Error("网络不可达");
      },
      setAiApiKey: async () => status(),
      clearAiApiKey: async () => status(),
      getAiStatus: async () => status()
    };
    const ai = new AiSettingsController({ ...ports, ipc: () => ipc });
    ai.status = status({ state: "error", message: "旧的错误" });
    await ai.test(settings());

    assert.deepEqual(messages, [{ message: "网络不可达", kind: "error" }]);
    assert.equal(ai.status?.message, "旧的错误");
  });

  it("clears the stored credential and the draft together", async () => {
    const { ports, messages } = shell();
    const ipc: AiIpc = {
      testAiConnection: async () => status(),
      setAiApiKey: async () => status(),
      clearAiApiKey: async () => status({ credentialSource: "none", message: "已清除" }),
      getAiStatus: async () => status()
    };
    const ai = new AiSettingsController({ ...ports, ipc: () => ipc });
    ai.setPendingApiKey("sk-test");
    await ai.clearCredential();

    assert.equal(ai.pendingApiKey, "");
    assert.equal(ai.status?.message, "已清除");
    assert.deepEqual(messages, [{ message: "已清除", kind: "ok" }]);
  });

  it("flushes the draft key after a successful save, otherwise refreshes status", async () => {
    const { ports } = shell();
    const calls: string[] = [];
    const ipc: AiIpc = {
      testAiConnection: async () => status(),
      setAiApiKey: async (apiKey) => {
        calls.push("set:" + apiKey);
        return status({ message: "已保存 " + apiKey });
      },
      clearAiApiKey: async () => status(),
      getAiStatus: async () => {
        calls.push("get");
        return status({ message: "已刷新" });
      }
    };
    const ai = new AiSettingsController({ ...ports, ipc: () => ipc });

    ai.setPendingApiKey(" sk-1 ");
    await ai.syncAfterSave();
    assert.deepEqual(calls, ["set:sk-1"]);
    assert.equal(ai.pendingApiKey, "", "落盘后草稿必须清空，否则会重复写入");
    assert.equal(ai.status?.message, "已保存 sk-1");

    await ai.syncAfterSave();
    assert.deepEqual(calls, ["set:sk-1", "get"]);
    assert.equal(ai.status?.message, "已刷新");
  });

  it("does nothing without a preload bridge", async () => {
    const { ports, renders, messages } = shell();
    const ai = new AiSettingsController({ ...ports, ipc: () => null });
    await ai.test(settings());
    await ai.clearCredential();
    await ai.syncAfterSave();
    assert.deepEqual(renders, []);
    assert.deepEqual(messages, []);
  });
});

describe("profile import controller", () => {
  function fakeIpc(overrides: Partial<ProfileIpc> = {}): {
    ipc: ProfileIpc;
    calls: string[];
  } {
    const calls: string[] = [];
    const ipc: ProfileIpc = {
      previewProfile: async (request) => {
        calls.push(`preview:${request.mode}:${request.text}`);
        return preview();
      },
      applyProfile: async (request) => {
        calls.push(`apply:${request.mode}:${request.text}`);
        return { settings: settings(), backupCreated: false };
      },
      restoreProfileBackup: async () => {
        calls.push("restore");
        return settings();
      },
      copyProfilePrompt: async () => {
        calls.push("copyPrompt");
        return "已复制提示词";
      },
      copyProfileExport: async () => {
        calls.push("copyExport");
        return "已复制配置包";
      },
      ...overrides
    };
    return { ipc, calls };
  }

  function controller(ipc: ProfileIpc | null, confirmed = true) {
    const host = shell();
    const applied: Array<{ backupCreated: boolean }> = [];
    const confirmedWith: string[] = [];
    const profile = new ProfileImportController({
      ...host.ports,
      ipc: () => ipc,
      confirm: (message) => {
        confirmedWith.push(message);
        return confirmed;
      },
      applySettings: (_next, backupCreated) => applied.push({ backupCreated })
    });
    return { profile, host, applied, confirmedWith };
  }

  it("classifies a preview into a user-facing message", () => {
    assert.deepEqual(profilePreviewOutcome(preview({ valid: false })), {
      message: "配置包存在错误，不会应用",
      kind: "error"
    });
    assert.deepEqual(profilePreviewOutcome(preview({ hasChanges: false })), {
      message: "配置包与当前设置没有差异",
      kind: "ok"
    });
    assert.deepEqual(profilePreviewOutcome(preview()), {
      message: "配置包校验通过，请核对差异后确认导入",
      kind: "ok"
    });
  });

  it("invalidates a stale preview as soon as the draft changes", () => {
    const { ipc } = fakeIpc();
    const { profile } = controller(ipc);

    profile.setText("{}");
    profile.preview = preview();
    profile.setText("{} ");
    assert.equal(profile.preview, null, "改动文本必须作废旧预览");

    profile.preview = preview();
    profile.setMode("replace");
    assert.equal(profile.mode, "replace");
    assert.equal(profile.preview, null);

    profile.preview = preview();
    profile.setMode("垃圾值");
    assert.equal(profile.mode, "merge", "未知模式回落到 merge");
    assert.equal(profile.preview, null);

    profile.preview = preview();
    profile.clear();
    assert.equal(profile.text, "");
    assert.equal(profile.preview, null);
  });

  it("refuses oversized files before reading them", async () => {
    const { ipc } = fakeIpc();
    const { profile, host } = controller(ipc);
    let read = false;
    const file = {
      name: "big.json",
      size: PROFILE_MAX_BYTES + 1,
      text: async () => {
        read = true;
        return "{}";
      }
    } as unknown as File;

    await profile.readFile(file);
    assert.equal(read, false, "超限文件不应该被读进内存");
    assert.equal(profile.text, "");
    assert.deepEqual(host.messages, [{ message: "配置包不能超过 2MB", kind: "error" }]);
  });

  it("reads a file and reports the name", async () => {
    const { ipc } = fakeIpc();
    const { profile, host } = controller(ipc);
    profile.preview = preview();
    const file = {
      name: "profile.json",
      size: 10,
      text: async () => '{"profileVersion":1}'
    } as unknown as File;

    await profile.readFile(file);
    assert.equal(profile.text, '{"profileVersion":1}');
    assert.equal(profile.preview, null);
    assert.deepEqual(host.messages, [{ message: "已读取 profile.json，请预览差异", kind: "ok" }]);
  });

  it("previews the diff and toggles the busy flag", async () => {
    const { ipc, calls } = fakeIpc();
    const { profile, host } = controller(ipc);

    await profile.previewDiff();
    assert.deepEqual(calls, [], "空文本不该请求主进程");

    profile.setText("  {}  ");
    await profile.previewDiff();
    assert.deepEqual(calls, ["preview:merge:  {}  "], "发给主进程的是原文，不做 trim");
    assert.deepEqual(host.messages, [
      { message: "配置包校验通过，请核对差异后确认导入", kind: "ok" }
    ]);
    assert.equal(profile.busy, false);
    assert.equal(host.renders.length, 2);

    profile.setText("{bad");
    profile.setMode("replace");
    await profile.previewDiff();
    assert.equal(profile.preview?.mode, "merge", "fake 返回的 preview 与控制器模式无关");
    assert.equal(calls[1], "preview:replace:{bad");
  });

  it("reports an invalid package as an error", async () => {
    const { ipc } = fakeIpc({ previewProfile: async () => preview({ valid: false }) });
    const { profile, host } = controller(ipc);
    profile.setText("{}");
    await profile.previewDiff();
    assert.deepEqual(host.messages, [{ message: "配置包存在错误，不会应用", kind: "error" }]);
  });

  it("drops the preview when the bridge fails", async () => {
    const { ipc } = fakeIpc({
      previewProfile: async () => {
        throw new Error("解析失败");
      }
    });
    const { profile, host } = controller(ipc);
    profile.setText("{}");
    profile.preview = preview();
    await profile.previewDiff();
    assert.equal(profile.preview, null);
    assert.deepEqual(host.messages, [{ message: "解析失败", kind: "error" }]);
    assert.equal(profile.busy, false);
  });

  it("requires confirmation before a replace import", async () => {
    const { ipc, calls } = fakeIpc();
    const { profile, host, confirmedWith } = controller(ipc, false);
    profile.setText("{}");
    profile.setMode("replace");
    profile.preview = preview({ mode: "replace" });

    await profile.apply();
    assert.deepEqual(calls, [], "用户取消后不能落盘");
    assert.deepEqual(confirmedWith, [PROFILE_REPLACE_CONFIRM]);
    assert.deepEqual(host.messages, []);
    assert.equal(profile.text, "{}", "取消后草稿必须保留");
  });

  it("ignores apply when the preview is missing, invalid or unchanged", async () => {
    const { ipc, calls } = fakeIpc();
    const { profile } = controller(ipc);
    profile.setText("{}");

    await profile.apply();
    profile.preview = preview({ valid: false });
    await profile.apply();
    profile.preview = preview({ hasChanges: false });
    await profile.apply();
    assert.deepEqual(calls, []);
  });

  it("applies a valid package and resets the draft", async () => {
    const requests: Array<{ text: string; mode: string }> = [];
    const { ipc } = fakeIpc({
      applyProfile: async (request) => {
        requests.push(request);
        return { settings: settings(), backupCreated: true };
      }
    });
    const { profile, host, applied, confirmedWith } = controller(ipc);
    profile.setText("{}");
    profile.preview = preview();

    await profile.apply();
    assert.deepEqual(requests, [{ text: "{}", mode: "merge" }]);
    assert.deepEqual(applied, [{ backupCreated: true }]);
    assert.equal(profile.hasBackup, true);
    assert.equal(profile.text, "");
    assert.equal(profile.preview, null);
    assert.deepEqual(confirmedWith, [], "merge 模式不需要确认");
    assert.deepEqual(host.messages, [
      { message: "配置已导入并进入影子模式；已保存导入前备份", kind: "ok" }
    ]);
  });

  it("reports apply failures without losing the draft", async () => {
    const { ipc } = fakeIpc({
      applyProfile: async () => {
        throw new Error("写入失败");
      }
    });
    const { profile, host } = controller(ipc);
    profile.setText("{}");
    profile.preview = preview();

    await profile.apply();
    assert.deepEqual(host.messages, [{ message: "写入失败", kind: "error" }]);
    assert.equal(profile.text, "{}", "失败后草稿要留着让用户重试");
    assert.equal(profile.busy, false);
  });

  it("only restores a backup when one exists and the user confirms", async () => {
    const { ipc, calls } = fakeIpc();
    const { profile, applied } = controller(ipc);

    await profile.restore();
    assert.deepEqual(calls, [], "没有备份就不该请求恢复");

    profile.hasBackup = true;
    const cancelledRun = controller(ipc, false);
    cancelledRun.profile.hasBackup = true;
    await cancelledRun.profile.restore();
    assert.deepEqual(calls, []);
    assert.deepEqual(cancelledRun.confirmedWith, [PROFILE_RESTORE_CONFIRM]);

    await profile.restore();
    assert.deepEqual(calls, ["restore"]);
    assert.deepEqual(applied, [{ backupCreated: false }]);
    assert.equal(profile.preview, null);
  });

  it("copies the prompt and the export, falling back to a generic message", async () => {
    const { ipc, calls } = fakeIpc();
    const { profile, host } = controller(ipc);
    await profile.copyPrompt();
    await profile.copyExport();
    assert.deepEqual(calls, ["copyPrompt", "copyExport"]);
    assert.deepEqual(
      host.messages.map((entry) => entry.message),
      ["已复制提示词", "已复制配置包"]
    );

    const empty = fakeIpc({ copyProfilePrompt: async () => undefined as unknown as string });
    const fallback = controller(empty.ipc);
    await fallback.profile.copyPrompt();
    assert.deepEqual(fallback.host.messages, [{ message: "已复制配置包提示词", kind: "ok" }]);
  });

  it("does nothing without a preload bridge", async () => {
    const { profile, host, applied } = controller(null);
    profile.setText("{}");
    profile.preview = preview();
    profile.hasBackup = true;
    await profile.previewDiff();
    await profile.apply();
    await profile.restore();
    await profile.copyPrompt();
    await profile.copyExport();
    assert.deepEqual(host.messages, []);
    assert.deepEqual(applied, []);
    assert.equal(profile.text, "{}");
  });
});
