import { QuoteCoordinator } from "../dist-electron/src/services/quotes.js";

const codes = (process.env.BENCHMARK_CODES ?? "600519,000001,300750,000858")
  .split(",")
  .map((code) => code.trim())
  .filter(Boolean);
const intervalMs = clamp(Number(process.env.BENCHMARK_INTERVAL_MS ?? 3_000), 3_000, 60_000);
const durationMs = clamp(
  Number(process.env.BENCHMARK_DURATION_MS ?? 60_000),
  intervalMs,
  3_600_000
);
const preferred = process.env.BENCHMARK_PROVIDER === "tencent" ? "tencent" : "eastmoney";
const coordinator = new QuoteCoordinator();
const samples = [];
let previousFingerprint = null;
const startedAt = Date.now();

while (Date.now() - startedAt < durationMs) {
  const cycleStartedAt = Date.now();
  try {
    const result = await coordinator.fetch(codes, preferred, {
      marketOpen: true,
      nowMs: cycleStartedAt,
      maxSourceAgeMs: 60_000
    });
    const fingerprint = JSON.stringify(
      result.quotes.map((quote) => [
        quote.code,
        quote.price,
        quote.changePercent,
        quote.volume,
        quote.amount
      ])
    );
    samples.push({
      at: new Date(cycleStartedAt).toISOString(),
      latencyMs: Date.now() - cycleStartedAt,
      coverage: result.coverage,
      degraded: result.degraded,
      alertSafe: result.alertSafe,
      conflictCount: result.conflictCount,
      changed: previousFingerprint !== fingerprint,
      sourceTimestamps: result.quotes.map((quote) => quote.updatedAt).filter(Boolean),
      failures: result.failures
    });
    previousFingerprint = fingerprint;
  } catch (error) {
    samples.push({
      at: new Date(cycleStartedAt).toISOString(),
      latencyMs: Date.now() - cycleStartedAt,
      coverage: 0,
      degraded: true,
      alertSafe: false,
      conflictCount: 0,
      changed: false,
      sourceTimestamps: [],
      failures: [error instanceof Error ? error.message : String(error)]
    });
  }
  const remaining = intervalMs - (Date.now() - cycleStartedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

const latencies = samples.map((sample) => sample.latencyMs).sort((a, b) => a - b);
const changedCount = samples.filter((sample) => sample.changed).length;
const failureCount = samples.filter((sample) => sample.failures.length > 0).length;
console.log(
  JSON.stringify(
    {
      startedAt: new Date(startedAt).toISOString(),
      completedAt: new Date().toISOString(),
      codes,
      preferred,
      intervalMs,
      durationMs,
      attempts: samples.length,
      successRate: samples.length > 0 ? (samples.length - failureCount) / samples.length : 0,
      averageCoverage: average(samples.map((sample) => sample.coverage)),
      changedRate: samples.length > 0 ? changedCount / samples.length : 0,
      latencyP50Ms: percentile(latencies, 0.5),
      latencyP95Ms: percentile(latencies, 0.95),
      conflicts: samples.reduce((sum, sample) => sum + sample.conflictCount, 0),
      samples
    },
    null,
    2
  )
);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? Math.round(value) : min));
}

function average(values) {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(values, quantile) {
  if (values.length === 0) return null;
  return values[Math.max(0, Math.ceil(values.length * quantile) - 1)] ?? null;
}
