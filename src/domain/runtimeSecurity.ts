export function resolveDevServerUrl(isPackaged: boolean, value: string | undefined): string | null {
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

/**
 * dev server 模式下允许加载的页面。
 *
 * 这是 `will-navigate` 与全部 IPC sender 校验的唯一闸门，所以必须是白名单：
 * 遗漏一个页面会让那个窗口的 IPC 全部被拒（fail-closed 的功能性 bug），
 * 而放宽成"任意 pathname"又会把 dev server 上的任意脚本放进来。
 */
const DEV_SERVER_PAGES = [
  "/index.html",
  "/settings.html",
  "/quick.html",
  "/excel.html",
  "/work.html"
];

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
        // host 也要比较：只比 pathname 时 `file://远程主机/app/dist/index.html` 会被放行。
        return (
          allowed.protocol === "file:" &&
          allowed.host === url.host &&
          allowed.pathname === url.pathname
        );
      });
    }
    if (!devServerUrl) return false;
    const dev = new URL(devServerUrl);
    return (
      url.origin === dev.origin &&
      (url.pathname === dev.pathname || DEV_SERVER_PAGES.includes(url.pathname))
    );
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
    return url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname));
  } catch {
    return false;
  }
}

/**
 * Linux 上 `safeStorage` 可能回落到 `basic_text`（硬编码密钥，"加密"等价于明文）。
 * 这种后端不能再对用户声称"系统安全存储"（审计报告 §8 Info-8）。
 */
export function isInsecureStorageBackend(platform: string, backend: string | undefined): boolean {
  return platform === "linux" && backend === "basic_text";
}

/**
 * 外部链接白名单：只允许 `https:` 且不带 userinfo。
 *
 * 此前用 `/^https?:\/\//` 放行明文 http，并把原始字符串直接交给 `shell.openExternal`
 * （审计报告 §8 Low-3）。说明/新闻来源已 grep 确认全部是 https，因此收紧不会损失功能。
 */
export function isExternalLinkAllowed(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}
