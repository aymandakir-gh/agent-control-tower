/**
 * Agent state machine (PRD §6).
 *
 * `deriveAgentState` is a pure function of (parsed transcript, clock, config).
 * It walks the main-chain events once, tracks turn/tool/error structure, and
 * applies the documented precedence table to choose exactly one status.
 */

import { estimateCost, sumUsage, totalTokens } from './cost.js';
import { basename } from './util.js';
import { DEFAULT_PRICING } from './pricing.js';
import {
  DEFAULT_FSM_CONFIG,
  type AgentSnapshot,
  type AgentStatus,
  type FsmConfig,
  type NormalizedEvent,
  type ParsedTranscript,
  type PricingTable,
} from './types.js';

const MEANINGFUL = new Set<NormalizedEvent['kind']>([
  'human_prompt',
  'assistant_message',
  'tool_result',
  'turn_duration',
  'system',
]);

export interface DeriveOptions {
  config?: FsmConfig;
  pricing?: PricingTable;
}

/**
 * Mutable accumulator for the FSM walk. Folding the per-event mutations into an
 * explicit state object lets a caller advance the machine event-by-event and
 * snapshot it at any boundary (see replay's single-pass reconstruction) instead
 * of re-walking the whole prefix per snapshot. `deriveAgentState` runs the exact
 * same `stepFsm` + `finalizeFsm` over the full event list, so behavior is
 * unchanged.
 */
export interface FsmState {
  pending: Map<string, string>; // unresolved tool_use id -> tool name
  lastAssistant?: NormalizedEvent;
  lastMeaningful?: NormalizedEvent;
  model?: string;
  lastToolName?: string;
  maxTs: number;
  messageCount: number;
  assistantTurns: number;
  inTurn: boolean;
  curTurnStartTs: number;
  turnHadUnresolvedError: boolean;
  completedTurnStartTs: number;
  completedTurnEndTs: number;
  completedTurnEndedInError: boolean;
  recordedTurnDurationMs?: number;
}

/** A fresh FSM accumulator (no events consumed yet). */
export function initFsmState(): FsmState {
  return {
    pending: new Map<string, string>(),
    maxTs: 0,
    messageCount: 0,
    assistantTurns: 0,
    inTurn: false,
    curTurnStartTs: 0,
    turnHadUnresolvedError: false,
    completedTurnStartTs: 0,
    completedTurnEndTs: 0,
    completedTurnEndedInError: false,
  };
}

/** Advance the FSM by one main-chain event (mutates `s`). */
export function stepFsm(s: FsmState, ev: NormalizedEvent): void {
  if (ev.ts > s.maxTs) s.maxTs = ev.ts;
  if (MEANINGFUL.has(ev.kind)) s.lastMeaningful = ev;

  const startTurn = (ts: number): void => {
    s.inTurn = true;
    s.curTurnStartTs = ts;
    s.turnHadUnresolvedError = false;
  };

  switch (ev.kind) {
    case 'human_prompt': {
      s.messageCount++;
      startTurn(ev.ts); // a new prompt always begins a turn (handles interrupts)
      break;
    }
    case 'assistant_message': {
      s.messageCount++;
      s.assistantTurns++;
      s.lastAssistant = ev;
      s.model = ev.model;
      if (!s.inTurn) startTurn(ev.ts);
      for (const tu of ev.toolUses) {
        s.lastToolName = tu.name;
        const key = tu.id ?? `__seq_${ev.seq}_${tu.name}`;
        s.pending.set(key, tu.name);
      }
      if (ev.stopReason === 'end_turn' || ev.stopReason === 'stop_sequence') {
        s.completedTurnStartTs = s.curTurnStartTs;
        s.completedTurnEndTs = ev.ts;
        s.completedTurnEndedInError = s.turnHadUnresolvedError;
        s.inTurn = false;
        s.pending.clear(); // turn is done; any leftover pending is stale
      }
      break;
    }
    case 'tool_result': {
      if (ev.toolUseId && s.pending.has(ev.toolUseId)) {
        s.pending.delete(ev.toolUseId);
      } else if (s.pending.size > 0) {
        // No id match: resolve the oldest pending tool (FIFO heuristic).
        const first = s.pending.keys().next().value as string;
        s.pending.delete(first);
      }
      s.turnHadUnresolvedError = ev.isError;
      break;
    }
    case 'turn_duration': {
      s.recordedTurnDurationMs = ev.durationMs;
      break;
    }
    case 'system':
    case 'meta':
      break;
  }
}

/**
 * The status/reason/timing portion of a snapshot, derived purely from an FSM
 * accumulator and a clock. Cost/token accounting is handled by the caller
 * (`deriveAgentState` for the full snapshot; replay for per-frame totals).
 */
export interface FsmDerived {
  status: AgentStatus;
  reason: string;
  waitingForInput: boolean;
  currentTool?: string;
  turnStartedAt: number;
  turnDurationMs: number;
  lastActivityAt: number;
  isStale: boolean;
  messageCount: number;
  assistantTurns: number;
  model?: string;
}

/** Resolve status/reason/timing from an FSM accumulator at clock `now`. */
export function finalizeFsm(s: FsmState, now: number, config: FsmConfig): FsmDerived {
  const lastActivityAt = s.maxTs;
  const sinceActivity = now - lastActivityAt;
  const isStale = lastActivityAt > 0 && sinceActivity > config.idleMs;

  const pendingNames = [...s.pending.values()];
  const hasPending = pendingNames.length > 0;
  const interactivePending = pendingNames.some((n) => config.interactiveTools.includes(n));
  const systemErrorAtTail = s.lastMeaningful?.kind === 'system' && s.lastMeaningful.isError === true;
  const lastIsHumanPrompt = s.lastMeaningful?.kind === 'human_prompt';
  const lastAssistantStopTool =
    s.lastAssistant?.kind === 'assistant_message' && s.lastAssistant.stopReason === 'tool_use';

  // Current tool: a pending one if mid-execution, else the last tool used.
  const currentTool = hasPending ? pendingNames[pendingNames.length - 1] : s.lastToolName;

  let status: AgentStatus;
  let reason: string;
  if (s.lastMeaningful === undefined) {
    status = 'idle';
    reason = 'no agent activity in transcript';
  } else if (interactivePending) {
    status = 'waiting';
    reason = `awaiting human input (${currentTool})`;
  } else if (hasPending) {
    status = 'working';
    reason = `executing tool: ${currentTool}`;
  } else if (lastAssistantStopTool) {
    status = 'working';
    reason = 'assistant turn awaiting tool results';
  } else if (lastIsHumanPrompt) {
    status = 'working';
    reason = 'responding to new prompt';
  } else if (s.completedTurnEndedInError || systemErrorAtTail) {
    status = 'error';
    reason = systemErrorAtTail ? 'system error reported' : 'last turn ended on a tool error';
  } else if (isStale) {
    status = 'idle';
    reason = `idle — no activity for ${Math.round(sinceActivity / 1000)}s`;
  } else {
    status = 'waiting';
    reason = 'turn complete — awaiting next prompt';
  }

  // Turn timing.
  const active = s.inTurn;
  const turnStartedAt = active ? s.curTurnStartTs : s.completedTurnStartTs;
  let turnDurationMs: number;
  if (active) {
    turnDurationMs = s.curTurnStartTs > 0 ? Math.max(0, now - s.curTurnStartTs) : 0;
  } else if (s.recordedTurnDurationMs !== undefined) {
    turnDurationMs = s.recordedTurnDurationMs;
  } else if (s.completedTurnEndTs > 0 && s.completedTurnStartTs > 0) {
    turnDurationMs = Math.max(0, s.completedTurnEndTs - s.completedTurnStartTs);
  } else {
    turnDurationMs = 0;
  }

  return {
    status,
    reason,
    waitingForInput: interactivePending,
    ...(currentTool !== undefined ? { currentTool } : {}),
    turnStartedAt,
    turnDurationMs,
    lastActivityAt,
    isStale,
    messageCount: s.messageCount,
    assistantTurns: s.assistantTurns,
    ...(s.model !== undefined ? { model: s.model } : {}),
  };
}

/** Derive a full point-in-time snapshot for one agent (session). */
export function deriveAgentState(
  parsed: ParsedTranscript,
  now: number,
  options: DeriveOptions = {},
): AgentSnapshot {
  const config = options.config ?? DEFAULT_FSM_CONFIG;
  const pricing = options.pricing ?? DEFAULT_PRICING;

  // Single forward walk over the main chain, then resolve status/timing.
  const state = initFsmState();
  for (const ev of parsed.events) stepFsm(state, ev);
  const d = finalizeFsm(state, now, config);

  // Tokens & cost over main chain + subagents (true session spend).
  const allEvents = [...parsed.events, ...parsed.sidechainEvents];
  const tokens = sumUsage(allEvents);
  const cost = estimateCost(allEvents, pricing);

  const subagentIds = new Set<string>();
  for (const ev of parsed.sidechainEvents) {
    if (ev.agentId) subagentIds.add(ev.agentId);
  }

  return {
    sessionId: parsed.sessionId ?? 'unknown',
    ...(parsed.slug !== undefined ? { slug: parsed.slug } : {}),
    ...(parsed.cwd !== undefined ? { cwd: parsed.cwd } : {}),
    ...(parsed.cwd !== undefined ? { project: basename(parsed.cwd) } : {}),
    ...(parsed.gitBranch !== undefined ? { gitBranch: parsed.gitBranch } : {}),
    ...(parsed.version !== undefined ? { version: parsed.version } : {}),
    ...(d.model !== undefined ? { model: d.model } : {}),
    status: d.status,
    reason: d.reason,
    waitingForInput: d.waitingForInput,
    ...(d.currentTool !== undefined ? { currentTool: d.currentTool } : {}),
    ...(d.turnStartedAt > 0 ? { turnStartedAt: d.turnStartedAt } : {}),
    turnDurationMs: d.turnDurationMs,
    lastActivityAt: d.lastActivityAt,
    isStale: d.isStale,
    messageCount: d.messageCount,
    assistantTurns: d.assistantTurns,
    subagentCount: subagentIds.size,
    tokens,
    totalTokens: totalTokens(tokens),
    cost,
  };
}
