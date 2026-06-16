/**
 * `history` command: print the recorded fleet-history samples (PRD §14).
 * Samples are written by `scan --record` (e.g. on a cron). Read-only here.
 *
 *   agent-control-tower history [--history-file <path>] [--json]
 */

import { formatTokensCompact, formatUsd } from '../core/index.js';
import { defaultHistoryPath, readHistory, type HistorySample } from '../history/store.js';
import { paint } from '../ui/ansi.js';
import type { CliOptions } from './args.js';

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

/** Render recorded samples to text. Pure given samples + flags. */
export function renderHistoryText(samples: HistorySample[], path: string, color: boolean): string {
  const lines: string[] = [];
  lines.push(`${paint(color, 'bold', 'fleet history')}  ${paint(color, 'dim', path)}`);
  if (samples.length === 0) {
    lines.push('');
    lines.push(paint(color, 'dim', 'No history recorded yet. Record samples with `scan --record` (e.g. via cron).'));
    return lines.join('\n');
  }
  lines.push('');
  const header = [pad('TIME', 20), pad('AGENTS', 7), pad('WORK', 5), pad('WAIT', 5), pad('ERR', 4), pad('IDLE', 5), pad('TOKENS', 9), 'COST'].join(' ');
  lines.push(paint(color, 'dim', header));
  for (const s of samples) {
    const iso = new Date(s.ts).toISOString().slice(0, 19).replace('T', ' ');
    lines.push(
      [
        pad(iso, 20),
        pad(String(s.agents), 7),
        pad(String(s.byStatus.working), 5),
        pad(String(s.byStatus.waiting), 5),
        pad(String(s.byStatus.error), 4),
        pad(String(s.byStatus.idle), 5),
        pad(formatTokensCompact(s.totalTokens), 9),
        formatUsd(s.costUsd),
      ].join(' '),
    );
  }
  const last = samples[samples.length - 1];
  const first = samples[0];
  lines.push('');
  lines.push(
    paint(color, 'dim', `${samples.length} samples · `) +
      `Δcost ${formatUsd(last.costUsd - first.costUsd)} over ${formatTokensCompact(last.totalTokens - first.totalTokens)} tokens`,
  );
  return lines.join('\n');
}

/** Execute the history command. Returns a process exit code. */
export async function runHistory(options: CliOptions): Promise<number> {
  const path = options.historyFile ?? defaultHistoryPath();
  const samples = await readHistory(path);
  if (options.json) {
    process.stdout.write(JSON.stringify({ path, count: samples.length, samples }, null, 2) + '\n');
    return 0;
  }
  const color = !options.noColor && !process.env.NO_COLOR && process.stdout.isTTY === true;
  process.stdout.write(renderHistoryText(samples, path, color) + '\n');
  return 0;
}
