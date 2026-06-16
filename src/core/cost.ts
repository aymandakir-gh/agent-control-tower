/**
 * Cost estimator (PRD §7). Pure: sums `usage` across assistant turns and prices
 * each by model. Cost is a clearly-labelled estimate, never exact billing.
 */

import { DEFAULT_PRICING, resolvePricing } from './pricing.js';
import type {
  CostBreakdown,
  CostEstimate,
  ModelPricing,
  NormalizedEvent,
  PricingTable,
  TokenUsage,
} from './types.js';
import { EMPTY_TOKEN_USAGE } from './types.js';

const PER_MILLION = 1_000_000;

export function emptyUsage(): TokenUsage {
  return { ...EMPTY_TOKEN_USAGE };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
    cacheRead: a.cacheRead + b.cacheRead,
  };
}

export function totalTokens(u: TokenUsage): number {
  return u.input + u.output + u.cacheWrite5m + u.cacheWrite1h + u.cacheRead;
}

/** Cost (USD) of a single usage block priced by one model's rates. */
export function costOfUsage(usage: TokenUsage, pricing: ModelPricing): CostBreakdown {
  return {
    input: (usage.input * pricing.input) / PER_MILLION,
    output: (usage.output * pricing.output) / PER_MILLION,
    cacheWrite5m: (usage.cacheWrite5m * pricing.cacheWrite5m) / PER_MILLION,
    cacheWrite1h: (usage.cacheWrite1h * pricing.cacheWrite1h) / PER_MILLION,
    cacheRead: (usage.cacheRead * pricing.cacheRead) / PER_MILLION,
  };
}

function addBreakdown(a: CostBreakdown, b: CostBreakdown): CostBreakdown {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
    cacheRead: a.cacheRead + b.cacheRead,
  };
}

function sumBreakdown(b: CostBreakdown): number {
  return b.input + b.output + b.cacheWrite5m + b.cacheWrite1h + b.cacheRead;
}

const emptyBreakdown = (): CostBreakdown => ({
  input: 0,
  output: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
});

/**
 * Estimate total cost across a list of normalized events. Only
 * `assistant_message` events with `usage` contribute. Returns a breakdown by
 * category, a per-model attribution, and an `estimated` flag set true when any
 * contributing model fell back to a non-exact price.
 */
export function estimateCost(
  events: NormalizedEvent[],
  table: PricingTable = DEFAULT_PRICING,
): CostEstimate {
  let breakdown = emptyBreakdown();
  const perModel: Record<string, number> = {};
  let estimated = false;

  for (const ev of events) {
    if (ev.kind !== 'assistant_message' || !ev.usage) continue;
    const { pricing, estimated: isEst } = resolvePricing(ev.model, table);
    if (isEst) estimated = true;
    const c = costOfUsage(ev.usage, pricing);
    breakdown = addBreakdown(breakdown, c);
    const modelCost = sumBreakdown(c);
    perModel[ev.model] = (perModel[ev.model] ?? 0) + modelCost;
  }

  return {
    usd: sumBreakdown(breakdown),
    estimated,
    breakdown,
    perModel,
  };
}

/** Sum token usage across assistant messages. */
export function sumUsage(events: NormalizedEvent[]): TokenUsage {
  let acc = emptyUsage();
  for (const ev of events) {
    if (ev.kind === 'assistant_message' && ev.usage) acc = addUsage(acc, ev.usage);
  }
  return acc;
}
