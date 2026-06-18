/**
 * Session replay (PRD §14). Pure: reconstruct a past session's state-over-time
 * and its own timeline purely from the stored transcript.
 *
 * A `ReplayFrame` is the derived agent state *as of* a given event — re-running
 * the (already tested) FSM at each meaningful event boundary. This re-renders a
 * session's history from data on disk, no live process required.
 */

import {
  deriveAgentState,
  finalizeFsm,
  initFsmState,
  stepFsm,
  type DeriveOptions,
} from './fsm.js';
import { addUsage, costOfUsage, emptyUsage, totalTokens } from './cost.js';
import { DEFAULT_FSM_CONFIG } from './types.js';
import { DEFAULT_PRICING, resolvePricing } from './pricing.js';
import { buildTimeline } from './timeline.js';
import { basename } from './util.js';
import type {
  AgentStatus,
  CostBreakdown,
  NormalizedEvent,
  ParsedTranscript,
  TimelineEntry,
  TokenUsage,
} from './types.js';

const MEANINGFUL = new Set<NormalizedEvent['kind']>([
  'human_prompt',
  'assistant_message',
  'tool_result',
  'turn_duration',
  'system',
]);

export interface ReplayFrame {
  /** Sequence index of the event that produced this frame. */
  seq: number;
  ts: number;
  tsIso?: string;
  status: AgentStatus;
  reason: string;
  currentTool?: string;
  turnDurationMs: number;
  messageCount: number;
  totalTokens: number;
  costUsd: number;
  /** Short label of the event at this frame (e.g. "tool: Bash"). */
  event: string;
}

export interface SessionReplay {
  sessionId: string;
  slug?: string;
  project?: string;
  cwd?: string;
  frames: ReplayFrame[];
  timeline: TimelineEntry[];
  startedAt: number;
  endedAt: number;
  durationMs: number;
  finalStatus: AgentStatus;
  totalTokens: number;
  totalCostUsd: number;
}

export interface ReplayOptions extends DeriveOptions {
  /** Cap the number of frames (evenly sampled, last always kept). Default 1000. */
  maxFrames?: number;
}

/** A short human label for the event that produced a frame. */
export function eventLabel(ev: NormalizedEvent): string {
  switch (ev.kind) {
    case 'human_prompt':
      return 'prompt';
    case 'assistant_message':
      if (ev.toolUses.length > 0) return `tool: ${ev.toolUses.map((t) => t.name).join('+')}`;
      if (ev.stopReason === 'end_turn' || ev.stopReason === 'stop_sequence') return 'completed turn';
      return 'message';
    case 'tool_result':
      return ev.isError ? 'tool error' : 'tool result';
    case 'turn_duration':
      return 'turn duration';
    case 'system':
      return ev.isError ? `error: ${ev.subtype ?? 'system'}` : (ev.subtype ?? 'system');
    case 'meta':
      return ev.recordType;
  }
}

/** Pick the indices of meaningful events to emit as frames (even sampling). */
function frameIndices(meaningful: number[], maxFrames: number): number[] {
  if (meaningful.length <= maxFrames) return meaningful;
  // Degenerate caps. maxFrames < 1 → no frames; maxFrames === 1 → just the final
  // frame (preserves "last always kept"). Avoids the (maxFrames-1) div-by-zero below.
  if (maxFrames < 1) return [];
  if (maxFrames === 1) return meaningful.length > 0 ? [meaningful[meaningful.length - 1]] : [];
  const out: number[] = [];
  const step = (meaningful.length - 1) / (maxFrames - 1);
  for (let i = 0; i < maxFrames; i++) out.push(meaningful[Math.round(i * step)]);
  // de-dup (rounding can collide) while preserving order
  return out.filter((v, i) => i === 0 || v !== out[i - 1]);
}

/** Per-category USD cost of one assistant_message's usage (priced by its model). */
function eventCost(ev: NormalizedEvent, pricing: typeof DEFAULT_PRICING): CostBreakdown {
  if (ev.kind !== 'assistant_message' || !ev.usage) return EMPTY_BREAKDOWN;
  return costOfUsage(ev.usage, resolvePricing(ev.model, pricing).pricing);
}

const EMPTY_BREAKDOWN: CostBreakdown = {
  input: 0,
  output: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
};

function addBreakdown(a: CostBreakdown, b: CostBreakdown): CostBreakdown {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
    cacheRead: a.cacheRead + b.cacheRead,
  };
}

function sumBreakdown(b: CostBreakdown): number {
  return b.input + b.output + b.cacheWrite5m + b.cacheWrite1h + b.cacheRead;
}

/**
 * Reconstruct a session's replay from its parsed transcript. Each frame is the
 * agent state derived at a meaningful event's timestamp; cost/tokens accumulate
 * over the main chain + any subagent activity up to that moment.
 *
 * Built in a single forward pass: the FSM is advanced one event at a time and
 * snapshotted at each chosen frame, with the main-chain cost/tokens carried as
 * running accumulators instead of re-deriving from event 0 every frame. This
 * turns the previous O(events × frames) reconstruction into O(events) (plus the
 * usually-tiny subagent set), with byte-identical output.
 */
export function buildSessionReplay(parsed: ParsedTranscript, options: ReplayOptions = {}): SessionReplay {
  const maxFrames = options.maxFrames ?? 1000;
  const config = options.config ?? DEFAULT_FSM_CONFIG;
  const pricing = options.pricing ?? DEFAULT_PRICING;
  const deriveOpts: DeriveOptions = {
    ...(options.config ? { config: options.config } : {}),
    ...(options.pricing ? { pricing: options.pricing } : {}),
  };
  const events = parsed.events;

  const meaningfulIdx: number[] = [];
  for (let i = 0; i < events.length; i++) {
    if (MEANINGFUL.has(events[i].kind)) meaningfulIdx.push(i);
  }
  const chosen = frameIndices(meaningfulIdx, maxFrames);
  // `chosen` is sorted ascending; walk events once and emit at each boundary.
  const chosenSet = new Set(chosen);

  // Pre-cost the contributing subagent events ONCE, kept in original array order
  // and gated by timestamp per frame. The old code re-spread + re-summed
  // `sidechainEvents.filter(s => s.ts <= frameTs)` for every frame; doing the
  // pricing once (and folding in the same original order) keeps costUsd
  // byte-identical despite floating-point non-associativity. Subagent activity
  // is a small minority of events, so this stays well within the linear budget.
  const sideContribs = parsed.sidechainEvents.map((s) => ({
    ts: s.ts,
    usage: s.kind === 'assistant_message' ? s.usage : undefined,
    cost: eventCost(s, pricing),
  }));

  const state = initFsmState();
  let mainUsage: TokenUsage = emptyUsage();
  let mainBreakdown: CostBreakdown = EMPTY_BREAKDOWN;

  const frames: ReplayFrame[] = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    stepFsm(state, ev);
    if (ev.kind === 'assistant_message' && ev.usage) {
      mainUsage = addUsage(mainUsage, ev.usage);
      mainBreakdown = addBreakdown(mainBreakdown, eventCost(ev, pricing));
    }
    if (!chosenSet.has(i)) continue;

    const frameTs = ev.ts;
    // Subagent activity up to this moment, folded in original order on top of
    // the running main-chain totals — matching the old concatenation exactly.
    let tokens = mainUsage;
    let combined = mainBreakdown;
    for (const s of sideContribs) {
      if (s.ts > frameTs) continue;
      if (s.usage) tokens = addUsage(tokens, s.usage);
      combined = addBreakdown(combined, s.cost);
    }
    const snap = finalizeFsm(state, frameTs, config);
    frames.push({
      seq: ev.seq,
      ts: ev.ts,
      ...(ev.tsIso !== undefined ? { tsIso: ev.tsIso } : {}),
      status: snap.status,
      reason: snap.reason,
      ...(snap.currentTool !== undefined ? { currentTool: snap.currentTool } : {}),
      turnDurationMs: snap.turnDurationMs,
      messageCount: snap.messageCount,
      totalTokens: totalTokens(tokens),
      costUsd: sumBreakdown(combined),
      event: eventLabel(ev),
    });
  }

  // Final state at the last event (covers the whole transcript).
  const lastTs = events.length > 0 ? events[events.length - 1].ts : 0;
  const final = deriveAgentState(parsed, lastTs, deriveOpts);
  const startedAt = frames.length > 0 ? frames[0].ts : 0;
  const endedAt = lastTs;
  const timeline = buildTimeline([parsed]);

  return {
    sessionId: parsed.sessionId ?? 'unknown',
    ...(parsed.slug !== undefined ? { slug: parsed.slug } : {}),
    ...(parsed.cwd !== undefined ? { project: basename(parsed.cwd) } : {}),
    ...(parsed.cwd !== undefined ? { cwd: parsed.cwd } : {}),
    frames,
    timeline,
    startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt - startedAt),
    finalStatus: final.status,
    totalTokens: final.totalTokens,
    totalCostUsd: final.cost.usd,
  };
}
