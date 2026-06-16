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
import {
  buildCostTrend,
  buildSessionReplay,
  PRODUCT_NAME,
  VERSION,
  type AlertRule,
  type FsmConfig,
} from '../core/index.js';
import {
  createControlSetup,
  executeControl,
  targetFromAgent,
  CONTROL_ACTIONS,
  type ControlAction,
  type ControlSetup,
} from '../control/index.js';
import { ADAPTERS, loadFleetView, type FleetView, type LoadOptions } from '../sources/index.js';
import { alertRulesFromArgs, type CliOptions } from '../cli/args.js';

export interface WebServerOptions {
  sample?: boolean;
  root?: string;
  source?: string;
  idleMs?: number;
  alertRules?: readonly AlertRule[];
  /** Enable real management actions + the control endpoint (PRD §15). */
  allowControl?: boolean;
  /** Injectable control setup (tests). When provided, the control route is registered. */
  control?: ControlSetup;
  /** Injectable loader (tests). Defaults to the real read-only loader. */
  loader?: (opts: LoadOptions) => Promise<FleetView>;
}

function loadOptionsFrom(opts: WebServerOptions): LoadOptions {
  const config: FsmConfig | undefined =
    opts.idleMs !== undefined ? { idleMs: opts.idleMs, interactiveTools: ['AskUserQuestion'] } : undefined;
  return {
    sample: opts.sample ?? false,
    includeTranscripts: true, // needed for /api/trend and /api/agents/:id/replay
    ...(opts.root ? { root: opts.root } : {}),
    ...(opts.source !== undefined ? { source: opts.source } : {}),
    ...(opts.alertRules ? { alertRules: opts.alertRules } : {}),
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

  // Control is disabled by default; the route is registered only when enabled
  // (or when a control setup is injected for tests).
  const control = opts.control ?? createControlSetup(opts.allowControl ?? false);
  const controlRoutes = opts.allowControl === true || opts.control !== undefined;

  // root (when set) now travels inside loadOpts, honored by loadFleetView.
  const view = async (): Promise<FleetView> => load(loadOpts);

  app.get('/api/health', async () => {
    const v = await view();
    return {
      ok: true,
      product: PRODUCT_NAME,
      version: VERSION,
      root: v.root,
      sample: v.sample,
      source: v.source,
      sourceName: v.sourceName,
      control: control.enabled,
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
      source: v.source,
      sourceName: v.sourceName,
      fileCount: v.fileCount,
      totals: v.fleet.totals,
      agents: v.fleet.agents,
      alerts: v.alerts,
      alertSummary: v.alertSummary,
    };
  });

  app.get('/api/alerts', async () => {
    const v = await view();
    return { now: v.now, summary: v.alertSummary, alerts: v.alerts };
  });

  app.get('/api/timeline', async (req) => {
    const v = await view();
    const q = req.query as { limit?: string };
    const limit = q.limit !== undefined ? Number(q.limit) : undefined;
    // slice from a clamped start so limit=0 → [] (avoids the slice(-0) === full-array trap).
    const entries =
      limit !== undefined && Number.isFinite(limit) && limit >= 0
        ? v.timeline.slice(Math.max(0, v.timeline.length - limit))
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

  app.get('/api/agents/:id/replay', async (req, reply) => {
    const { id } = req.params as { id: string };
    const v = await view();
    const parsed = (v.transcripts ?? []).find((t) => (t.sessionId ?? '') === id);
    if (!parsed) {
      reply.code(404);
      return { error: 'session not found', id };
    }
    return { now: v.now, replay: buildSessionReplay(parsed) };
  });

  app.get('/api/sources', async () => {
    const v = await view();
    return {
      active: v.source,
      sources: Object.values(ADAPTERS).map((a) => ({
        id: a.id,
        displayName: a.displayName,
        defaultRoot: a.defaultRoot(),
      })),
    };
  });

  app.get('/api/trend', async (req) => {
    const v = await view();
    const q = req.query as { bucketMs?: string };
    const n = Number(q.bucketMs);
    // Only a positive finite width is honored; anything else falls back to the
    // hourly default for BOTH the bucketing and the echoed value (kept in sync).
    const bucketMs = q.bucketMs !== undefined && Number.isFinite(n) && n > 0 ? n : undefined;
    const points = buildCostTrend(v.transcripts ?? [], bucketMs !== undefined ? { bucketMs } : {});
    return { now: v.now, bucketMs: bucketMs ?? 3_600_000, count: points.length, points };
  });

  // Guarded management endpoint — registered ONLY when control is enabled.
  if (controlRoutes) {
    app.post('/api/agents/:id/control', async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as { action?: string };
      const action = body.action;
      if (!action || !(CONTROL_ACTIONS as readonly string[]).includes(action)) {
        reply.code(400);
        return { error: 'invalid or missing action', actions: CONTROL_ACTIONS };
      }
      const v = await view();
      const agent = v.fleet.agents.find((a) => a.sessionId === id);
      if (!agent) {
        reply.code(404);
        return { error: 'agent not found', id };
      }
      const result = await executeControl(control, targetFromAgent(agent), action as ControlAction);
      return { now: v.now, result };
    });
  }

  app.get('/', async (_req, reply) => {
    reply.type('text/html');
    return indexHtml;
  });

  return app;
}

/** Start the dashboard server (CLI). */
export async function runWeb(options: CliOptions): Promise<number> {
  const alertRules = alertRulesFromArgs(options);
  const app = createServer({
    sample: options.sample,
    allowControl: options.allowControl,
    ...(options.root ? { root: options.root } : {}),
    ...(options.source !== undefined ? { source: options.source } : {}),
    ...(alertRules ? { alertRules } : {}),
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
