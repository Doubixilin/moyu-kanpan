import type {
  DataSource,
  LiveQuoteSource,
  ProviderHealth,
  Quote,
  QuoteQualityState
} from "../domain/types.js";
import { fetchEastmoneyQuotes } from "../providers/eastmoney.js";
import { fetchTencentQuotes } from "../providers/tencent.js";
import {
  quotesConflict,
  validateQuote,
  type QuoteValidation,
  type QuoteValidationContext
} from "./quoteQuality.js";

export type QuoteProviderName = LiveQuoteSource;
export type QuoteProvider = (codes: string[]) => Promise<Quote[]>;

export interface QuoteProviderSet {
  eastmoney: QuoteProvider;
  tencent: QuoteProvider;
}

export interface QuoteFetchResult {
  quotes: Quote[];
  source: DataSource;
  failures: string[];
  requestedCount: number;
  liveCount: number;
  fallbackCount: number;
  retainedCount: number;
  staleCount: number;
  conflictCount: number;
  missingCodes: string[];
  coverage: number;
  degraded: boolean;
  alertSafe: boolean;
  providerHealth: ProviderHealth[];
}

export interface QuoteCoordinatorOptions {
  crossCheckEvery?: number;
  recoveryProbeEvery?: number;
  recoverySuccesses?: number;
  stickyCycles?: number;
  circuitFailureThreshold?: number;
  circuitOpenCycles?: number;
  healthWindow?: number;
}

interface HealthSample {
  success: boolean;
  completeness: number;
  freshness: number;
  parseFailure: number;
  latencyMs: number;
}

interface ProviderRuntime {
  samples: HealthSample[];
  consecutiveFailures: number;
  openUntilCycle: number;
  conflictObservations: number;
  conflicts: number;
}

interface ProviderAttempt {
  source: QuoteProviderName;
  requestedCodes: string[];
  validations: Map<string, QuoteValidation>;
  latencyMs: number;
  failure: string | null;
  skipped: boolean;
}

const defaultProviders: QuoteProviderSet = {
  eastmoney: fetchEastmoneyQuotes,
  tencent: fetchTencentQuotes
};

export class QuoteCoordinator {
  private cycle = 0;
  private activeSource: QuoteProviderName | null = null;
  private lastPreferred: QuoteProviderName | null = null;
  private activeSinceCycle = 0;
  private preferredRecoverySuccesses = 0;
  private readonly lastTrusted = new Map<string, Quote>();
  private readonly runtime: Record<QuoteProviderName, ProviderRuntime> = {
    eastmoney: {
      samples: [], consecutiveFailures: 0, openUntilCycle: 0,
      conflictObservations: 0, conflicts: 0
    },
    tencent: {
      samples: [], consecutiveFailures: 0, openUntilCycle: 0,
      conflictObservations: 0, conflicts: 0
    }
  };

  constructor(
    private readonly providers: QuoteProviderSet = defaultProviders,
    private readonly options: QuoteCoordinatorOptions = {}
  ) {}

  async fetch(
    codes: string[],
    preferred: QuoteProviderName,
    context: QuoteValidationContext = { marketOpen: false }
  ): Promise<QuoteFetchResult> {
    this.cycle += 1;
    const requestedCodes = [...new Set(codes.map((code) => code.trim()).filter(Boolean))];
    if (this.lastPreferred !== preferred) {
      this.lastPreferred = preferred;
      this.activeSource = preferred;
      this.activeSinceCycle = this.cycle;
      this.preferredRecoverySuccesses = 0;
    }

    let primarySource = this.activeSource ?? preferred;
    if (this.isCircuitOpen(primarySource)) primarySource = otherSource(primarySource);
    const secondarySource = otherSource(primarySource);
    const primary = await this.attempt(primarySource, requestedCodes, context);

    const unresolved = requestedCodes.filter(
      (code) => !primary.validations.get(code)?.trusted
    );
    const crossCheckEvery = this.options.crossCheckEvery ?? 6;
    const crossCheck = crossCheckEvery > 0 && this.cycle % crossCheckEvery === 0;
    const recoveryProbeEvery = this.options.recoveryProbeEvery ?? 3;
    const stickyCycles = this.options.stickyCycles ?? 3;
    const recoveryProbe = primarySource !== preferred &&
      this.cycle - this.activeSinceCycle >= stickyCycles &&
      recoveryProbeEvery > 0 &&
      this.cycle % recoveryProbeEvery === 0;
    const secondaryCodes = crossCheck || recoveryProbe ? requestedCodes : unresolved;
    const secondary = secondaryCodes.length > 0
      ? await this.attempt(secondarySource, secondaryCodes, context)
      : emptyAttempt(secondarySource);

    const receivedAt = new Date(context.nowMs ?? Date.now()).toISOString();
    const quotes: Quote[] = [];
    const missingCodes: string[] = [];
    let liveCount = 0;
    let fallbackCount = 0;
    let retainedCount = 0;
    let staleCount = 0;
    let conflictCount = 0;

    for (const code of requestedCodes) {
      const primaryValidation = primary.validations.get(code);
      const secondaryValidation = secondary.validations.get(code);
      let selected: Quote | null = null;
      let state: QuoteQualityState | null = null;
      let reasons: string[] = [];
      const bothTrusted = Boolean(primaryValidation?.trusted && secondaryValidation?.trusted);
      const providerConflict = bothTrusted && quotesConflict(
        primaryValidation!.quote,
        secondaryValidation!.quote
      );
      if (bothTrusted) {
        this.observeConflict(primary.source, providerConflict);
        this.observeConflict(secondary.source, providerConflict);
      }

      if (providerConflict) {
        conflictCount += 1;
        state = "conflict";
        reasons = ["provider_price_conflict"];
        const retained = this.lastTrusted.get(code);
        selected = retained
          ? { ...retained, source: "local" }
          : { ...primaryValidation!.quote };
      } else if (primaryValidation?.trusted) {
        selected = { ...primaryValidation.quote };
        state = primaryValidation.quote.source === preferred ? "fresh" : "fallback";
      } else if (secondaryValidation?.trusted) {
        selected = { ...secondaryValidation.quote };
        state = secondaryValidation.quote.source === preferred ? "fresh" : "fallback";
        reasons = primaryValidation?.issues ?? ["primary_missing"];
      } else {
        const retained = this.lastTrusted.get(code);
        if (retained) {
          selected = { ...retained, source: "local" };
          state = "retained";
          reasons = [
            ...(primaryValidation?.issues ?? ["primary_missing"]),
            ...(secondaryValidation?.issues ?? ["secondary_missing"])
          ];
        } else {
          const stale = firstUsable(primaryValidation, secondaryValidation);
          if (stale) {
            selected = { ...stale.quote };
            state = "stale";
            reasons = stale.issues;
          }
        }
      }

      if (!selected || !state) {
        missingCodes.push(code);
        continue;
      }

      if (state === "fresh" || state === "fallback") {
        liveCount += 1;
        if (state === "fallback") fallbackCount += 1;
        this.lastTrusted.set(code, stripQuality(selected));
      } else if (state === "retained") {
        retainedCount += 1;
      } else if (state === "stale") {
        staleCount += 1;
      }

      const originalSource = selected.source === "eastmoney" || selected.source === "tencent"
        ? selected.source
        : this.lastTrusted.get(code)?.source;
      selected.quality = {
        state,
        receivedAt,
        reasons: [...new Set(reasons)],
        ...(originalSource === "eastmoney" || originalSource === "tencent"
          ? { originalSource }
          : {})
      };
      quotes.push(selected);
    }

    this.updateActiveSource(
      preferred,
      primary,
      secondary,
      requestedCodes.length,
      conflictCount
    );

    const failures = attemptFailures([primary, secondary]);
    const coverage = requestedCodes.length > 0 ? quotes.length / requestedCodes.length : 1;
    const source = aggregateSource(quotes);
    const degraded = fallbackCount > 0 || retainedCount > 0 || staleCount > 0 ||
      conflictCount > 0 || missingCodes.length > 0 || failures.length > 0;
    const alertSafe = requestedCodes.length > 0 &&
      liveCount === requestedCodes.length &&
      conflictCount === 0 &&
      staleCount === 0 &&
      missingCodes.length === 0;

    return {
      quotes,
      source,
      failures,
      requestedCount: requestedCodes.length,
      liveCount,
      fallbackCount,
      retainedCount,
      staleCount,
      conflictCount,
      missingCodes,
      coverage,
      degraded,
      alertSafe,
      providerHealth: this.providerHealth()
    };
  }

  private async attempt(
    source: QuoteProviderName,
    requestedCodes: string[],
    context: QuoteValidationContext
  ): Promise<ProviderAttempt> {
    if (requestedCodes.length === 0) return emptyAttempt(source);
    if (this.isCircuitOpen(source)) {
      return {
        ...emptyAttempt(source),
        requestedCodes,
        failure: "circuit open",
        skipped: true
      };
    }

    const startedAt = Date.now();
    let rawQuotes: Quote[] = [];
    let failure: string | null = null;
    try {
      rawQuotes = await this.providers[source](requestedCodes);
      if (rawQuotes.length === 0) failure = "empty response";
    } catch (error) {
      failure = errorMessage(error);
    }
    const latencyMs = Math.max(0, Date.now() - startedAt);
    const requestedSet = new Set(requestedCodes);
    const validations = new Map<string, QuoteValidation>();
    for (const quote of rawQuotes) {
      if (!requestedSet.has(quote.code) || validations.has(quote.code)) continue;
      validations.set(quote.code, validateQuote(quote, quote.code, context));
    }

    const values = [...validations.values()];
    const trustedCount = values.filter((item) => item.trusted).length;
    const completeness = requestedCodes.length > 0 ? trustedCount / requestedCodes.length : 1;
    const freshCount = values.filter((item) => !item.issues.some(isTimestampIssue)).length;
    const freshness = requestedCodes.length > 0 ? freshCount / requestedCodes.length : 1;
    const parseFailures = values.filter((item) => !item.usable).length;
    const parseFailure = values.length > 0 ? parseFailures / values.length : 0;
    this.recordAttempt(
      source,
      {
        success: failure == null && rawQuotes.length > 0,
        completeness,
        freshness,
        parseFailure,
        latencyMs
      },
      trustedCount > 0
    );

    return {
      source,
      requestedCodes,
      validations,
      latencyMs,
      failure,
      skipped: false
    };
  }

  private recordAttempt(
    source: QuoteProviderName,
    sample: HealthSample,
    operational: boolean
  ): void {
    const runtime = this.runtime[source];
    runtime.samples.push(sample);
    const healthWindow = this.options.healthWindow ?? 20;
    if (runtime.samples.length > healthWindow) runtime.samples.shift();

    if (operational) {
      runtime.consecutiveFailures = 0;
      runtime.openUntilCycle = 0;
      return;
    }

    runtime.consecutiveFailures += 1;
    const threshold = this.options.circuitFailureThreshold ?? 3;
    if (runtime.consecutiveFailures >= threshold) {
      runtime.openUntilCycle = this.cycle + (this.options.circuitOpenCycles ?? 3);
    }
  }

  private isCircuitOpen(source: QuoteProviderName): boolean {
    return this.runtime[source].openUntilCycle > this.cycle;
  }

  private observeConflict(source: QuoteProviderName, conflict: boolean): void {
    const runtime = this.runtime[source];
    runtime.conflictObservations += 1;
    if (conflict) runtime.conflicts += 1;
  }

  private updateActiveSource(
    preferred: QuoteProviderName,
    primary: ProviderAttempt,
    secondary: ProviderAttempt,
    requestedCount: number,
    conflictCount: number
  ): void {
    const primaryTrusted = trustedCount(primary);
    const secondaryTrusted = trustedCount(secondary);
    if (primary.source === preferred) {
      if (requestedCount > 0 &&
          (primary.failure != null || primaryTrusted / requestedCount < 0.5) &&
          secondaryTrusted > 0) {
        this.activeSource = secondary.source;
        this.activeSinceCycle = this.cycle;
        this.preferredRecoverySuccesses = 0;
      }
      return;
    }

    if (secondary.source !== preferred || secondary.requestedCodes.length === 0) return;
    if (secondaryTrusted === requestedCount && conflictCount === 0) {
      this.preferredRecoverySuccesses += 1;
    } else {
      this.preferredRecoverySuccesses = 0;
    }
    if (this.preferredRecoverySuccesses >= (this.options.recoverySuccesses ?? 2)) {
      this.activeSource = preferred;
      this.activeSinceCycle = this.cycle;
      this.preferredRecoverySuccesses = 0;
    }
  }

  private providerHealth(): ProviderHealth[] {
    return (["eastmoney", "tencent"] as const).map((provider) => {
      const runtime = this.runtime[provider];
      const samples = runtime.samples;
      const successRate = average(samples.map((sample) => sample.success ? 1 : 0));
      const completenessRate = average(samples.map((sample) => sample.completeness));
      const freshnessRate = average(samples.map((sample) => sample.freshness));
      const parseFailureRate = average(samples.map((sample) => sample.parseFailure));
      const latencies = samples.map((sample) => sample.latencyMs).sort((a, b) => a - b);
      const circuitState = runtime.openUntilCycle > this.cycle
        ? "open"
        : runtime.consecutiveFailures >= (this.options.circuitFailureThreshold ?? 3)
          ? "half-open"
          : "closed";
      return {
        provider,
        successRate,
        completenessRate,
        latencyP50Ms: percentile(latencies, 0.5),
        latencyP95Ms: percentile(latencies, 0.95),
        freshnessRate,
        parseFailureRate,
        conflictRate: runtime.conflictObservations > 0
          ? runtime.conflicts / runtime.conflictObservations
          : 0,
        consecutiveFailures: runtime.consecutiveFailures,
        circuitState
      };
    });
  }
}

export async function fetchQuotesWithFallback(
  codes: string[],
  preferred: QuoteProviderName,
  providers: QuoteProviderSet = defaultProviders
): Promise<QuoteFetchResult> {
  return new QuoteCoordinator(providers, { crossCheckEvery: 0 }).fetch(
    codes,
    preferred,
    { marketOpen: false }
  );
}

function firstUsable(
  ...validations: Array<QuoteValidation | undefined>
): QuoteValidation | undefined {
  return validations.find((validation) => validation?.usable && !validation.trusted);
}

function trustedCount(attempt: ProviderAttempt): number {
  return [...attempt.validations.values()].filter((item) => item.trusted).length;
}

function emptyAttempt(source: QuoteProviderName): ProviderAttempt {
  return {
    source,
    requestedCodes: [],
    validations: new Map(),
    latencyMs: 0,
    failure: null,
    skipped: false
  };
}

function attemptFailures(attempts: ProviderAttempt[]): string[] {
  const failures: string[] = [];
  for (const attempt of attempts) {
    if (attempt.requestedCodes.length === 0) continue;
    if (attempt.failure) {
      failures.push(attempt.source + ":" + attempt.failure);
      continue;
    }
    const trusted = trustedCount(attempt);
    if (trusted < attempt.requestedCodes.length) {
      failures.push(
        attempt.source + ":trusted " + trusted + "/" + attempt.requestedCodes.length
      );
    }
  }
  return failures;
}

function aggregateSource(quotes: Quote[]): DataSource {
  const liveSources = new Set(
    quotes
      .map((quote) => quote.source)
      .filter((source): source is LiveQuoteSource =>
        source === "eastmoney" || source === "tencent"
      )
  );
  if (liveSources.size > 1) return "mixed";
  if (liveSources.size === 1) return [...liveSources][0]!;
  return quotes.length > 0 ? "local" : "local";
}

function stripQuality(quote: Quote): Quote {
  const { quality: _quality, ...trusted } = quote;
  return { ...trusted };
}

function otherSource(source: QuoteProviderName): QuoteProviderName {
  return source === "eastmoney" ? "tencent" : "eastmoney";
}

function average(values: number[]): number {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function percentile(sortedValues: number[], quantile: number): number | null {
  if (sortedValues.length === 0) return null;
  const index = Math.max(0, Math.ceil(sortedValues.length * quantile) - 1);
  return sortedValues[index] ?? null;
}

function isTimestampIssue(issue: string): boolean {
  return issue === "source_stale" || issue === "missing_timestamp" ||
    issue === "invalid_timestamp" || issue === "future_timestamp";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
