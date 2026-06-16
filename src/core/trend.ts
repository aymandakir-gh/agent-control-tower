/**
 * Cost & token trend over time (PRD §14). Pure: bucket assistant `usage` by
 * timestamp across the fleet and produce a cumulative series for charts.
 * Derived entirely from stored transcripts — no live collection needed.
 */

import { estimateCost } from './cost.js';
import { DEFAULT_PRICING } from './pricing.js';
import type { NormalizedEvent, ParsedTranscript, PricingTable } from './types.js';

export interface TrendPoint {
  /** Bucket start (epoch ms), aligned to `bucketMs`. */
  ts: number;
  /** Cost (USD) within this bucket. */
  costUsd: number;
  /** Tokens within this bucket. */
  tokens: number;
  /** Running cumulative cost up to and including this bucket. */
  cumulativeUsd: number;
  /** Running cumulative tokens up to and including this bucket. */
  cumulativeTokens: number;
}

export interface TrendOptions {
  /** Bucket width in ms. Default 1 hour. */
  bucketMs?: number;
  pricing?: PricingTable;
  /** Include subagent (sidechain) activity. Default true. */
  includeSidechains?: boolean;
}

const HOUR = 3_600_000;

function tokensOf(ev: NormalizedEvent): number {
  if (ev.kind !== 'assistant_message' || !ev.usage) return 0;
  const u = ev.usage;
  return u.input + u.output + u.cacheWrite5m + u.cacheWrite1h + u.cacheRead;
}

/**
 * Build a sparse, time-bucketed cumulative cost/token series across transcripts.
 * Only buckets that contain assistant activity are emitted (sorted ascending);
 * events without a usable timestamp (ts ≤ 0) are skipped.
 */
export function buildCostTrend(transcripts: ParsedTranscript[], options: TrendOptions = {}): TrendPoint[] {
  const bucketMs = options.bucketMs && options.bucketMs > 0 ? options.bucketMs : HOUR;
  const pricing = options.pricing ?? DEFAULT_PRICING;
  const includeSidechains = options.includeSidechains ?? true;

  const costByBucket = new Map<number, number>();
  const tokensByBucket = new Map<number, number>();

  const consume = (events: NormalizedEvent[]): void => {
    for (const ev of events) {
      if (ev.kind !== 'assistant_message' || !ev.usage || ev.ts <= 0) continue;
      const bucket = Math.floor(ev.ts / bucketMs) * bucketMs;
      const usd = estimateCost([ev], pricing).usd;
      costByBucket.set(bucket, (costByBucket.get(bucket) ?? 0) + usd);
      tokensByBucket.set(bucket, (tokensByBucket.get(bucket) ?? 0) + tokensOf(ev));
    }
  };

  for (const t of transcripts) {
    consume(t.events);
    if (includeSidechains) consume(t.sidechainEvents);
  }

  const buckets = [...costByBucket.keys()].sort((a, b) => a - b);
  let cumUsd = 0;
  let cumTokens = 0;
  return buckets.map((ts) => {
    const costUsd = costByBucket.get(ts) ?? 0;
    const tokens = tokensByBucket.get(ts) ?? 0;
    cumUsd += costUsd;
    cumTokens += tokens;
    return { ts, costUsd, tokens, cumulativeUsd: cumUsd, cumulativeTokens: cumTokens };
  });
}
