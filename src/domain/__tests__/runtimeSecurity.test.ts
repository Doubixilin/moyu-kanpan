import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSecureApiBaseUrl, isTrustedRendererUrl, resolveDevServerUrl } from "../runtimeSecurity";

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
    assert.equal(
      isTrustedRendererUrl("http://127.0.0.1:5173/settings.html", files, "http://127.0.0.1:5173/"),
      true
    );
    assert.equal(
      isTrustedRendererUrl("http://example.com/settings.html", files, "http://127.0.0.1:5173/"),
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
});
