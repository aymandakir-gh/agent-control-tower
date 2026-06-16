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

/** Discover and parse every transcript under `root` using `adapter` (read-only). */
export async function scanRoot(root: string, adapter: SourceAdapter = claudeCodeAdapter): Promise<ParsedTranscript[]> {
  const refs = await adapter.discover(root);
  const parsed = await Promise.all(refs.map((r) => adapter.read(r).catch(() => null)));
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

  const transcripts = await scanRoot(root, adapter);
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
