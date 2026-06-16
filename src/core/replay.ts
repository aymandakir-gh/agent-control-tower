/**
 * Session replay (PRD §14). Pure: reconstruct a past session's state-over-time
 * and its own timeline purely from the stored transcript.
 *
 * A `ReplayFrame` is the derived agent state *as of* a given event — re-running
 * the (already tested) FSM at each meaningful event boundary. This re-renders a
 * session's history from data on disk, no live process required.
 */

import { deriveAgentState, type DeriveOptions } from './fsm.js';
import { buildTimeline } from './timeline.js';
import { basename } from './util.js';
import type {
  AgentStatus,
  NormalizedEvent,
  ParsedTranscript,
  TimelineEntry,
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
  const out: number[] = [];
  const step = (meaningful.length - 1) / (maxFrames - 1);
  for (let i = 0; i < maxFrames; i++) out.push(meaningful[Math.round(i * step)]);
  // de-dup (rounding can collide) while preserving order
  return out.filter((v, i) => i === 0 || v !== out[i - 1]);
}

/**
 * Reconstruct a session's replay from its parsed transcript. Each frame is the
 * agent state derived at a meaningful event's timestamp; cost/tokens accumulate
 * over the main chain + any subagent activity up to that moment.
 */
export function buildSessionReplay(parsed: ParsedTranscript, options: ReplayOptions = {}): SessionReplay {
  const maxFrames = options.maxFrames ?? 1000;
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

  const frames: ReplayFrame[] = [];
  for (const i of chosen) {
    const ev = events[i];
    const frameTs = ev.ts;
    const subParsed: ParsedTranscript = {
      ...parsed,
      events: events.slice(0, i + 1),
      // Subagent activity that had happened by this moment contributes to cost.
      sidechainEvents: parsed.sidechainEvents.filter((s) => s.ts <= frameTs),
    };
    const snap = deriveAgentState(subParsed, frameTs, deriveOpts);
    frames.push({
      seq: ev.seq,
      ts: ev.ts,
      ...(ev.tsIso !== undefined ? { tsIso: ev.tsIso } : {}),
      status: snap.status,
      reason: snap.reason,
      ...(snap.currentTool !== undefined ? { currentTool: snap.currentTool } : {}),
      turnDurationMs: snap.turnDurationMs,
      messageCount: snap.messageCount,
      totalTokens: snap.totalTokens,
      costUsd: snap.cost.usd,
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
