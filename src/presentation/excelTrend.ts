import type { DailyCandle } from "../domain/types.js";

export interface ExcelBollChartModel {
  width: number;
  height: number;
  min: number;
  max: number;
  startDate: string;
  endDate: string;
  close: string;
  upper: string;
  mid: string;
  lower: string;
  latest: DailyCandle;
  count: number;
}

export function buildExcelBollChart(
  source: DailyCandle[],
  width = 920,
  height = 350
): ExcelBollChartModel | null {
  const items = source.slice(-60);
  if (items.length < 2) return null;
  const plot = { left: 54, right: 18, top: 24, bottom: 38 };
  const values = items.flatMap((item) => [
    item.close,
    ...(item.bollUpper == null ? [] : [item.bollUpper]),
    ...(item.bollLower == null ? [] : [item.bollLower])
  ]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (index: number) => plot.left + index / (items.length - 1) * (width - plot.left - plot.right);
  const y = (value: number) => plot.top + (max - value) / (max - min || 1) * (height - plot.top - plot.bottom);
  const points = (field: "close" | "bollUpper" | "bollMid" | "bollLower") => items
    .flatMap((item, index) => item[field] == null ? [] : [`${x(index).toFixed(1)},${y(item[field]!).toFixed(1)}`])
    .join(" ");
  return {
    width,
    height,
    min,
    max,
    startDate: items[0]!.date,
    endDate: items.at(-1)!.date,
    close: points("close"),
    upper: points("bollUpper"),
    mid: points("bollMid"),
    lower: points("bollLower"),
    latest: items.at(-1)!,
    count: items.length
  };
}
