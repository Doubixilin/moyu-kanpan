import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ensureVisibleWindowBounds } from "../windowBounds";

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const secondary = { x: -1280, y: 0, width: 1280, height: 1024 };

describe("window bounds", () => {
  it("keeps a saved position that is visible on a secondary display", () => {
    assert.deepEqual(
      ensureVisibleWindowBounds(
        { x: -900, y: 120, width: 380, height: 520 },
        [primary, secondary],
        primary
      ),
      { x: -900, y: 120, width: 380, height: 520 }
    );
  });

  it("repairs an off-screen position by centering it on the primary display", () => {
    assert.deepEqual(
      ensureVisibleWindowBounds(
        { x: 9000, y: -5000, width: 380, height: 520 },
        [primary, secondary],
        primary
      ),
      { x: 770, y: 260, width: 380, height: 520 }
    );
  });

  it("repairs a missing position and keeps the window inside a small work area", () => {
    const small = { x: 0, y: 0, width: 320, height: 240 };
    assert.deepEqual(
      ensureVisibleWindowBounds(
        { x: null, y: null, width: 900, height: 900 },
        [small],
        small
      ),
      { x: 0, y: 0, width: 320, height: 240 }
    );
  });
});
