/**
 * Fixture-backed conformance suite for SourceAdapters (PRD §12).
 *
 * A single set of canonical scenarios (working / waiting / error / idle / cost)
 * with their EXPECTED derived semantics. Each adapter supplies the same
 * scenarios expressed in its own native dialect; the runner proves every
 * adapter derives identical state/tool/cost from `adapter.parse`. If an adapter
 * omits a scenario the suite fails — coverage is mandatory, not optional.
 */

import { describe, expect, it } from 'vitest';
import { deriveAgentState, type AgentStatus } from '../../src/core/index.js';
import type { SourceAdapter } from '../../src/sources/index.js';

export interface ScenarioCase {
  /** Native-dialect transcript text. */
  text: string;
  /** Clock (ms) to derive state at. */
  now: number;
}

export interface ScenarioExpect {
  status: AgentStatus;
  currentTool?: string;
  reasonIncludes?: string;
  /** Lower bound on estimated cost (USD) — proves usage flowed through. */
  minCostUsd?: number;
  /** Whether the cost should be a non-fallback (exact-priced) estimate. */
  costExact?: boolean;
}

/** The canonical contract every adapter must satisfy. */
export const CONFORMANCE_EXPECT: Record<string, ScenarioExpect> = {
  'working: unresolved non-interactive tool': {
    status: 'working',
    currentTool: 'Bash',
    reasonIncludes: 'Bash',
  },
  'working: assistant awaiting tool results': {
    status: 'working',
    reasonIncludes: 'tool results',
  },
  'waiting: interactive tool pending': {
    status: 'waiting',
    currentTool: 'AskUserQuestion',
    reasonIncludes: 'AskUserQuestion',
  },
  'error: tool failed then turn ended': {
    status: 'error',
    reasonIncludes: 'tool error',
  },
  'idle: completed turn long ago': {
    status: 'idle',
  },
  'waiting: completed turn recently': {
    status: 'waiting',
    reasonIncludes: 'awaiting next prompt',
  },
  'cost: opus usage is priced exactly': {
    status: 'waiting',
    minCostUsd: 0.05,
    costExact: true,
  },
};

/** Run the conformance contract against one adapter's native-dialect cases. */
export function runAdapterConformance(adapter: SourceAdapter, cases: Record<string, ScenarioCase>): void {
  describe(`SourceAdapter conformance — ${adapter.id} (${adapter.displayName})`, () => {
    for (const name of Object.keys(CONFORMANCE_EXPECT)) {
      const want = CONFORMANCE_EXPECT[name];
      it(name, () => {
        const c = cases[name];
        expect(c, `adapter "${adapter.id}" is missing scenario "${name}"`).toBeDefined();
        const parsed = adapter.parse(c.text);
        const snap = deriveAgentState(parsed, c.now);

        expect(snap.status).toBe(want.status);
        if (want.currentTool !== undefined) expect(snap.currentTool).toBe(want.currentTool);
        if (want.reasonIncludes !== undefined) expect(snap.reason).toContain(want.reasonIncludes);
        if (want.minCostUsd !== undefined) expect(snap.cost.usd).toBeGreaterThanOrEqual(want.minCostUsd);
        if (want.costExact !== undefined) expect(snap.cost.estimated).toBe(!want.costExact);
      });
    }
  });
}
