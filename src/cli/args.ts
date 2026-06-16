/**
 * Pure CLI argument parser. No I/O — takes argv tokens, returns a plain config.
 */

export type Command = 'tui' | 'web' | 'scan' | 'help' | 'version';

export interface CliOptions {
  command: Command;
  sample: boolean;
  root?: string;
  json: boolean;
  idleMs?: number;
  port: number;
  noColor: boolean;
  /** Unknown flags, surfaced so the CLI can warn. */
  unknown: string[];
}

const COMMANDS: Command[] = ['tui', 'web', 'scan', 'help', 'version'];

export const DEFAULT_PORT = 4517;

/** Parse argv (without node/script prefix) into CliOptions. */
export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    command: 'tui',
    sample: false,
    json: false,
    port: DEFAULT_PORT,
    noColor: false,
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
      case '--idle-ms': {
        const n = Number(argv[++i]);
        if (Number.isFinite(n) && n >= 0) opts.idleMs = n;
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
        } else if (arg.startsWith('--port=')) {
          const n = Number(arg.slice('--port='.length));
          if (Number.isInteger(n) && n > 0 && n < 65_536) opts.port = n;
        } else if (arg.startsWith('--idle-ms=')) {
          const n = Number(arg.slice('--idle-ms='.length));
          if (Number.isFinite(n) && n >= 0) opts.idleMs = n;
        } else if (!arg.startsWith('-') && !commandSet && (COMMANDS as string[]).includes(arg)) {
          opts.command = arg as Command;
          commandSet = true;
        } else if (arg.startsWith('-')) {
          opts.unknown.push(arg);
        }
        break;
    }
  }

  return opts;
}
