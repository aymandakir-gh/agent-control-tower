import { describe, expect, it } from 'vitest';
import {
  addUsage,
  costOfUsage,
  emptyUsage,
  estimateCost,
  sumUsage,
  totalTokens,
} from '../../src/core/cost.js';
import { parseTranscript } from '../../src/core/parser.js';
import { TranscriptBuilder } from '../fixtures/builder.js';
import type { ModelPricing } from '../../src/core/types.js';

const PRICING: ModelPricing = {
  input: 15,
  output: 75,
  cacheWrite5m: 18.75,
  cacheWrite1h: 30,
  cacheRead: 1.5,
};

describe('cost primitives', () => {
  it('costOfUsage prices each category per million tokens', () => {
    const c = costOfUsage(
      { input: 1_000_000, output: 1_000_000, cacheWrite5m: 1_000_000, cacheWrite1h: 1_000_000, cacheRead: 1_000_000 },
      PRICING,
    );
    expect(c).toEqual({ input: 15, output: 75, cacheWrite5m: 18.75, cacheWrite1h: 30, cacheRead: 1.5 });
  });

  it('addUsage and totalTokens combine correctly', () => {
    const u = addUsage(
      { input: 1, output: 2, cacheWrite5m: 3, cacheWrite1h: 4, cacheRead: 5 },
      { input: 10, output: 20, cacheWrite5m: 30, cacheWrite1h: 40, cacheRead: 50 },
    );
    expect(u).toEqual({ input: 11, output: 22, cacheWrite5m: 33, cacheWrite1h: 44, cacheRead: 55 });
    expect(totalTokens(u)).toBe(165);
  });

  it('emptyUsage is all zeros and independent', () => {
    const a = emptyUsage();
    a.input = 5;
    expect(emptyUsage().input).toBe(0);
  });
});

describe('estimateCost over events', () => {
  it('sums cost across assistant turns and attributes per model', () => {
    const b = new TranscriptBuilder({ model: 'claude-opus-4-8' });
    b.assistant({ stopReason: 'end_turn', usage: { input: 1000, output: 1000 } });
    b.assistant({ stopReason: 'end_turn', usage: { output: 2000 }, model: 'claude-sonnet-4-6' });
    const parsed = parseTranscript(b.build());
    const cost = estimateCost(parsed.events);
    // opus: (1000*15 + 1000*75)/1e6 = 0.09 ; sonnet: (2000*15)/1e6 = 0.03
    expect(cost.usd).toBeCloseTo(0.12, 6);
    expect(cost.perModel['claude-opus-4-8']).toBeCloseTo(0.09, 6);
    expect(cost.perModel['claude-sonnet-4-6']).toBeCloseTo(0.03, 6);
    expect(cost.estimated).toBe(false);
  });

  it('flags estimated=true for an unknown model and uses the fallback tier', () => {
    const b = new TranscriptBuilder({ model: 'some-future-model-x' });
    b.assistant({ stopReason: 'end_turn', usage: { input: 1_000_000 } });
    const cost = estimateCost(parseTranscript(b.build()).events);
    expect(cost.estimated).toBe(true);
    expect(cost.usd).toBeCloseTo(3, 6); // sonnet fallback input rate
  });

  it('synthetic model costs nothing', () => {
    const b = new TranscriptBuilder({ model: '<synthetic>' });
    b.assistant({ stopReason: 'end_turn', usage: { input: 1_000_000, output: 1_000_000 } });
    const cost = estimateCost(parseTranscript(b.build()).events);
    expect(cost.usd).toBe(0);
    expect(cost.estimated).toBe(false);
  });

  it('ignores events without usage', () => {
    const b = new TranscriptBuilder();
    b.prompt('hi');
    expect(estimateCost(parseTranscript(b.build()).events).usd).toBe(0);
    expect(sumUsage(parseTranscript(b.build()).events)).toEqual(emptyUsage());
  });
});
