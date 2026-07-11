import { readFile, rename } from "node:fs/promises";
import {
  assertSavableSettings,
  loadAppConfigFromObject,
  mergeRawConfig,
  toUserSettings,
  type AppConfig,
  type RawConfig,
  type UserSettings
} from "../config.js";
import { atomicWriteText, copyFileAtomically } from "../services/atomicFile.js";

interface PersonalSeed {
  version: number;
  settings: RawConfig;
}

class InvalidSettingsFileError extends Error {}

export class SettingsStore {
  constructor(
    private readonly filePath: string,
    private readonly defaults: RawConfig,
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly personalSeedPath?: string
  ) {}

  private writeQueue: Promise<void> = Promise.resolve();
  private recoveryMessage: string | null = null;

  async load(): Promise<AppConfig> {
    const user = await this.readSettingsFile();
    const seed = await this.readPersonalSeed();
    let merged = mergeRawConfig(this.defaults, user);

    if (seed && shouldApplyPersonalSeed(user, this.defaults, seed.version)) {
      merged = mergeRawConfig(merged, {
        ...seed.settings,
        personalSeedVersion: seed.version
      });
      const seededConfig = loadAppConfigFromObject(merged, this.env);
      await this.writeConfig(seededConfig);
      return seededConfig;
    }

    const config = loadAppConfigFromObject(merged, this.env);
    const sourceSchemaVersion = typeof user.schemaVersion === "number"
      ? user.schemaVersion
      : 0;
    if (sourceSchemaVersion < config.schemaVersion) {
      await this.writeConfig(config);
    }
    return config;
  }

  async save(value: unknown): Promise<AppConfig> {
    assertSavableSettings(value);
    const config = loadAppConfigFromObject(
      mergeRawConfig(this.defaults, value as unknown as RawConfig),
      this.env
    );
    await this.writeConfig(config);
    return config;
  }

  get path(): string {
    return this.filePath;
  }

  get importBackupPath(): string {
    return this.filePath + ".import-backup.json";
  }

  get recoveryBackupPath(): string {
    return this.filePath + ".last-good.json";
  }

  consumeRecoveryMessage(): string | null {
    const message = this.recoveryMessage;
    this.recoveryMessage = null;
    return message;
  }

  async createImportBackup(): Promise<boolean> {
    try {
      const content = await readFile(this.filePath, "utf8");
      await atomicWriteText(this.importBackupPath, content);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async hasImportBackup(): Promise<boolean> {
    try {
      await readFile(this.importBackupPath, "utf8");
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async restoreImportBackup(): Promise<AppConfig> {
    const raw = await this.readRawFileStrict(this.importBackupPath);
    return this.save(raw);
  }

  async readImportBackup(): Promise<AppConfig> {
    const raw = await this.readRawFileStrict(this.importBackupPath);
    return loadAppConfigFromObject(mergeRawConfig(this.defaults, raw), this.env);
  }

  private async writeConfig(config: AppConfig): Promise<void> {
    const operation = this.writeQueue.then(() => this.writeConfigNow(config));
    this.writeQueue = operation.catch(() => undefined);
    await operation;
  }

  private async writeConfigNow(config: AppConfig): Promise<void> {
    const settings = toUserSettings(config);
    await atomicWriteText(
      this.filePath,
      JSON.stringify(settings, null, 2) + "\n",
      { backupPath: this.recoveryBackupPath }
    );
  }

  private async readPersonalSeed(): Promise<PersonalSeed | null> {
    if (!this.personalSeedPath) return null;
    const raw = await this.readRawFile(this.personalSeedPath);
    const version = typeof raw.version === "number" ? Math.max(0, Math.round(raw.version)) : 0;
    const settings = asRecord(raw.settings);
    return version > 0 && Object.keys(settings).length > 0
      ? { version, settings }
      : null;
  }

  private async readRawFile(filePath: string): Promise<RawConfig> {
    try {
      const content = await readFile(filePath, "utf8");
      const parsed = JSON.parse(content);
      return parsed && typeof parsed === "object" ? parsed as RawConfig : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return {};
      throw error;
    }
  }

  private async readSettingsFile(): Promise<RawConfig> {
    try {
      return await this.readRawFileStrict(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      if (!(error instanceof SyntaxError) && !(error instanceof InvalidSettingsFileError)) throw error;

      const quarantinePath = `${this.filePath}.corrupt-${Date.now()}`;
      await rename(this.filePath, quarantinePath);
      try {
        const recovered = await this.readRawFileStrict(this.recoveryBackupPath);
        await copyFileAtomically(this.recoveryBackupPath, this.filePath);
        this.recoveryMessage = "设置文件损坏，已恢复上一次有效设置";
        return recovered;
      } catch (backupError) {
        if ((backupError as NodeJS.ErrnoException).code !== "ENOENT" &&
          !(backupError instanceof SyntaxError) &&
          !(backupError instanceof InvalidSettingsFileError)) throw backupError;
        this.recoveryMessage = "设置文件损坏，已隔离并恢复默认设置";
        return {};
      }
    }
  }

  private async readRawFileStrict(filePath: string): Promise<RawConfig> {
    const content = await readFile(filePath, "utf8");
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new InvalidSettingsFileError("设置文件不是有效对象");
    }
    return parsed as RawConfig;
  }
}

export function settingsForRenderer(config: AppConfig): UserSettings {
  return toUserSettings(config);
}

function shouldApplyPersonalSeed(
  user: RawConfig,
  defaults: RawConfig,
  seedVersion: number
): boolean {
  const appliedVersion = typeof user.personalSeedVersion === "number"
    ? user.personalSeedVersion
    : 0;
  if (appliedVersion >= seedVersion) return false;
  if (Object.keys(user).length === 0) return true;

  const userCodes = watchlistCodes(user.watchlist);
  const defaultCodes = watchlistCodes(defaults.watchlist);
  return userCodes.length > 0 &&
    userCodes.length === defaultCodes.length &&
    userCodes.every((code, index) => code === defaultCodes[index]);
}

function watchlistCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === "string") return entry.trim();
    const row = asRecord(entry);
    if (typeof row.securityCode === "string") return row.securityCode.trim();
    if (typeof row.code === "string") return row.code.trim();
    return "";
  }).filter((code) => /^\d{6}$/.test(code));
}

function asRecord(value: unknown): RawConfig {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RawConfig
    : {};
}
