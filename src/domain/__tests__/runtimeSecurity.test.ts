import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isExternalLinkAllowed,
  isInsecureStorageBackend,
  isSecureApiBaseUrl,
  isTrustedRendererUrl,
  resolveDevServerUrl
} from "../runtimeSecurity";

describe("runtime renderer security", () => {
  it("never uses a development server in a packaged application", () => {
    assert.equal(resolveDevServerUrl(true, "http://127.0.0.1:5173"), null);
    assert.equal(resolveDevServerUrl(true, "https://example.com"), null);
  });

  it("only accepts loopback development servers", () => {
    assert.equal(resolveDevServerUrl(false, "https://example.com"), null);
    assert.equal(resolveDevServerUrl(false, "http://127.0.0.1:5173"), "http://127.0.0.1:5173/");
    assert.equal(resolveDevServerUrl(false, "http://localhost:5173"), "http://localhost:5173/");
  });

  it("trusts only packaged renderer files or the selected dev origin", () => {
    const files = ["file:///app/dist/index.html", "file:///app/dist/settings.html"];
    assert.equal(isTrustedRendererUrl("file:///app/dist/index.html", files, null), true);
    assert.equal(isTrustedRendererUrl("file:///tmp/evil.html", files, null), false);
    assert.equal(isTrustedRendererUrl("https://example.com", files, null), false);
    // 只比 pathname 时，带远程 host 的 file: URL 会被误放行
    assert.equal(
      isTrustedRendererUrl("file://evil.example/app/dist/index.html", files, null),
      false
    );
    assert.equal(
      isTrustedRendererUrl("http://127.0.0.1:5173/settings.html", files, "http://127.0.0.1:5173/"),
      true
    );
    assert.equal(
      isTrustedRendererUrl("http://example.com/settings.html", files, "http://127.0.0.1:5173/"),
      false
    );
    // dev server 上的每个页面窗口都要被信任，否则它们的 IPC 会被全部拒绝
    for (const page of ["/quick.html", "/excel.html", "/work.html"]) {
      assert.equal(
        isTrustedRendererUrl(`http://127.0.0.1:5173${page}`, files, "http://127.0.0.1:5173/"),
        true,
        page
      );
    }
    assert.equal(
      isTrustedRendererUrl("http://127.0.0.1:5173/evil.html", files, "http://127.0.0.1:5173/"),
      false
    );
  });

  it("requires HTTPS for remote API credentials but permits local development", () => {
    assert.equal(isSecureApiBaseUrl("https://api.example.com/v1"), true);
    assert.equal(isSecureApiBaseUrl("http://127.0.0.1:8000/v1"), true);
    assert.equal(isSecureApiBaseUrl("http://localhost:8000/v1"), true);
    assert.equal(isSecureApiBaseUrl("http://api.example.com/v1"), false);
    assert.equal(isSecureApiBaseUrl("https://user:pass@example.com/v1"), false);
  });

  it("flags the plaintext safeStorage backend on Linux only", () => {
    assert.equal(isInsecureStorageBackend("linux", "basic_text"), true);
    assert.equal(isInsecureStorageBackend("linux", "gnome_libsecret"), false);
    assert.equal(isInsecureStorageBackend("linux", undefined), false);
    // 其他平台没有 basic_text 这个回落
    assert.equal(isInsecureStorageBackend("win32", "basic_text"), false);
    assert.equal(isInsecureStorageBackend("darwin", "basic_text"), false);
  });

  it("opens only https links without credentials", () => {
    assert.equal(isExternalLinkAllowed("https://finance.eastmoney.com/a/1.html"), true);
    // 明文 http 会打开可被篡改的页面
    assert.equal(isExternalLinkAllowed("http://example.com/a"), false);
    assert.equal(isExternalLinkAllowed("https://user:pass@example.com/a"), false);
    assert.equal(isExternalLinkAllowed("javascript:alert(1)"), false);
    assert.equal(isExternalLinkAllowed("file:///C:/Windows/System32/calc.exe"), false);
    assert.equal(isExternalLinkAllowed(undefined), false);
    assert.equal(isExternalLinkAllowed("not a url"), false);
  });
});
