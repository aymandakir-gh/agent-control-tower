/**
 * Persistent fleet-history recorder (PRD §14).
 *
 * Opt-in. Appends periodic fleet samples to a JSONL file in a dedicated app
 * state directory — NEVER under the scanned root (`~/.claude`). This is the only
 * module that writes to disk, and it writes solely to its own data dir. Powers
 * long-range trends beyond what currently-live transcripts contain.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AgentStatus } from '../core/index.js';
import type { FleetView } from '../sources/index.js';

/** One recorded point: a compact fleet rollup at a moment in time. */
export interface HistorySample {
  ts: number;
  agents: number;
  byStatus: Record<AgentStatus, number>;
  totalTokens: number;
  costUsd: number;
  alerts: number;
}

/**
 * Default history file location. Honors `$XDG_STATE_HOME`, else `~/.local/state`.
 * Deliberately distinct from the scanned transcript root — we never write there.
 */
export function defaultHistoryPath(): string {
  const base = process.env.XDG_STATE_HOME && process.env.XDG_STATE_HOME.trim() !== ''
    ? process.env.XDG_STATE_HOME
    : join(homedir(), '.local', 'state');
  return join(base, 'agent-control-tower', 'history.jsonl');
}

/** Derive a compact sample from a fleet view. Pure. */
export function sampleFromView(view: FleetView): HistorySample {
  return {
    ts: view.now,
    agents: view.fleet.totals.agents,
    byStatus: { ...view.fleet.totals.byStatus },
    totalTokens: view.fleet.totals.totalTokens,
    costUsd: view.fleet.totals.costUsd,
    alerts: view.alerts.length,
  };
}

/** Append a sample to the history file (creating the directory if needed). */
export async function recordSample(path: string, sample: HistorySample): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(sample) + '\n', 'utf8');
}

/** Convenience: derive a sample from a view and append it. Returns the sample. */
export async function recordFleetSample(view: FleetView, path: string = defaultHistoryPath()): Promise<HistorySample> {
  const sample = sampleFromView(view);
  await recordSample(path, sample);
  return sample;
}

/** Read recorded samples (chronological). Missing file → []. Bad lines skipped. */
export async function readHistory(path: string = defaultHistoryPath()): Promise<HistorySample[]> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  const out: HistorySample[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === 'object' && typeof obj.ts === 'number') out.push(obj as HistorySample);
    } catch {
      // skip malformed/partial line
    }
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}
