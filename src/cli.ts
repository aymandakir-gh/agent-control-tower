#!/usr/bin/env node
/**
 * agent-control-tower CLI entry point.
 *
 *   agent-control-tower            # live TUI board (default)
 *   agent-control-tower tui        # same, explicit
 *   agent-control-tower scan       # one-shot text/JSON dump (great for pipes)
 *   agent-control-tower web        # local web dashboard (M3)
 *
 * Flags: --sample  --root <dir>  --json  --idle-ms <n>  --port <n>  --no-color
 *
 * Read-only on ~/.claude. No telemetry. No outbound network.
 */

import { PRODUCT_NAME, VERSION } from './core/index.js';
import { alertRulesFromArgs, parseArgs, DEFAULT_PORT, type CliOptions } from './cli/args.js';
import { runScan } from './cli/scan.js';

const HELP = `${PRODUCT_NAME} v${VERSION} — a local-first control tower for fleets of AI coding agents.

USAGE
  agent-control-tower [command] [options]

COMMANDS
  tui            Live terminal board of all agents (default)
  scan           Print a one-shot fleet snapshot and exit
  web            Serve the local web dashboard
  replay <id>    Re-render a past session's timeline + state-over-time
  history        Show recorded fleet-history samples (see --record)
  help           Show this help
  version        Print version

OPTIONS
  --sample       Use the bundled sample fleet (no real data needed)
  --root <dir>   Transcript root (default: per-source, e.g. ~/.claude/projects)
  --source <id>  Source adapter: claude-code (default) | generic-jsonl
  --json         (scan) Emit JSON instead of a table
  --idle-ms <n>  Idle threshold in ms (default: 120000)
  --alert-idle-min <n>   Alert when an agent is idle > n minutes
  --alert-cost <usd>     Alert when an agent's est. cost ≥ $usd
  --alert-turn-min <n>   Alert when a turn runs > n minutes (default 15)
  --record       (scan) Append a fleet history sample (PRD §14)
  --history-file <path>  Override the history file location
  --allow-control  Enable real management actions: focus / pause / resume
  --port <n>     (web) Port to serve on (default: ${DEFAULT_PORT})
  --no-color     Disable ANSI colors
  -h, --help     Show help
  -v, --version  Show version

PRIVACY
  Read-only on ~/.claude. No telemetry. No outbound network. Everything stays local.`;

async function main(): Promise<number> {
  const options: CliOptions = parseArgs(process.argv.slice(2));

  if (options.unknown.length > 0) {
    process.stderr.write(`Unknown option(s): ${options.unknown.join(', ')}\n\n`);
    process.stderr.write(HELP + '\n');
    return 2;
  }

  switch (options.command) {
    case 'help':
      process.stdout.write(HELP + '\n');
      return 0;
    case 'version':
      process.stdout.write(`${VERSION}\n`);
      return 0;
    case 'scan':
      return runScan(options);
    case 'replay': {
      const { runReplay } = await import('./cli/replay.js');
      return runReplay(options);
    }
    case 'history': {
      const { runHistory } = await import('./cli/history.js');
      return runHistory(options);
    }
    case 'web': {
      const { runWeb } = await import('./web/server.js');
      return runWeb(options);
    }
    case 'tui':
    default: {
      // The interactive board needs a TTY (Ink raw mode). When piped or run in
      // CI, fall back to a one-shot scan so we never crash on raw-mode setup.
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        process.stderr.write('No interactive terminal detected — printing a one-shot scan instead.\n');
        return runScan(options);
      }
      const { renderTui } = await import('./tui/render.js');
      const alertRules = alertRulesFromArgs(options);
      await renderTui({
        sample: options.sample,
        allowControl: options.allowControl,
        ...(options.root ? { root: options.root } : {}),
        ...(options.source !== undefined ? { source: options.source } : {}),
        ...(alertRules ? { alertRules } : {}),
        ...(options.idleMs !== undefined
          ? { config: { idleMs: options.idleMs, interactiveTools: ['AskUserQuestion'] } }
          : {}),
      });
      return 0;
    }
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(`Fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
