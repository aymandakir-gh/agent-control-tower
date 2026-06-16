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

/** Derive a full point-in-time snapshot for one agent (session). */
export function deriveAgentState(
  parsed: ParsedTranscript,
  now: number,
  options: DeriveOptions = {},
): AgentSnapshot {
  const config = options.config ?? DEFAULT_FSM_CONFIG;
  const pricing = options.pricing ?? DEFAULT_PRICING;
  const events = parsed.events;

  // Walk state.
  const pending = new Map<string, string>(); // unresolved tool_use id -> tool name
  let lastAssistant: NormalizedEvent | undefined;
  let lastMeaningful: NormalizedEvent | undefined;
  let model: string | undefined;
  let lastToolName: string | undefined;
  let maxTs = 0;
  let messageCount = 0;
  let assistantTurns = 0;

  let inTurn = false;
  let curTurnStartTs = 0;
  let turnHadUnresolvedError = false;
  let completedTurnStartTs = 0;
  let completedTurnEndTs = 0;
  let completedTurnEndedInError = false;
  let recordedTurnDurationMs: number | undefined;

  const startTurn = (ts: number): void => {
    inTurn = true;
    curTurnStartTs = ts;
    turnHadUnresolvedError = false;
  };

  for (const ev of events) {
    if (ev.ts > maxTs) maxTs = ev.ts;
    if (MEANINGFUL.has(ev.kind)) lastMeaningful = ev;

    switch (ev.kind) {
      case 'human_prompt': {
        messageCount++;
        startTurn(ev.ts); // a new prompt always begins a turn (handles interrupts)
        break;
      }
      case 'assistant_message': {
        messageCount++;
        assistantTurns++;
        lastAssistant = ev;
        model = ev.model;
        if (!inTurn) startTurn(ev.ts);
        for (const tu of ev.toolUses) {
          lastToolName = tu.name;
          const key = tu.id ?? `__seq_${ev.seq}_${tu.name}`;
          pending.set(key, tu.name);
        }
        if (ev.stopReason === 'end_turn' || ev.stopReason === 'stop_sequence') {
          completedTurnStartTs = curTurnStartTs;
          completedTurnEndTs = ev.ts;
          completedTurnEndedInError = turnHadUnresolvedError;
          inTurn = false;
          pending.clear(); // turn is done; any leftover pending is stale
        }
        break;
      }
      case 'tool_result': {
        if (ev.toolUseId && pending.has(ev.toolUseId)) {
          pending.delete(ev.toolUseId);
        } else if (pending.size > 0) {
          // No id match: resolve the oldest pending tool (FIFO heuristic).
          const first = pending.keys().next().value as string;
          pending.delete(first);
        }
        turnHadUnresolvedError = ev.isError;
        break;
      }
      case 'turn_duration': {
        recordedTurnDurationMs = ev.durationMs;
        break;
      }
      case 'system':
      case 'meta':
        break;
    }
  }

  const lastActivityAt = maxTs;
  const sinceActivity = now - lastActivityAt;
  const isStale = lastActivityAt > 0 && sinceActivity > config.idleMs;

  const pendingNames = [...pending.values()];
  const hasPending = pendingNames.length > 0;
  const interactivePending = pendingNames.some((n) => config.interactiveTools.includes(n));
  const systemErrorAtTail = lastMeaningful?.kind === 'system' && lastMeaningful.isError === true;
  const lastIsHumanPrompt = lastMeaningful?.kind === 'human_prompt';
  const lastAssistantStopTool =
    lastAssistant?.kind === 'assistant_message' && lastAssistant.stopReason === 'tool_use';

  // Current tool: a pending one if mid-execution, else the last tool used.
  const currentTool = hasPending ? pendingNames[pendingNames.length - 1] : lastToolName;

  let status: AgentStatus;
  let reason: string;
  if (lastMeaningful === undefined) {
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
  } else if (completedTurnEndedInError || systemErrorAtTail) {
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
  const active = inTurn;
  const turnStartedAt = active ? curTurnStartTs : completedTurnStartTs;
  let turnDurationMs: number;
  if (active) {
    turnDurationMs = curTurnStartTs > 0 ? Math.max(0, now - curTurnStartTs) : 0;
  } else if (recordedTurnDurationMs !== undefined) {
    turnDurationMs = recordedTurnDurationMs;
  } else if (completedTurnEndTs > 0 && completedTurnStartTs > 0) {
    turnDurationMs = Math.max(0, completedTurnEndTs - completedTurnStartTs);
  } else {
    turnDurationMs = 0;
  }

  // Tokens & cost over main chain + subagents (true session spend).
  const allEvents = [...events, ...parsed.sidechainEvents];
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
    ...(model !== undefined ? { model } : {}),
    status,
    reason,
    ...(currentTool !== undefined ? { currentTool } : {}),
    ...(turnStartedAt > 0 ? { turnStartedAt } : {}),
    turnDurationMs,
    lastActivityAt,
    isStale,
    messageCount,
    assistantTurns,
    subagentCount: subagentIds.size,
    tokens,
    totalTokens: totalTokens(tokens),
    cost,
  };
}
