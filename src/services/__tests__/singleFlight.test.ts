import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSingleFlight } from "../singleFlight";

describe("single-flight task", () => {
  it("shares one in-flight execution across overlapping calls", async () => {
    let calls = 0;
    let resolveTask!: (value: number) => void;
    const task = createSingleFlight(async () => {
      calls += 1;
      return await new Promise<number>((resolve) => {
        resolveTask = resolve;
      });
    });

    const first = task();
    const second = task();
    assert.equal(calls, 1);

    resolveTask(42);
    assert.deepEqual(await Promise.all([first, second]), [42, 42]);

    const third = task();
    assert.equal(calls, 2);
    resolveTask(7);
    assert.equal(await third, 7);
  });
});
