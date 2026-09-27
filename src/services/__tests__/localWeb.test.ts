import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PublicSnapshot } from "../../presentation/publicSnapshot";
import { LocalWorkWebServer } from "../localWeb";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

describe("local work web server", () => {
  it("binds a token session and rejects untrusted host or origin", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moyu-web-"));
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "work.html"), "<html>work</html>");
    await writeFile(path.join(root, "assets/workweb.js"), "");
    await writeFile(path.join(root, "assets/workweb.css"), "");
    const visible: number[] = [];
    const snapshot = {
      updatedAt: "now",
      quotes: [],
      indices: [],
      events: [],
      feeds: {}
    } as unknown as PublicSnapshot;
    const server = new LocalWorkWebServer({
      assetRoot: root,
      snapshot: () => snapshot,
      trend: async (code) =>
        code === "600519"
          ? {
              code,
              name: "项目甲",
              updatedAt: "now",
              stale: false,
              items: [{ date: "2026-07-11", close: 100, upper: 110, mid: 100, lower: 90 }]
            }
          : null,
      onVisibleClientsChange: (count) => visible.push(count),
      token: "test-token"
    });
    await server.start();
    cleanup.push(async () => {
      await server.close();
      await rm(root, { recursive: true, force: true });
    });

    assert.equal((await fetch(server.origin)).status, 200);
    assert.equal((await fetch(`${server.origin}/api/public-snapshot`)).status, 401);
    assert.equal(
      (
        await fetch(`${server.origin}/api/session`, {
          method: "POST",
          headers: { Origin: "http://attacker.invalid", "X-Local-Token": "test-token" }
        })
      ).status,
      403
    );
    const session = await fetch(`${server.origin}/api/session`, {
      method: "POST",
      headers: { Origin: server.origin, "X-Local-Token": "test-token" }
    });
    const cookie = session.headers.get("set-cookie")?.split(";")[0] ?? "";
    assert.equal(session.status, 204);
    const response = await fetch(`${server.origin}/api/public-snapshot`, {
      headers: { Origin: server.origin, Cookie: cookie }
    });
    assert.deepEqual(await response.json(), snapshot);
    const trendResponse = await fetch(`${server.origin}/api/trend?code=600519`, {
      headers: { Origin: server.origin, Cookie: cookie }
    });
    assert.equal(trendResponse.status, 200);
    assert.equal(((await trendResponse.json()) as { code: string }).code, "600519");
    assert.equal(
      (
        await fetch(`${server.origin}/api/trend?code=bad`, {
          headers: { Origin: server.origin, Cookie: cookie }
        })
      ).status,
      404
    );
    const visibility = await fetch(`${server.origin}/api/visibility`, {
      method: "POST",
      headers: { Origin: server.origin, Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: "client_12345", visible: true })
    });
    assert.equal(visibility.status, 204);
    assert.equal(visible.at(-1), 1);
    const wrongHost = server.origin.replace("127.0.0.1", "localhost");
    assert.equal((await fetch(wrongHost)).status, 403);

    // 客户端错误应返回 4xx，而不是一律 500。
    assert.equal(
      (
        await fetch(`${server.origin}/api/visibility`, {
          method: "POST",
          headers: { Origin: server.origin, Cookie: cookie, "Content-Type": "application/json" },
          body: "not-json"
        })
      ).status,
      400
    );
    assert.equal(
      (
        await fetch(`${server.origin}/api/visibility`, {
          method: "POST",
          headers: { Origin: server.origin, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: "c".repeat(2_000), visible: true })
        })
      ).status,
      413
    );
  });

  it("never issues a session for an empty token", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "moyu-web-"));
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "work.html"), "<html>work</html>");
    await writeFile(path.join(root, "assets/workweb.js"), "");
    await writeFile(path.join(root, "assets/workweb.css"), "");
    const server = new LocalWorkWebServer({
      assetRoot: root,
      snapshot: () =>
        ({
          updatedAt: "now",
          quotes: [],
          indices: [],
          events: [],
          feeds: {}
        }) as unknown as PublicSnapshot,
      // 空串/纯空白必须被当作"没提供"：否则 timingSafeEqual 会把两个空 buffer 判为相等
      token: "   "
    });
    await server.start();
    cleanup.push(async () => {
      await server.close();
      await rm(root, { recursive: true, force: true });
    });

    const generated = decodeURIComponent(new URL(server.url).hash.slice(1));
    assert.ok(generated.length >= 16, "空 token 必须回退为随机 token");

    const session = await fetch(`${server.origin}/api/session`, {
      method: "POST",
      headers: { Origin: server.origin, "X-Local-Token": "" }
    });
    assert.equal(session.status, 403);
    const emptyCookie = await fetch(`${server.origin}/api/public-snapshot`, {
      headers: { Origin: server.origin, Cookie: "moyu_local=" }
    });
    assert.equal(emptyCookie.status, 401);
  });
});
