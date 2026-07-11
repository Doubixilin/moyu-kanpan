import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchWithTimeout } from "../fetch";

describe("fetchWithTimeout", () => {
  it("aborts a request that exceeds the configured timeout", async () => {
    const hangingFetch: typeof fetch = async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });

    await assert.rejects(
      fetchWithTimeout(hangingFetch, "https://example.com", {}, 5),
      /timed out after 5ms/
    );
  });

  it("keeps the timeout active until the response body finishes", async () => {
    const stalledBodyFetch: typeof fetch = async (_input, init) => {
      return {
        json: async () => await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        })
      } as Response;
    };

    const response = await fetchWithTimeout(stalledBodyFetch, "https://example.com", {}, 5);
    await assert.rejects(response.json(), /timed out after 5ms/);
  });

  it("preserves native Response getters that use private state", async () => {
    const response = await fetchWithTimeout(
      async () => new Response("ok", { status: 200 }),
      "https://example.com",
      {},
      100
    );
    assert.equal(response.ok, true);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
  });
});
