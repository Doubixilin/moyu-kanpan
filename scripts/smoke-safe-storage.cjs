const { app, Notification, safeStorage } = require("electron");

app.whenReady().then(() => {
  const available = safeStorage.isEncryptionAvailable();
  let roundTrip = false;
  if (available) {
    const probe = "moyu-kanpan-keychain-probe";
    const encrypted = safeStorage.encryptString(probe);
    roundTrip = safeStorage.decryptString(encrypted) === probe;
  }
  process.stdout.write(`${JSON.stringify({
    safeStorageAvailable: available,
    safeStorageRoundTrip: roundTrip,
    notificationSupported: Notification.isSupported()
  })}\n`);
  app.quit();
});
