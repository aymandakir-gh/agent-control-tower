/**
 * Pricing table + model resolution.
 *
 * Prices are USD per **million** tokens and are best-effort public estimates
 * (PRD §7). They are intentionally overridable: pass your own table to the cost
 * functions. agent-control-tower never claims to be an exact billing system.
 */

import type { ModelPricing, PricingTable } from './types.js';

export const ZERO_PRICING: ModelPricing = {
  input: 0,
  output: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
};

/** Default per-model rates (USD / million tokens). Estimates — override freely. */
export const DEFAULT_PRICING: PricingTable = {
  'claude-opus-4-8': { input: 15, output: 75, cacheWrite5m: 18.75, cacheWrite1h: 30, cacheRead: 1.5 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1 },
  'claude-fable-5': { input: 3, output: 15, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3 },
  '<synthetic>': ZERO_PRICING,
};

/** Family fallbacks, matched by keyword when an exact model id is unknown. */
const FAMILY_PRICING: Array<[RegExp, ModelPricing]> = [
  [/opus/i, DEFAULT_PRICING['claude-opus-4-8']],
  [/haiku/i, DEFAULT_PRICING['claude-haiku-4-5']],
  [/fable/i, DEFAULT_PRICING['claude-fable-5']],
  [/sonnet/i, DEFAULT_PRICING['claude-sonnet-4-6']],
];

/** Tier used when nothing else matches (flagged as an estimate). */
export const FALLBACK_PRICING = DEFAULT_PRICING['claude-sonnet-4-6'];

export interface ResolvedPricing {
  pricing: ModelPricing;
  /** True when we did not find an exact table entry (UIs should show "~"). */
  estimated: boolean;
}

/**
 * Resolve pricing for a model id. Tries exact match, then a normalized match
 * (strips suffixes like `[1m]` or trailing date stamps), then a family keyword,
 * and finally the fallback tier.
 */
export function resolvePricing(model: string, table: PricingTable = DEFAULT_PRICING): ResolvedPricing {
  if (model in table) return { pricing: table[model], estimated: false };

  // Normalize: drop a "[1m]" context suffix and any trailing "-<date>" stamp.
  const normalized = model
    .replace(/\[[^\]]*\]$/, '')
    .replace(/-\d{6,8}$/, '');
  if (normalized !== model && normalized in table) {
    return { pricing: table[normalized], estimated: false };
  }

  if (/synthetic/i.test(model)) return { pricing: ZERO_PRICING, estimated: false };

  for (const [pattern, pricing] of FAMILY_PRICING) {
    if (pattern.test(model)) return { pricing, estimated: true };
  }

  return { pricing: FALLBACK_PRICING, estimated: true };
}
