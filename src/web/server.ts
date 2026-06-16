/**
 * Local web dashboard server. Full implementation lands in M3 (Fastify HTTP API
 * + self-contained page). This stub keeps the CLI coherent until then.
 */

import type { CliOptions } from '../cli/args.js';

export async function runWeb(_options: CliOptions): Promise<number> {
  process.stderr.write('The web dashboard ships in M3. For now use:\n');
  process.stderr.write('  agent-control-tower            # live TUI board\n');
  process.stderr.write('  agent-control-tower scan       # one-shot snapshot\n');
  process.stderr.write('  agent-control-tower --sample   # demo fleet\n');
  return 1;
}
