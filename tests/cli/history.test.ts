import { describe, expect, it } from 'vitest';
import { renderHistoryText } from '../../src/cli/history.js';
import type { HistorySample } from '../../src/history/store.js';

const mk = (ts: number, over: Partial<HistorySample> = {}): HistorySample => ({
  ts,
  agents: 3,
  byStatus: { working: 1, waiting: 1, error: 0, idle: 1 },
  totalTokens: 1000,
  costUsd: 0.5,
  alerts: 1,
  ...over,
});

describe('renderHistoryText', () => {
  it('shows a guiding empty state', () => {
    const text = renderHistoryText([], '/tmp/h.jsonl', false);
    expect(text).toContain('fleet history');
    expect(text).toContain('No history recorded yet');
    expect(text).toContain('scan --record');
  });

  it('renders a table with a delta summary', () => {
    const samples = [
      mk(Date.parse('2026-06-16T10:00:00Z'), { totalTokens: 1000, costUsd: 0.5 }),
      mk(Date.parse('2026-06-16T11:00:00Z'), { totalTokens: 3000, costUsd: 2.0 }),
    ];
    const text = renderHistoryText(samples, '/tmp/h.jsonl', false);
    expect(text).toContain('2026-06-16 10:00:00');
    expect(text).toContain('AGENTS');
    expect(text).toContain('2 samples');
    expect(text).toContain('Δcost');
  });
});
