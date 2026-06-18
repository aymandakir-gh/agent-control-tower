/**
 * Source layer: discover and read agent transcripts from disk, then build the
 * fleet + timeline view the frontends render.
 *
 * THIS LAYER IS STRICTLY READ-ONLY on the scanned root. It never writes, moves,
 * or deletes anything there (PRD §4 non-goals, §11). Concrete on-disk dialects
 * are handled by pluggable {@link SourceAdapter}s (PRD §12); this module wires a
 * selected adapter to the pure core.
 */

import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFleet,
  buildTimeline,
  DEFAULT_ALERT_RULES,
  evaluateAlerts,
  summarizeAlerts,
  type Alert,
  type AlertRule,
  type AlertSummary,
  type FleetSnapshot,
  type FsmConfig,
  type ParsedTranscript,
  type PricingTable,
  type TimelineEntry,
} from '../core/index.js';
import {
  claudeCodeAdapter,
  getAdapter,
  type SourceAdapter,
} from './adapter.js';

// Re-exported for back-compat with existing importers (watcher, tests).
export { findSessionFiles } from './fs.js';
export type { SessionFileRef } from './fs.js';
export {
  claudeCodeAdapter,
  genericJsonlAdapter,
  getAdapter,
  isKnownSource,
  listSourceIds,
  ADAPTERS,
  DEFAULT_SOURCE_ID,
  type SourceAdapter,
} from './adapter.js';

/** Default location of Claude Code session transcripts (the reference source). */
export function defaultRoot(): string {
  return join(homedir(), '.claude', 'projects');
}

/** Path to the bundled sample fleet (works in dev and from the built package). */
export function sampleRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dev:  <repo>/src/sources  ·  built: <pkg>/dist/sources  → both 2 levels deep.
  return join(here, '..', '..', 'tests', 'fixtures', 'sample');
}

/** Read and parse a single Claude Code transcript file (read-only). */
export function readTranscript(path: string): Promise<ParsedTranscript> {
  return claudeCodeAdapter.read({ path, sessionId: '', projectDir: dirname(path), mtimeMs: 0, size: 0 });
}

/**
 * Max transcript files read concurrently. A real `~/.claude/projects` can hold
 * thousands of sessions; reading them all at once (a single Promise.all over
 * every ref) opens that many file descriptors simultaneously and throws EMFILE
 * ("too many open files"). A bounded pool keeps descriptor use flat while
 * staying fully parallel up to the limit.
 */
const READ_CONCURRENCY = 64;

/** Map over items with at most `limit` concurrent workers, preserving order. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/** One parsed transcript plus the file stat it was parsed from. */
interface TranscriptCacheEntry {
  mtimeMs: number;
  size: number;
  parsed: ParsedTranscript;
}

/**
 * Opt-in parse cache keyed by file path. Pass the same map across polls to skip
 * re-reading and re-parsing files that haven't changed — a polling dashboard
 * otherwise re-parses every transcript on every tick. A change to a file's
 * mtime OR size invalidates its entry (Claude Code appends, so size always
 * grows), and entries for deleted files are pruned each scan.
 */
export type TranscriptCache = Map<string, TranscriptCacheEntry>;

/** Discover and parse every transcript under `root` using `adapter` (read-only). */
export async function scanRoot(
  root: string,
  adapter: SourceAdapter = claudeCodeAdapter,
  cache?: TranscriptCache,
): Promise<ParsedTranscript[]> {
  const refs = await adapter.discover(root);
  const parsed = await mapWithConcurrency(refs, READ_CONCURRENCY, async (r) => {
    const hit = cache?.get(r.path);
    if (hit && hit.mtimeMs === r.mtimeMs && hit.size === r.size) return hit.parsed;
    const result = await adapter.read(r).catch(() => null);
    if (cache && result) cache.set(r.path, { mtimeMs: r.mtimeMs, size: r.size, parsed: result });
    return result;
  });
  if (cache) {
    // Drop entries for files that no longer exist (deleted sessions).
    const live = new Set(refs.map((r) => r.path));
    for (const key of cache.keys()) if (!live.has(key)) cache.delete(key);
  }
  return parsed.filter((p): p is ParsedTranscript => p !== null);
}

/** Latest event timestamp across all transcripts (0 if none). */
export function maxEventTs(transcripts: ParsedTranscript[]): number {
  let max = 0;
  for (const t of transcripts) {
    for (const ev of t.events) if (ev.ts > max) max = ev.ts;
    for (const ev of t.sidechainEvents) if (ev.ts > max) max = ev.ts;
  }
  return max;
}

export interface LoadOptions {
  /** Override the clock (ms). Defaults to wall-clock, or sample-anchored in sample mode. */
  now?: number;
  /** Load the bundled sample fleet instead of the real root. */
  sample?: boolean;
  /** Explicit transcript root. Overrides the default; ignored in sample mode. */
  root?: string;
  /** Source adapter id (PRD §12). Defaults to Claude Code. Ignored in sample mode. */
  source?: string;
  config?: FsmConfig;
  pricing?: PricingTable;
  /** Alert rules to evaluate. Defaults to DEFAULT_ALERT_RULES. */
  alertRules?: readonly AlertRule[];
  /** Max timeline entries to return. */
  timelineLimit?: number;
  /** Keep the parsed transcripts on the view (for trend/replay). Off by default
   *  so `scan --json` and the API stay compact. */
  includeTranscripts?: boolean;
  /** Reuse parsed transcripts across polls (skip re-parsing unchanged files).
   *  Pass the same map on every tick of a polling loop. */
  transcriptCache?: TranscriptCache;
}

export interface FleetView {
  fleet: FleetSnapshot;
  timeline: TimelineEntry[];
  /** Alerts fired by the active rule set (PRD §13), most-urgent first. */
  alerts: Alert[];
  alertSummary: AlertSummary;
  root: string;
  now: number;
  sample: boolean;
  fileCount: number;
  /** Id of the source adapter that produced this view. */
  source: string;
  /** Human-readable adapter name. */
  sourceName: string;
  /** Parsed transcripts — present only when `includeTranscripts` was requested. */
  transcripts?: ParsedTranscript[];
}

/**
 * Decide the clock. Explicit `now` wins. In sample mode we anchor `now` just
 * after the newest sample event so the static fixtures render as if live.
 */
export function resolveNow(transcripts: ParsedTranscript[], opts: LoadOptions, wallClock: number): number {
  if (opts.now !== undefined) return opts.now;
  if (opts.sample) {
    const max = maxEventTs(transcripts);
    return max > 0 ? max + 3_000 : wallClock;
  }
  return wallClock;
}

/** Top-level: scan a root and produce a fleet + timeline view for the frontends. */
export async function loadFleetView(rootOrOptions: string | LoadOptions = {}, maybeOptions: LoadOptions = {}): Promise<FleetView> {
  const options: LoadOptions = typeof rootOrOptions === 'string' ? maybeOptions : rootOrOptions;
  // Sample fixtures are Claude-format; the sample fleet always uses that adapter.
  const adapter = options.sample ? claudeCodeAdapter : getAdapter(options.source);
  // Root precedence: explicit positional arg → options.root → sample/adapter default.
  const root =
    typeof rootOrOptions === 'string'
      ? rootOrOptions
      : options.sample
        ? sampleRoot()
        : (options.root ?? adapter.defaultRoot());

  const transcripts = await scanRoot(root, adapter, options.transcriptCache);
  const now = resolveNow(transcripts, options, Date.now());
  const deriveOpts = {
    ...(options.config ? { config: options.config } : {}),
    ...(options.pricing ? { pricing: options.pricing } : {}),
  };
  const fleet = buildFleet(transcripts, now, deriveOpts);
  const timeline = buildTimeline(transcripts, {
    limit: options.timelineLimit ?? 200,
  });
  const alerts = evaluateAlerts(fleet, options.alertRules ?? DEFAULT_ALERT_RULES, now);
  return {
    fleet,
    timeline,
    alerts,
    alertSummary: summarizeAlerts(alerts),
    root,
    now,
    sample: options.sample ?? false,
    fileCount: transcripts.length,
    source: adapter.id,
    sourceName: adapter.displayName,
    ...(options.includeTranscripts ? { transcripts } : {}),
  };
}
