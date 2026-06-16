/**
 * Pure CLI argument parser. No I/O — takes argv tokens, returns a plain config.
 */

import { resolveAlertRules, type AlertRule } from '../core/index.js';

export type Command = 'tui' | 'web' | 'scan' | 'replay' | 'history' | 'help' | 'version';

export interface CliOptions {
  command: Command;
  sample: boolean;
  root?: string;
  /** Source adapter id (PRD §12), e.g. "claude-code" | "generic-jsonl". */
  source?: string;
  json: boolean;
  /** Positional argument (e.g. the session id/path for `replay`). */
  target?: string;
  /** Record a fleet history sample to the history file (PRD §14). */
  record: boolean;
  /** Override the history file location. */
  historyFile?: string;
  idleMs?: number;
  /** Enable the idle alert at N minutes (PRD §13). */
  alertIdleMin?: number;
  /** Enable the cost alert at $N. */
  alertCost?: number;
  /** Override the long-turn alert threshold (minutes). */
  alertTurnMin?: number;
  port: number;
  noColor: boolean;
  /** Enable real management actions (focus/pause/resume) — PRD §15. Off by default. */
  allowControl: boolean;
  /** Unknown flags, surfaced so the CLI can warn. */
  unknown: string[];
}

const COMMANDS: Command[] = ['tui', 'web', 'scan', 'replay', 'history', 'help', 'version'];

export const DEFAULT_PORT = 4517;

/** Parse argv (without node/script prefix) into CliOptions. */
export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    command: 'tui',
    sample: false,
    json: false,
    record: false,
    port: DEFAULT_PORT,
    noColor: false,
    allowControl: false,
    unknown: [],
  };
  let commandSet = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--sample':
        opts.sample = true;
        break;
      case '--json':
        opts.json = true;
        break;
      case '--no-color':
        opts.noColor = true;
        break;
      case '--record':
        opts.record = true;
        break;
      case '--allow-control':
        opts.allowControl = true;
        break;
      case '--history-file':
        opts.historyFile = argv[++i];
        break;
      case '-h':
      case '--help':
        opts.command = 'help';
        commandSet = true;
        break;
      case '-v':
      case '--version':
        opts.command = 'version';
        commandSet = true;
        break;
      case '--root':
        opts.root = argv[++i];
        break;
      case '--source':
        opts.source = argv[++i];
        break;
      case '--idle-ms': {
        const n = Number(argv[++i]);
        if (Number.isFinite(n) && n >= 0) opts.idleMs = n;
        break;
      }
      case '--alert-idle-min': {
        const n = Number(argv[++i]);
        if (Number.isFinite(n) && n >= 0) opts.alertIdleMin = n;
        break;
      }
      case '--alert-cost': {
        const n = Number(argv[++i]);
        if (Number.isFinite(n) && n >= 0) opts.alertCost = n;
        break;
      }
      case '--alert-turn-min': {
        const n = Number(argv[++i]);
        if (Number.isFinite(n) && n >= 0) opts.alertTurnMin = n;
        break;
      }
      case '--port': {
        const n = Number(argv[++i]);
        if (Number.isInteger(n) && n > 0 && n < 65_536) opts.port = n;
        break;
      }
      default:
        if (arg.startsWith('--root=')) {
          opts.root = arg.slice('--root='.length);
        } else if (arg.startsWith('--source=')) {
          opts.source = arg.slice('--source='.length);
        } else if (arg.startsWith('--history-file=')) {
          opts.historyFile = arg.slice('--history-file='.length);
        } else if (arg.startsWith('--port=')) {
          const n = Number(arg.slice('--port='.length));
          if (Number.isInteger(n) && n > 0 && n < 65_536) opts.port = n;
        } else if (arg.startsWith('--idle-ms=')) {
          const n = Number(arg.slice('--idle-ms='.length));
          if (Number.isFinite(n) && n >= 0) opts.idleMs = n;
        } else if (arg.startsWith('--alert-idle-min=')) {
          const n = Number(arg.slice('--alert-idle-min='.length));
          if (Number.isFinite(n) && n >= 0) opts.alertIdleMin = n;
        } else if (arg.startsWith('--alert-cost=')) {
          const n = Number(arg.slice('--alert-cost='.length));
          if (Number.isFinite(n) && n >= 0) opts.alertCost = n;
        } else if (arg.startsWith('--alert-turn-min=')) {
          const n = Number(arg.slice('--alert-turn-min='.length));
          if (Number.isFinite(n) && n >= 0) opts.alertTurnMin = n;
        } else if (!arg.startsWith('-')) {
          if (!commandSet && (COMMANDS as string[]).includes(arg)) {
            opts.command = arg as Command;
            commandSet = true;
          } else if (opts.target === undefined) {
            // First bare non-command arg is a positional target (e.g. replay <id>).
            opts.target = arg;
          }
        } else if (arg.startsWith('-')) {
          opts.unknown.push(arg);
        }
        break;
    }
  }

  return opts;
}

/**
 * Build a concrete alert rule set from CLI flags, or `undefined` to use the
 * defaults (when no alert flag was passed). Pure.
 */
export function alertRulesFromArgs(opts: CliOptions): AlertRule[] | undefined {
  if (opts.alertIdleMin === undefined && opts.alertCost === undefined && opts.alertTurnMin === undefined) {
    return undefined;
  }
  return resolveAlertRules({
    ...(opts.alertIdleMin !== undefined ? { idleMinutes: opts.alertIdleMin } : {}),
    ...(opts.alertCost !== undefined ? { costUsd: opts.alertCost } : {}),
    ...(opts.alertTurnMin !== undefined ? { turnMinutes: opts.alertTurnMin } : {}),
  });
}
