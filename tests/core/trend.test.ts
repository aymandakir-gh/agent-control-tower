import { describe, expect, it } from 'vitest';
import { buildCostTrend, parseTranscript } from '../../src/core/index.js';
import { TranscriptBuilder } from '../fixtures/builder.js';

const MIN = 60_000;
const T0 = Date.parse('2026-06-16T10:00:00.000Z');

describe('buildCostTrend', () => {
  it('buckets cost & tokens by time with cumulative running totals', () => {
    // Two assistant turns in the same minute, one in the next minute.
    const b = new TranscriptBuilder({ startTs: T0, stepMs: 0, model: 'claude-opus-4-8' });
    b.assistant({ text: 'a', stopReason: 'end_turn', usage: { input: 1000, output: 500 } }, 10_000); // T0+10s
    b.assistant({ text: 'b', stopReason: 'end_turn', usage: { input: 1000, output: 500 } }, 20_000); // T0+30s (same min)
    b.assistant({ text: 'c', stopReason: 'end_turn', usage: { input: 1000, output: 500 } }, 60_000); // T0+90s (next min)

    const points = buildCostTrend([parseTranscript(b.build())], { bucketMs: MIN });
    expect(points).toHaveLength(2);
    // opus cost per turn = (1000*15 + 500*75)/1e6 = 0.0525
    expect(points[0].costUsd).toBeCloseTo(0.105, 6); // two turns in bucket 0
    expect(points[0].tokens).toBe(3000);
    expect(points[1].costUsd).toBeCloseTo(0.0525, 6);
    // cumulative
    expect(points[1].cumulativeUsd).toBeCloseTo(0.1575, 6);
    expect(points[1].cumulativeTokens).toBe(4500);
    // buckets aligned to bucketMs
    expect(points[0].ts % MIN).toBe(0);
    expect(points[1].ts - points[0].ts).toBe(MIN);
  });

  it('defaults to an hourly bucket', () => {
    const b = new TranscriptBuilder({ startTs: T0, stepMs: 0 });
    b.assistant({ text: 'a', stopReason: 'end_turn', usage: { input: 100, output: 100 } }, 10_000);
    b.assistant({ text: 'b', stopReason: 'end_turn', usage: { input: 100, output: 100 } }, 30 * MIN);
    const points = buildCostTrend([parseTranscript(b.build())]); // default 1h
    expect(points).toHaveLength(1);
  });

  it('skips events with no usable timestamp and non-assistant events', () => {
    // A raw assistant record without a timestamp → ts 0 → skipped.
    const noTs = JSON.stringify({
      type: 'assistant',
      sessionId: 's',
      message: { model: 'claude-opus-4-8', content: [{ type: 'text', text: 'x' }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 100 } },
    });
    const points = buildCostTrend([parseTranscript(noTs + '\n')]);
    expect(points).toHaveLength(0);
  });

  it('includes subagent activity by default, excludable via option', () => {
    const main = new TranscriptBuilder({ sessionId: 's1', startTs: T0, stepMs: 0 })
      .assistant({ text: 'm', stopReason: 'end_turn', usage: { input: 100, output: 100 } }, 5_000)
      .build();
    const side = new TranscriptBuilder({ sessionId: 's1', isSidechain: true, agentId: 'a', startTs: T0, stepMs: 0 })
      .assistant({ text: 's', stopReason: 'end_turn', usage: { input: 100, output: 100 } }, 6_000)
      .build();
    const parsed = parseTranscript(main + side);
    const withSide = buildCostTrend([parsed], { bucketMs: MIN });
    const withoutSide = buildCostTrend([parsed], { bucketMs: MIN, includeSidechains: false });
    expect(withSide[0].tokens).toBe(400);
    expect(withoutSide[0].tokens).toBe(200);
  });

  it('returns an empty series for no transcripts', () => {
    expect(buildCostTrend([])).toEqual([]);
  });
});
