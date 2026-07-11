const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, safeStorage } = require("electron");

const tempRootPromise = mkdtemp(path.join(os.tmpdir(), "moyu-ai-credential-smoke-"));

app.whenReady().then(async () => {
  const tempRoot = await tempRootPromise;
  app.setPath("userData", tempRoot);
  try {
    assert.equal(safeStorage.isEncryptionAvailable(), true);
    const [{ EncryptedApiKeyStore }, configModule] = await Promise.all([
      import(pathToFileURL(path.join(__dirname, "..", "dist-electron", "src", "ai", "credentials.js")).href),
      import(pathToFileURL(path.join(__dirname, "..", "dist-electron", "src", "config.js")).href)
    ]);
    const credentialPath = path.join(tempRoot, "ai-credential.json");
    const store = new EncryptedApiKeyStore(credentialPath, {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (value) => safeStorage.encryptString(value),
      decryptString: (value) => safeStorage.decryptString(value)
    });
    const ephemeralSecret = `local-smoke-${randomUUID()}`;

    await store.write(ephemeralSecret);
    assert.equal(await store.read(), ephemeralSecret);
    const encryptedFile = await readFile(credentialPath, "utf8");
    assert.equal(encryptedFile.includes(ephemeralSecret), false);

    const current = configModule.loadAppConfigFromObject({}, { AI_API_KEY: ephemeralSecret });
    const boundsSave = configModule.loadAppConfigFromObject(
      JSON.parse(JSON.stringify(configModule.toUserSettings(current))),
      {}
    );
    boundsSave.window.x = 120;
    boundsSave.window.y = 80;
    const afterBoundsSave = configModule.preserveRuntimeSecrets(boundsSave, current);
    assert.equal(afterBoundsSave.ai.apiKey, ephemeralSecret);

    const publicSettingsSave = configModule.loadAppConfigFromObject(
      JSON.parse(JSON.stringify(configModule.toUserSettings(afterBoundsSave))),
      {}
    );
    publicSettingsSave.appearance.backgroundOpacity = 0.7;
    const afterPublicSave = configModule.preserveRuntimeSecrets(
      publicSettingsSave,
      afterBoundsSave
    );
    assert.equal(afterPublicSave.ai.apiKey, ephemeralSecret);

    await store.clear();
    assert.equal(await store.read(), "");
    process.stdout.write(`${JSON.stringify({
      safeStorageAvailable: true,
      encryptedRoundTrip: true,
      plaintextAbsent: true,
      boundsSavePreserved: true,
      publicSettingsSavePreserved: true,
      clearVerified: true
    })}\n`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    app.quit();
  }
}).catch(async (error) => {
  const tempRoot = await tempRootPromise;
  await rm(tempRoot, { recursive: true, force: true });
  process.stderr.write(`AI credential smoke failed: ${error instanceof Error ? error.message : String(error)}\n`);
  app.exit(1);
});
