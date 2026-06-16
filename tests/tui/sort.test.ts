import { describe, expect, it } from 'vitest';
import { nextSort, SORT_CYCLE, sortAgentsBy } from '../../src/tui/sort.js';
import type { AgentSnapshot } from '../../src/core/index.js';

const mk = (over: Partial<AgentSnapshot>): AgentSnapshot =>
  ({
    sessionId: 's',
    status: 'idle',
    reason: '',
    turnDurationMs: 0,
    lastActivityAt: 0,
    isStale: false,
    messageCount: 0,
    assistantTurns: 0,
    subagentCount: 0,
    tokens: { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 },
    totalTokens: 0,
    cost: { usd: 0, estimated: false, breakdown: { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 }, perModel: {} },
    ...over,
  }) as AgentSnapshot;

describe('sortAgentsBy', () => {
  const agents = [
    mk({ sessionId: 'a', turnDurationMs: 10, cost: { usd: 5 } as AgentSnapshot['cost'], project: 'zeta' }),
    mk({ sessionId: 'b', turnDurationMs: 50, cost: { usd: 1 } as AgentSnapshot['cost'], project: 'alpha' }),
  ];

  it('sorts by duration desc', () => {
    expect(sortAgentsBy(agents, 'duration').map((a) => a.sessionId)).toEqual(['b', 'a']);
  });
  it('sorts by cost desc', () => {
    expect(sortAgentsBy(agents, 'cost').map((a) => a.sessionId)).toEqual(['a', 'b']);
  });
  it('sorts by project asc', () => {
    expect(sortAgentsBy(agents, 'project').map((a) => a.sessionId)).toEqual(['b', 'a']);
  });
  it('does not mutate the input', () => {
    const copy = [...agents];
    sortAgentsBy(agents, 'duration');
    expect(agents).toEqual(copy);
  });
});

describe('nextSort', () => {
  it('cycles through all sort keys', () => {
    let k = SORT_CYCLE[0];
    const seen = new Set([k]);
    for (let i = 0; i < SORT_CYCLE.length; i++) {
      k = nextSort(k);
      seen.add(k);
    }
    expect(seen.size).toBe(SORT_CYCLE.length);
    expect(nextSort(SORT_CYCLE[SORT_CYCLE.length - 1])).toBe(SORT_CYCLE[0]);
  });
});
