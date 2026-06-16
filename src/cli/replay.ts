/**
 * `replay` command: re-render a past session's state-over-time and timeline from
 * its stored transcript (PRD §14). Read-only.
 *
 *   agent-control-tower replay <sessionId|path.jsonl> [--source ..] [--root ..] [--json]
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import {
  buildSessionReplay,
  formatDuration,
  formatUsd,
  statusGlyph,
  type ParsedTranscript,
  type ReplayFrame,
  type SessionReplay,
} from '../core/index.js';
import { claudeCodeAdapter, getAdapter, sampleRoot } from '../sources/index.js';
import { paint, STATUS_COLOR } from '../ui/ansi.js';
import type { CliOptions } from './args.js';

/** Locate and parse the requested session. Returns null if not found. */
export async function resolveTranscript(options: CliOptions): Promise<ParsedTranscript | null> {
  const target = options.target;
  if (!target) return null;

  const adapter = options.sample ? claudeCodeAdapter : getAdapter(options.source);

  // A direct file path wins when it exists.
  const looksLikePath = target.includes('/') || target.includes('\\') || target.endsWith('.jsonl');
  if (looksLikePath && existsSync(target)) {
    const text = await readFile(target, 'utf8');
    return adapter.parse(text);
  }

  // Otherwise treat `target` as a sessionId (or filename stem) under the root.
  const root = options.root ?? (options.sample ? sampleRoot() : adapter.defaultRoot());
  const refs = await adapter.discover(root);
  for (const ref of refs) {
    if (ref.sessionId === target) return adapter.read(ref);
  }
  // Fallback: match by parsed sessionId (filename ≠ sessionId in some sources).
  for (const ref of refs) {
    const parsed = await adapter.read(ref).catch(() => null);
    if (parsed && parsed.sessionId === target) return parsed;
  }
  return null;
}

/** Collapse frames into status segments for a readable transition list. */
function transitions(frames: ReplayFrame[]): ReplayFrame[] {
  const out: ReplayFrame[] = [];
  for (const f of frames) {
    if (out.length === 0 || out[out.length - 1].status !== f.status) out.push(f);
  }
  return out;
}

/** Render a replay to text. Pure given a replay + flags. */
export function renderReplayText(replay: SessionReplay, color: boolean): string {
  const lines: string[] = [];
  const title = paint(color, 'bold', replay.slug ?? replay.sessionId);
  lines.push(`${title}  ${paint(color, 'dim', `(${replay.sessionId})`)}`);
  lines.push(
    paint(color, 'dim', 'project: ') + (replay.project ?? '—') +
      paint(color, 'dim', '  ·  final: ') +
      paint(color, STATUS_COLOR[replay.finalStatus], `${statusGlyph(replay.finalStatus)} ${replay.finalStatus}`) +
      paint(color, 'dim', '  ·  duration: ') + formatDuration(replay.durationMs) +
      paint(color, 'dim', '  ·  cost: ') + formatUsd(replay.totalCostUsd),
  );
  lines.push('');

  const segs = transitions(replay.frames);
  lines.push(paint(color, 'dim', `State transitions (${segs.length} of ${replay.frames.length} frames):`));
  for (const f of segs) {
    const t = f.tsIso ? f.tsIso.slice(11, 19) : '--:--:--';
    const badge = paint(color, STATUS_COLOR[f.status], `${statusGlyph(f.status)} ${f.status}`);
    lines.push(`  ${paint(color, 'dim', t)}  ${badge.padEnd(color ? 18 : 9)}  ${paint(color, 'cyan', f.event)}`);
  }

  // Timeline tail.
  const tail = replay.timeline.slice(-12);
  if (tail.length > 0) {
    lines.push('');
    lines.push(paint(color, 'dim', 'Timeline (last events):'));
    for (const e of tail) {
      const t = e.tsIso ? e.tsIso.slice(11, 19) : '--:--:--';
      const label = e.isError ? paint(color, 'red', e.label) : e.label;
      lines.push(`  ${paint(color, 'dim', t)} ${label}`);
    }
  }
  return lines.join('\n');
}

/** Execute the replay command. Returns a process exit code. */
export async function runReplay(options: CliOptions): Promise<number> {
  if (!options.target) {
    process.stderr.write('Usage: agent-control-tower replay <sessionId|path.jsonl> [--sample] [--root <dir>] [--source <id>] [--json]\n');
    return 2;
  }
  const parsed = await resolveTranscript(options);
  if (!parsed) {
    process.stderr.write(`No session found for "${options.target}".\n`);
    return 1;
  }
  const replay = buildSessionReplay(parsed);
  if (options.json) {
    process.stdout.write(JSON.stringify(replay, null, 2) + '\n');
    return 0;
  }
  const color = !options.noColor && !process.env.NO_COLOR && process.stdout.isTTY === true;
  process.stdout.write(renderReplayText(replay, color) + '\n');
  return 0;
}
