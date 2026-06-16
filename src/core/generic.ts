/**
 * Generic JSONL/hook transcript parser (PRD §12).
 *
 * A documented, framework-neutral line schema so agents other than Claude Code
 * (or a thin hook script) can feed the *same* core model. Pure and I/O-free, and
 * robust by the same contract as the Claude parser (PRD §5): never throws on
 * malformed JSON, unknown kinds, missing fields, or a partial trailing line.
 *
 * One JSON object per line. Recognized `kind`s and their fields:
 *   prompt        { text }
 *   assistant     { model, stop, tools:[{id,name}], usage:{input,output,...}, text, thinking }
 *   tool_result   { toolUseId, error }
 *   system        { subtype, error|level }
 *   turn_duration { durationMs, messageCount }
 * Envelope (all optional): ts (ISO), session, cwd, gitBranch, version, model,
 * slug, isSidechain, agentId, uuid. Unknown kinds become `meta` events.
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

function str(x: unknown): string | undefined {
  return typeof x === 'string' ? x : undefined;
}

function parseTs(iso: unknown): number {
  if (typeof iso !== 'string') return 0;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

/** Normalize a generic `usage` object into our TokenUsage shape. */
export function normalizeGenericUsage(usage: unknown): TokenUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const u = usage as Record<string, unknown>;
  // Per-TTL cache-write split; fall back to an aggregate `cacheWrite` → 5m tier
  // (5m is the default cache TTL), mirroring the Claude parser's behavior.
  let cacheWrite5m = num(u.cacheWrite5m);
  const cacheWrite1h = num(u.cacheWrite1h);
  if (cacheWrite5m === 0 && cacheWrite1h === 0 && num(u.cacheWrite) > 0) {
    cacheWrite5m = num(u.cacheWrite);
  }
  return {
    input: num(u.input),
    output: num(u.output),
    cacheWrite5m,
    cacheWrite1h,
    cacheRead: num(u.cacheRead),
  };
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
  const tsIso = str(rec.ts);
  return {
    seq,
    ts: parseTs(rec.ts),
    ...(tsIso !== undefined ? { tsIso } : {}),
    ...(str(rec.uuid) !== undefined ? { uuid: str(rec.uuid) } : {}),
    ...(str(rec.session) !== undefined ? { sessionId: str(rec.session) } : {}),
    isSidechain: rec.isSidechain === true,
    ...(str(rec.agentId) !== undefined ? { agentId: str(rec.agentId) } : {}),
  };
}

function genericIsError(rec: Record<string, unknown>): boolean {
  if (rec.error === true) return true;
  if (rec.level === 'error') return true;
  const sub = str(rec.subtype) ?? '';
  return /error|fail/i.test(sub);
}

/** Normalize one generic record into a normalized event. */
function normalizeRecord(rec: Record<string, unknown>, seq: number): NormalizedEvent {
  const env = envelope(rec, seq);
  const kind = str(rec.kind) ?? 'unknown';

  switch (kind) {
    case 'prompt':
      return { ...env, kind: 'human_prompt', text: str(rec.text) ?? '' };

    case 'assistant': {
      const toolUses: ToolUseRef[] = [];
      if (Array.isArray(rec.tools)) {
        for (const t of rec.tools) {
          if (!t || typeof t !== 'object') continue;
          const tt = t as Record<string, unknown>;
          toolUses.push({
            ...(str(tt.id) !== undefined ? { id: str(tt.id) } : {}),
            name: str(tt.name) ?? 'unknown',
          });
        }
      }
      const usage = normalizeGenericUsage(rec.usage);
      const text = str(rec.text) ?? '';
      return {
        ...env,
        kind: 'assistant_message',
        model: str(rec.model) ?? 'unknown',
        ...(str(rec.stop) !== undefined ? { stopReason: str(rec.stop) } : {}),
        ...(usage ? { usage } : {}),
        toolUses,
        textLength: text.length,
        hasThinking: Boolean(rec.thinking),
      };
    }

    case 'tool_result':
      return {
        ...env,
        kind: 'tool_result',
        ...(str(rec.toolUseId) !== undefined ? { toolUseId: str(rec.toolUseId) } : {}),
        isError: rec.error === true,
      };

    case 'turn_duration':
      return {
        ...env,
        kind: 'turn_duration',
        durationMs: num(rec.durationMs),
        ...(rec.messageCount !== undefined ? { messageCount: num(rec.messageCount) } : {}),
      };

    case 'system': {
      const subtype = str(rec.subtype);
      return {
        ...env,
        kind: 'system',
        ...(subtype !== undefined ? { subtype } : {}),
        isError: genericIsError(rec),
      };
    }

    default:
      return { ...env, kind: 'meta', recordType: kind };
  }
}

/** Parse generic JSONL transcript text into a normalized, split-by-chain result. */
export function parseGenericTranscript(text: string): ParsedTranscript {
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
    if (trimmed === '') continue;
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
      stats.skipped++;
      continue;
    }

    if (sessionId === undefined && str(rec.session)) sessionId = str(rec.session);
    if (rec.isSidechain !== true) {
      if (str(rec.slug)) slug = str(rec.slug);
      if (str(rec.cwd)) cwd = str(rec.cwd);
      if (str(rec.gitBranch)) gitBranch = str(rec.gitBranch);
      if (str(rec.version)) version = str(rec.version);
    }

    const event = normalizeRecord(rec, seq);
    seq += 1;
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
