/**
 * Transcript parser: Claude Code JSONL text → normalized events.
 *
 * Pure and I/O-free (PRD §8). Robust by contract (PRD §5): never throws on
 * malformed JSON, unknown record types, missing fields, or a partially-written
 * trailing line. Bad lines are skipped and counted, not fatal.
 */

import type {
  NormalizedEvent,
  ParsedTranscript,
  ParseStats,
  TokenUsage,
  ToolUseRef,
} from './types.js';

function num(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : 0;
}

function parseTs(iso: unknown): number {
  if (typeof iso !== 'string') return 0;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

function str(x: unknown): string | undefined {
  return typeof x === 'string' ? x : undefined;
}

/** Normalize a raw `usage` object into our TokenUsage shape. */
export function normalizeUsage(usage: unknown): TokenUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const u = usage as Record<string, unknown>;
  const cc = (u.cache_creation as Record<string, unknown> | undefined) ?? {};
  let cacheWrite5m = num(cc.ephemeral_5m_input_tokens);
  const cacheWrite1h = num(cc.ephemeral_1h_input_tokens);
  // Fallback when only the aggregate is present (older/edge records).
  if (cacheWrite5m === 0 && cacheWrite1h === 0 && num(u.cache_creation_input_tokens) > 0) {
    cacheWrite5m = num(u.cache_creation_input_tokens);
  }
  return {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheWrite5m,
    cacheWrite1h,
    cacheRead: num(u.cache_read_input_tokens),
  };
}

/** Subtypes / signals that indicate a system-level error condition. */
function systemIsError(rec: Record<string, unknown>): boolean {
  if (rec.level === 'error') return true;
  if (rec.preventedContinuation === true) return true;
  if (Array.isArray(rec.hookErrors) && rec.hookErrors.length > 0) return true;
  const sub = str(rec.subtype) ?? '';
  return /error|fail/i.test(sub);
}

interface Envelope {
  seq: number;
  ts: number;
  tsIso?: string;
  uuid?: string;
  sessionId?: string;
  isSidechain: boolean;
  agentId?: string;
}

function envelope(rec: Record<string, unknown>, seq: number): Envelope {
  const tsIso = str(rec.timestamp);
  return {
    seq,
    ts: parseTs(rec.timestamp),
    ...(tsIso !== undefined ? { tsIso } : {}),
    ...(str(rec.uuid) !== undefined ? { uuid: str(rec.uuid) } : {}),
    ...(str(rec.sessionId) !== undefined ? { sessionId: str(rec.sessionId) } : {}),
    isSidechain: rec.isSidechain === true,
    ...(str(rec.agentId) !== undefined ? { agentId: str(rec.agentId) } : {}),
  };
}

function normalizeRecord(rec: Record<string, unknown>, seq: number): NormalizedEvent {
  const env = envelope(rec, seq);
  const type = str(rec.type) ?? 'unknown';
  const message = rec.message as Record<string, unknown> | undefined;

  switch (type) {
    case 'assistant': {
      const content = message?.content;
      const toolUses: ToolUseRef[] = [];
      let textLength = 0;
      let hasThinking = false;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== 'object') continue;
          const b = block as Record<string, unknown>;
          if (b.type === 'tool_use') {
            toolUses.push({
              ...(str(b.id) !== undefined ? { id: str(b.id) } : {}),
              name: str(b.name) ?? 'unknown',
            });
          } else if (b.type === 'text') {
            textLength += (str(b.text) ?? '').length;
          } else if (b.type === 'thinking') {
            hasThinking = true;
          }
        }
      } else if (typeof content === 'string') {
        textLength = content.length;
      }
      const usage = normalizeUsage(message?.usage);
      return {
        ...env,
        kind: 'assistant_message',
        model: str(message?.model) ?? 'unknown',
        ...(str(message?.stop_reason) !== undefined ? { stopReason: str(message?.stop_reason) } : {}),
        ...(usage ? { usage } : {}),
        toolUses,
        textLength,
        hasThinking,
      };
    }

    case 'user': {
      const content = message?.content;
      // Array content carrying tool_result block(s) → tool result(s).
      if (Array.isArray(content)) {
        const results = content.filter(
          (b): b is Record<string, unknown> =>
            !!b && typeof b === 'object' && (b as Record<string, unknown>).type === 'tool_result',
        );
        if (results.length > 0) {
          // Collapse to one normalized event marking error if ANY block errored.
          const first = results[0];
          const isError = results.some((r) => r.is_error === true);
          return {
            ...env,
            kind: 'tool_result',
            ...(str(first.tool_use_id) !== undefined ? { toolUseId: str(first.tool_use_id) } : {}),
            isError,
          };
        }
        // Array of text blocks with no tool_result → treat as a human prompt.
        const text = content
          .map((b) =>
            b && typeof b === 'object' && (b as Record<string, unknown>).type === 'text'
              ? (str((b as Record<string, unknown>).text) ?? '')
              : '',
          )
          .join('');
        return { ...env, kind: 'human_prompt', text };
      }
      return { ...env, kind: 'human_prompt', text: str(content) ?? '' };
    }

    case 'system': {
      const subtype = str(rec.subtype);
      if (subtype === 'turn_duration') {
        return {
          ...env,
          kind: 'turn_duration',
          durationMs: num(rec.durationMs),
          ...(rec.messageCount !== undefined ? { messageCount: num(rec.messageCount) } : {}),
        };
      }
      return {
        ...env,
        kind: 'system',
        ...(subtype !== undefined ? { subtype } : {}),
        isError: systemIsError(rec),
      };
    }

    default:
      return { ...env, kind: 'meta', recordType: type };
  }
}

/** Parse a full transcript file's text into a normalized, split-by-chain result. */
export function parseTranscript(text: string): ParsedTranscript {
  const lines = text.split('\n');
  const events: NormalizedEvent[] = [];
  const sidechainEvents: NormalizedEvent[] = [];
  const stats: ParseStats = { totalLines: 0, parsed: 0, skipped: 0 };

  let sessionId: string | undefined;
  let slug: string | undefined;
  let cwd: string | undefined;
  let gitBranch: string | undefined;
  let version: string | undefined;

  let seq = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue; // ignore blank lines (incl. trailing newline)
    stats.totalLines++;
    let rec: Record<string, unknown>;
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        stats.skipped++;
        continue;
      }
      rec = parsed as Record<string, unknown>;
    } catch {
      stats.skipped++; // malformed JSON or partially-written trailing line
      continue;
    }

    // Capture session metadata. Prefer values from main-chain records; take the
    // earliest sessionId and the latest cwd/branch/version (they can change).
    if (sessionId === undefined && str(rec.sessionId)) sessionId = str(rec.sessionId);
    if (rec.isSidechain !== true) {
      if (str(rec.slug)) slug = str(rec.slug);
      if (str(rec.cwd)) cwd = str(rec.cwd);
      if (str(rec.gitBranch)) gitBranch = str(rec.gitBranch);
      if (str(rec.version)) version = str(rec.version);
    }

    const event = normalizeRecord(rec, seq++);
    stats.parsed++;
    if (event.isSidechain) sidechainEvents.push(event);
    else events.push(event);
  }

  return {
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(slug !== undefined ? { slug } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
    ...(gitBranch !== undefined ? { gitBranch } : {}),
    ...(version !== undefined ? { version } : {}),
    events,
    sidechainEvents,
    stats,
  };
}
