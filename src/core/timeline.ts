/**
 * Unified cross-agent timeline: merge notable events from many transcripts into
 * one time-sorted stream (PRD §9 M1). Pure.
 */

import { basename } from './util.js';
import type { NormalizedEvent, ParsedTranscript, TimelineEntry } from './types.js';

export interface TimelineOptions {
  /** Keep only the most recent N entries (after sorting). */
  limit?: number;
  /** Include subagent (sidechain) events. Default true. */
  includeSidechains?: boolean;
}

function entriesFor(
  parsed: ParsedTranscript,
  events: NormalizedEvent[],
  out: TimelineEntry[],
): void {
  const sessionId = parsed.sessionId ?? 'unknown';
  const project = parsed.cwd ? basename(parsed.cwd) : undefined;
  const base = {
    sessionId,
    ...(parsed.slug !== undefined ? { slug: parsed.slug } : {}),
    ...(project !== undefined ? { project } : {}),
  };

  for (const ev of events) {
    const common = {
      ...base,
      ts: ev.ts,
      ...(ev.tsIso !== undefined ? { tsIso: ev.tsIso } : {}),
      kind: ev.kind,
    };
    switch (ev.kind) {
      case 'human_prompt':
        out.push({ ...common, label: 'prompt', isError: false });
        break;
      case 'assistant_message':
        if (ev.toolUses.length > 0) {
          for (const tu of ev.toolUses) {
            out.push({ ...common, label: `tool: ${tu.name}`, isError: false, toolName: tu.name });
          }
        } else if (ev.stopReason === 'end_turn' || ev.stopReason === 'stop_sequence') {
          out.push({ ...common, label: 'completed turn', isError: false });
        } else {
          out.push({ ...common, label: 'message', isError: false });
        }
        break;
      case 'tool_result':
        if (ev.isError) out.push({ ...common, label: 'tool error', isError: true });
        break;
      case 'system':
        if (ev.isError) {
          out.push({ ...common, label: `error: ${ev.subtype ?? 'system'}`, isError: true });
        }
        break;
      case 'turn_duration':
      case 'meta':
        break;
    }
  }
}

/** Build a merged, time-sorted timeline across all provided transcripts. */
export function buildTimeline(
  transcripts: ParsedTranscript[],
  options: TimelineOptions = {},
): TimelineEntry[] {
  const includeSidechains = options.includeSidechains ?? true;
  const out: TimelineEntry[] = [];
  for (const t of transcripts) {
    entriesFor(t, t.events, out);
    if (includeSidechains) entriesFor(t, t.sidechainEvents, out);
  }
  out.sort((a, b) => a.ts - b.ts);
  if (options.limit !== undefined && options.limit >= 0 && out.length > options.limit) {
    return out.slice(out.length - options.limit);
  }
  return out;
}
