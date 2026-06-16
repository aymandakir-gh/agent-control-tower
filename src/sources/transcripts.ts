/**
 * Source layer: discover and read Claude Code transcripts from disk.
 *
 * THIS IS THE ONLY PART OF THE APP THAT TOUCHES THE FILESYSTEM, AND IT IS
 * STRICTLY READ-ONLY. It never writes, moves, or deletes anything under the
 * scanned root (PRD §4 non-goals, §11). It opens files only with readers.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFleet,
  buildTimeline,
  parseTranscript,
  type FleetSnapshot,
  type FsmConfig,
  type ParsedTranscript,
  type PricingTable,
  type TimelineEntry,
} from '../core/index.js';

/** Default location of Claude Code session transcripts. */
export function defaultRoot(): string {
  return join(homedir(), '.claude', 'projects');
}

/** Path to the bundled sample fleet (works in dev and from the built package). */
export function sampleRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dev:  <repo>/src/sources  ·  built: <pkg>/dist/sources  → both 2 levels deep.
  return join(here, '..', '..', 'tests', 'fixtures', 'sample');
}

export interface SessionFileRef {
  path: string;
  sessionId: string;
  projectDir: string;
  mtimeMs: number;
  size: number;
}

/** Recursively find `*.jsonl` transcript files under `root` (read-only). */
export async function findSessionFiles(root: string): Promise<SessionFileRef[]> {
  const out: SessionFileRef[] = [];

  async function walk(dir: string): Promise<void> {
    // Read entries; unreadable dirs (permissions, races) are skipped, never fatal.
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (!entries) return;
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && extname(entry.name) === '.jsonl') {
        try {
          const s = await stat(full);
          out.push({
            path: full,
            sessionId: entry.name.slice(0, -'.jsonl'.length),
            projectDir: dir,
            mtimeMs: s.mtimeMs,
            size: s.size,
          });
        } catch {
          // file vanished between readdir and stat — skip
        }
      }
    }
  }

  await walk(root);
  return out;
}

/** Read and parse a single transcript file (read-only). */
export async function readTranscript(path: string): Promise<ParsedTranscript> {
  const text = await readFile(path, 'utf8');
  const parsed = parseTranscript(text);
  // Backfill sessionId from the filename when records omit it.
  if (!parsed.sessionId) {
    const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.jsonl$/, '');
    return { ...parsed, sessionId: name };
  }
  return parsed;
}

/** Discover and parse every transcript under `root`. */
export async function scanRoot(root: string): Promise<ParsedTranscript[]> {
  const refs = await findSessionFiles(root);
  const parsed = await Promise.all(refs.map((r) => readTranscript(r.path).catch(() => null)));
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
  config?: FsmConfig;
  pricing?: PricingTable;
  /** Max timeline entries to return. */
  timelineLimit?: number;
}

export interface FleetView {
  fleet: FleetSnapshot;
  timeline: TimelineEntry[];
  root: string;
  now: number;
  sample: boolean;
  fileCount: number;
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
  const root =
    typeof rootOrOptions === 'string'
      ? rootOrOptions
      : options.sample
        ? sampleRoot()
        : defaultRoot();

  const transcripts = await scanRoot(root);
  const now = resolveNow(transcripts, options, Date.now());
  const deriveOpts = {
    ...(options.config ? { config: options.config } : {}),
    ...(options.pricing ? { pricing: options.pricing } : {}),
  };
  const fleet = buildFleet(transcripts, now, deriveOpts);
  const timeline = buildTimeline(transcripts, {
    limit: options.timelineLimit ?? 200,
  });
  return { fleet, timeline, root, now, sample: options.sample ?? false, fileCount: transcripts.length };
}
