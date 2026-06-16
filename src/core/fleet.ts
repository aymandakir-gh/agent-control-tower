/**
 * Fleet aggregation: many transcripts → one FleetSnapshot (PRD §9 M1). Pure.
 */

import { addUsage, emptyUsage, totalTokens } from './cost.js';
import { deriveAgentState, type DeriveOptions } from './fsm.js';
import type {
  AgentSnapshot,
  AgentStatus,
  FleetSnapshot,
  FleetTotals,
  ParsedTranscript,
} from './types.js';

/** Sort priority for statuses: things that need attention first. */
const STATUS_ORDER: Record<AgentStatus, number> = {
  working: 0,
  waiting: 1,
  error: 2,
  idle: 3,
};

/**
 * Default agent ordering for boards: by status priority, then most-recently
 * active first. Frontends may re-sort.
 */
export function sortAgents(agents: AgentSnapshot[]): AgentSnapshot[] {
  return [...agents].sort((a, b) => {
    const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (s !== 0) return s;
    return b.lastActivityAt - a.lastActivityAt;
  });
}

function emptyTotals(): FleetTotals {
  return {
    agents: 0,
    byStatus: { working: 0, waiting: 0, error: 0, idle: 0 },
    tokens: emptyUsage(),
    totalTokens: 0,
    costUsd: 0,
  };
}

/** Build a fleet snapshot from parsed transcripts at clock `now`. */
export function buildFleet(
  transcripts: ParsedTranscript[],
  now: number,
  options: DeriveOptions = {},
): FleetSnapshot {
  const agents = transcripts.map((t) => deriveAgentState(t, now, options));
  const sorted = sortAgents(agents);

  const totals = emptyTotals();
  totals.agents = sorted.length;
  for (const a of sorted) {
    totals.byStatus[a.status]++;
    totals.tokens = addUsage(totals.tokens, a.tokens);
    totals.costUsd += a.cost.usd;
  }
  totals.totalTokens = totalTokens(totals.tokens);

  return { generatedAt: now, agents: sorted, totals };
}
