export interface ExcelCustomSheetState {
  cells: Record<string, string>;
}

const ADDRESS_PATTERN = /^([A-H])(\d{1,2})$/;

export function defaultExcelCustomSheet(): ExcelCustomSheetState {
  return {
    cells: {
      A1: "工作记录与事项安排",
      A3: "日期",
      B3: "事项",
      C3: "进展",
      D3: "下一步",
      E3: "备注"
    }
  };
}

export function normalizeExcelCustomSheet(value: unknown): ExcelCustomSheetState {
  const defaults = defaultExcelCustomSheet();
  if (!value || typeof value !== "object") return defaults;
  const rawCells = (value as { cells?: unknown }).cells;
  if (!rawCells || typeof rawCells !== "object" || Array.isArray(rawCells)) return defaults;
  const cells: Record<string, string> = {};
  for (const [address, rawValue] of Object.entries(rawCells)) {
    if (!isEditableExcelAddress(address) || typeof rawValue !== "string") continue;
    const text = sanitizeExcelCellText(rawValue);
    if (text) cells[address] = text;
  }
  return { cells: { ...defaults.cells, ...cells } };
}

export function isEditableExcelAddress(address: string): boolean {
  const match = ADDRESS_PATTERN.exec(address);
  if (!match) return false;
  const row = Number(match[2]);
  return row >= 1 && row <= 20;
}

export function sanitizeExcelCellText(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 120);
}
