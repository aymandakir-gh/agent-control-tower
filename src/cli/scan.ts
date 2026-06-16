/**
 * `scan` command: a one-shot, non-interactive fleet dump. Great for piping,
 * cron, CI, and verifying the pipeline against fixtures. `--json` emits the raw
 * fleet view; otherwise a colored table.
 */

import {
  formatDuration,
  formatRelativeTime,
  formatTokensCompact,
  formatUsd,
  statusGlyph,
  type AgentStatus,
} from '../core/index.js';
import { loadFleetView, type FleetView, type LoadOptions } from '../sources/transcripts.js';
import { paint, STATUS_COLOR } from '../ui/ansi.js';
import type { CliOptions } from './args.js';

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)) + '…';
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

const STATUS_ORDER: AgentStatus[] = ['working', 'waiting', 'error', 'idle'];

/** Render the fleet view to a string. Pure given a view + flags. */
export function renderScanText(view: FleetView, color: boolean): string {
  const { fleet, now } = view;
  const lines: string[] = [];

  const title = paint(color, 'bold', 'agent-control-tower');
  const where = view.sample ? paint(color, 'cyan', '(sample data)') : paint(color, 'dim', view.root);
  lines.push(`${title}  ${fleet.totals.agents} agent${fleet.totals.agents === 1 ? '' : 's'}  ${where}`);

  // Status summary.
  const summary = STATUS_ORDER.map((s) => {
    const n = fleet.totals.byStatus[s];
    return paint(color, STATUS_COLOR[s], `${statusGlyph(s)} ${n} ${s}`);
  }).join('   ');
  lines.push(summary);
  lines.push('');

  if (fleet.agents.length === 0) {
    lines.push(paint(color, 'dim', 'No agents found. Try `--sample` to see a demo fleet.'));
    return lines.join('\n');
  }

  // Table.
  const header = [
    pad('STATUS', 8),
    pad('PROJECT', 16),
    pad('BRANCH', 14),
    pad('MODEL', 18),
    pad('TOOL', 16),
    pad('TURN', 9),
    pad('TOKENS', 8),
    pad('COST', 9),
    'LAST',
  ].join(' ');
  lines.push(paint(color, 'dim', header));

  for (const a of fleet.agents) {
    const status = paint(color, STATUS_COLOR[a.status], pad(`${statusGlyph(a.status)} ${a.status}`, 8));
    const cost = a.cost.estimated ? `~${formatUsd(a.cost.usd)}` : formatUsd(a.cost.usd);
    const row = [
      status,
      pad(truncate(a.project ?? a.slug ?? a.sessionId, 16), 16),
      pad(truncate(a.gitBranch ?? '—', 14), 14),
      pad(truncate(a.model ?? '—', 18), 18),
      pad(truncate(a.currentTool ?? '—', 16), 16),
      pad(formatDuration(a.turnDurationMs), 9),
      pad(formatTokensCompact(a.totalTokens), 8),
      pad(cost, 9),
      formatRelativeTime(a.lastActivityAt, now),
    ].join(' ');
    lines.push(row);
  }

  lines.push('');
  const totalCost = fleet.totals.costUsd;
  lines.push(
    paint(color, 'dim', 'Fleet total: ') +
      `${formatTokensCompact(fleet.totals.totalTokens)} tokens  ${formatUsd(totalCost)}`,
  );

  // Recent activity tail.
  const tail = view.timeline.slice(-8);
  if (tail.length > 0) {
    lines.push('');
    lines.push(paint(color, 'dim', 'Recent activity:'));
    for (const e of tail) {
      const time = e.tsIso ? e.tsIso.slice(11, 19) : '--:--:--';
      const label = e.isError ? paint(color, 'red', e.label) : e.label;
      lines.push(`  ${paint(color, 'dim', time)} ${pad(truncate(e.project ?? e.sessionId, 16), 16)} ${label}`);
    }
  }

  return lines.join('\n');
}

/** Execute the scan command (does I/O + printing). Returns process exit code. */
export async function runScan(options: CliOptions): Promise<number> {
  const loadOpts: LoadOptions = {
    sample: options.sample,
    ...(options.idleMs !== undefined
      ? { config: { idleMs: options.idleMs, interactiveTools: ['AskUserQuestion'] } }
      : {}),
  };
  const view = options.root
    ? await loadFleetView(options.root, loadOpts)
    : await loadFleetView(loadOpts);

  if (options.json) {
    process.stdout.write(JSON.stringify(view, null, 2) + '\n');
    return 0;
  }
  const color = !options.noColor && !process.env.NO_COLOR && process.stdout.isTTY === true;
  process.stdout.write(renderScanText(view, color) + '\n');
  return 0;
}
