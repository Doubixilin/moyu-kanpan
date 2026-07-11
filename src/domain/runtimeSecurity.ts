export function resolveDevServerUrl(
  isPackaged: boolean,
  value: string | undefined
): string | null {
  if (isPackaged || !value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !isLoopbackHost(url.hostname)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function isTrustedRendererUrl(
  candidate: string,
  localFiles: string[],
  devServerUrl: string | null
): boolean {
  try {
    const url = new URL(candidate);
    if (url.protocol === "file:") {
      return localFiles.some((entry) => {
        const allowed = new URL(entry);
        return allowed.protocol === "file:" && allowed.pathname === url.pathname;
      });
    }
    if (!devServerUrl) return false;
    const dev = new URL(devServerUrl);
    return url.origin === dev.origin &&
      (url.pathname === dev.pathname || url.pathname === "/" ||
        url.pathname.endsWith("/index.html") || url.pathname.endsWith("/settings.html"));
  } catch {
    return false;
  }
}

export function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function isSecureApiBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    return url.protocol === "https:" ||
      (url.protocol === "http:" && isLoopbackHost(url.hostname));
  } catch {
    return false;
  }
}
