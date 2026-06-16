/**
 * Local web dashboard server (M3).
 *
 * A tiny Fastify app exposing a JSON API over the same pure core the TUI uses,
 * plus a single self-contained HTML page. Read-only on ~/.claude; binds to
 * localhost only; no telemetry; no outbound network.
 *
 * The HTTP API is the contract the tests hit directly (via fastify.inject),
 * so the dashboard and the tests assert the exact same core data.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { PRODUCT_NAME, VERSION, type FsmConfig } from '../core/index.js';
import { loadFleetView, type FleetView, type LoadOptions } from '../sources/index.js';
import type { CliOptions } from '../cli/args.js';

export interface WebServerOptions {
  sample?: boolean;
  root?: string;
  idleMs?: number;
  /** Injectable loader (tests). Defaults to the real read-only loader. */
  loader?: (opts: LoadOptions) => Promise<FleetView>;
}

function loadOptionsFrom(opts: WebServerOptions): LoadOptions {
  const config: FsmConfig | undefined =
    opts.idleMs !== undefined ? { idleMs: opts.idleMs, interactiveTools: ['AskUserQuestion'] } : undefined;
  return {
    sample: opts.sample ?? false,
    ...(config ? { config } : {}),
  };
}

function readIndexHtml(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    return readFileSync(join(here, 'public', 'index.html'), 'utf8');
  } catch {
    return '<!doctype html><meta charset="utf-8"><title>agent-control-tower</title><p>Dashboard asset missing; rebuild with <code>pnpm build</code>.</p>';
  }
}

/** Build (but do not start) the Fastify app. Use `.inject()` in tests. */
export function createServer(opts: WebServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const load = opts.loader ?? loadFleetView;
  const loadOpts = loadOptionsFrom(opts);
  const indexHtml = readIndexHtml();

  const view = async (): Promise<FleetView> =>
    opts.root ? load({ ...loadOpts }) : load(loadOpts);

  app.get('/api/health', async () => {
    const v = await view();
    return {
      ok: true,
      product: PRODUCT_NAME,
      version: VERSION,
      root: v.root,
      sample: v.sample,
      now: v.now,
      fileCount: v.fileCount,
      agents: v.fleet.totals.agents,
    };
  });

  app.get('/api/fleet', async () => {
    const v = await view();
    return {
      generatedAt: v.fleet.generatedAt,
      now: v.now,
      root: v.root,
      sample: v.sample,
      fileCount: v.fileCount,
      totals: v.fleet.totals,
      agents: v.fleet.agents,
    };
  });

  app.get('/api/timeline', async (req) => {
    const v = await view();
    const q = req.query as { limit?: string };
    const limit = q.limit !== undefined ? Number(q.limit) : undefined;
    const entries =
      limit !== undefined && Number.isFinite(limit) && limit >= 0
        ? v.timeline.slice(-limit)
        : v.timeline;
    return { now: v.now, count: entries.length, entries };
  });

  app.get('/api/agents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const v = await view();
    const agent = v.fleet.agents.find((a) => a.sessionId === id);
    if (!agent) {
      reply.code(404);
      return { error: 'agent not found', id };
    }
    return { now: v.now, agent };
  });

  app.get('/', async (_req, reply) => {
    reply.type('text/html');
    return indexHtml;
  });

  return app;
}

/** Start the dashboard server (CLI). */
export async function runWeb(options: CliOptions): Promise<number> {
  const app = createServer({
    sample: options.sample,
    ...(options.root ? { root: options.root } : {}),
    ...(options.idleMs !== undefined ? { idleMs: options.idleMs } : {}),
  });
  const port = options.port;
  try {
    // Bind to loopback only — never expose the fleet on the network.
    await app.listen({ port, host: '127.0.0.1' });
    process.stdout.write(`agent-control-tower dashboard → http://127.0.0.1:${port}\n`);
    process.stdout.write('Read-only · local-only · press Ctrl+C to stop.\n');
    return 0;
  } catch (err) {
    process.stderr.write(`Failed to start web server: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}
