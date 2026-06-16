import { describe, expect, it } from 'vitest';
import { buildFleet, sortAgents } from '../../src/core/fleet.js';
import { parseTranscript } from '../../src/core/parser.js';
import { TranscriptBuilder } from '../fixtures/builder.js';
import type { AgentSnapshot } from '../../src/core/types.js';

function workingAgent(id: string) {
  const b = new TranscriptBuilder({ sessionId: id, slug: id });
  b.prompt('go').assistant({ tools: [{ name: 'Bash', id: 'toolu_1' }], usage: { input: 100, output: 50 } });
  return b;
}
function idleAgent(id: string) {
  const b = new TranscriptBuilder({ sessionId: id, slug: id });
  b.prompt('go').assistant({ text: 'done', stopReason: 'end_turn', usage: { input: 100, output: 50 } });
  return b;
}

describe('buildFleet', () => {
  it('derives per-agent snapshots and aggregates totals', () => {
    const w = workingAgent('w1');
    const i = idleAgent('i1');
    const now = Math.max(w.clock, i.clock) + 5 * 60_000; // make idle agent stale
    const fleet = buildFleet([parseTranscript(w.build()), parseTranscript(i.build())], now);

    expect(fleet.totals.agents).toBe(2);
    expect(fleet.totals.byStatus.working).toBe(1);
    expect(fleet.totals.byStatus.idle).toBe(1);
    expect(fleet.totals.totalTokens).toBe(300);
    expect(fleet.totals.costUsd).toBeGreaterThan(0);
    expect(fleet.generatedAt).toBe(now);
  });

  it('orders agents by status priority then recency', () => {
    const agents = [
      { sessionId: 'idle', status: 'idle', lastActivityAt: 100 },
      { sessionId: 'work', status: 'working', lastActivityAt: 1 },
      { sessionId: 'err', status: 'error', lastActivityAt: 50 },
      { sessionId: 'wait', status: 'waiting', lastActivityAt: 50 },
    ] as AgentSnapshot[];
    const order = sortAgents(agents).map((a) => a.sessionId);
    expect(order).toEqual(['work', 'wait', 'err', 'idle']);
  });

  it('breaks ties by recency within the same status', () => {
    const agents = [
      { sessionId: 'a', status: 'working', lastActivityAt: 10 },
      { sessionId: 'b', status: 'working', lastActivityAt: 20 },
    ] as AgentSnapshot[];
    expect(sortAgents(agents).map((a) => a.sessionId)).toEqual(['b', 'a']);
  });

  it('produces an empty-but-valid fleet for no transcripts', () => {
    const fleet = buildFleet([], 1_000);
    expect(fleet.totals.agents).toBe(0);
    expect(fleet.totals.byStatus).toEqual({ working: 0, waiting: 0, error: 0, idle: 0 });
    expect(fleet.agents).toEqual([]);
  });
});
