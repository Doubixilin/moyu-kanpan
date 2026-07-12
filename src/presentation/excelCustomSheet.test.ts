import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isEditableExcelAddress,
  normalizeExcelCustomSheet,
  sanitizeExcelCellText
} from "./excelCustomSheet";

describe("Excel custom sheet", () => {
  it("accepts only the bounded 8 by 20 editing area", () => {
    assert.equal(isEditableExcelAddress("A1"), true);
    assert.equal(isEditableExcelAddress("H20"), true);
    assert.equal(isEditableExcelAddress("I1"), false);
    assert.equal(isEditableExcelAddress("A21"), false);
  });

  it("normalizes persisted cells and keeps the work template", () => {
    const state = normalizeExcelCustomSheet({
      cells: { A4: "  跟进  事项\n完成  ", H20: "末行", I1: "越界", A21: "越界", B4: 3 }
    });
    assert.equal(state.cells.A1, "工作记录与事项安排");
    assert.equal(state.cells.A4, "跟进 事项 完成");
    assert.equal(state.cells.H20, "末行");
    assert.equal(state.cells.I1, undefined);
    assert.equal(sanitizeExcelCellText("a\tb"), "a b");
  });
});
