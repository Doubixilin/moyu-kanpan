import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { quickWindowBounds } from "../quickWindowBounds";

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
const size = { width: 320, height: 380 };

describe("quick window bounds", () => {
  it("opens above a bottom taskbar tray", () => {
    assert.deepEqual(
      quickWindowBounds({ x: 1880, y: 1040, width: 24, height: 24 }, workArea, size),
      { x: 1584, y: 652, width: 320, height: 380 }
    );
  });

  it("opens below a top taskbar tray", () => {
    assert.equal(
      quickWindowBounds({ x: 1880, y: 0, width: 24, height: 24 }, workArea, size).y,
      32
    );
  });

  it("stays inside a secondary display with a right taskbar", () => {
    const secondary = { x: -1280, y: 0, width: 1280, height: 984 };
    const result = quickWindowBounds(
      { x: -24, y: 940, width: 24, height: 24 },
      secondary,
      size
    );
    assert.equal(result.x, -352);
    assert.ok(result.y >= secondary.y);
    assert.ok(result.y + result.height <= secondary.y + secondary.height);
  });
});
