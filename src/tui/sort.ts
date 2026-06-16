/** Pure agent sorting for the board, by the active sort key. */

import { sortAgents, type AgentSnapshot } from '../core/index.js';
import type { SortKey } from './Board.js';

export function sortAgentsBy(agents: AgentSnapshot[], key: SortKey): AgentSnapshot[] {
  switch (key) {
    case 'duration':
      return [...agents].sort((a, b) => b.turnDurationMs - a.turnDurationMs);
    case 'cost':
      return [...agents].sort((a, b) => b.cost.usd - a.cost.usd);
    case 'project':
      return [...agents].sort((a, b) =>
        (a.project ?? a.slug ?? a.sessionId).localeCompare(b.project ?? b.slug ?? b.sessionId),
      );
    case 'status':
    default:
      return sortAgents(agents);
  }
}

export const SORT_CYCLE: SortKey[] = ['status', 'duration', 'cost', 'project'];

export function nextSort(key: SortKey): SortKey {
  const i = SORT_CYCLE.indexOf(key);
  return SORT_CYCLE[(i + 1) % SORT_CYCLE.length];
}
