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
  /**
   * Freshness window (ms) for the per-request fleet snapshot. The dashboard
   * fires several endpoints in parallel every refresh; without this they would
   * each re-walk and re-parse the whole transcript tree. A short TTL collapses
   * one burst into a single scan. Concurrent loads are always deduped (single
   * flight) regardless of this value. Default 500ms; 0 disables the freshness
   * cache (each non-concurrent request still scans).
   */
  cacheTtlMs?: number;
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

/**
 * Hostnames accepted by the loopback (DNS-rebinding) guard. The server binds
 * 127.0.0.1, but browsers still deliver requests to it from any page the user
 * visits, and a DNS-rebinding attack can point an attacker-controlled domain at
 * 127.0.0.1 — so we additionally require the Host (and Origin, when present) to
 * be a loopback address. Without this, a malicious page could drive the opt-in
 * control endpoint (pause/resume agents) without consent.
 */
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1']);

/** Bare hostname (no port, no brackets) from a Host-style header value. */
function hostnameFromHostHeader(host: string | undefined): string | undefined {
  if (!host) return undefined;
  const h = host.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']')); // "[::1]:7777" → "::1"
  const i = h.indexOf(':');
  return i === -1 ? h : h.slice(0, i); // "127.0.0.1:7777" → "127.0.0.1"
}

function isLoopbackHost(host: string | undefined): boolean {
  const h = hostnameFromHostHeader(host);
  return h !== undefined && LOOPBACK_HOSTNAMES.has(h);
}

/** An Origin header, when present, must also be loopback (absent Origin is fine). */
function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const h = new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return LOOPBACK_HOSTNAMES.has(h);
  } catch {
    return false; // malformed Origin → reject
  }
}

/** Build (but do not start) the Fastify app. Use `.inject()` in tests. */
export function createServer(opts: WebServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });

  // DNS-rebinding / CSRF guard: this dashboard is loopback-only, so reject any
  // request whose Host — or Origin, when the browser sends one — is not a
  // loopback address, before any route handler runs.
  app.addHook('onRequest', async (req, reply) => {
    if (!isLoopbackHost(req.headers.host) || !isLoopbackOrigin(req.headers.origin)) {
      return reply.code(403).send({
        error: 'forbidden',
        message: 'agent-control-tower serves loopback clients only (DNS-rebinding guard)',
      });
    }
  });
  const load = opts.loader ?? loadFleetView;
  const loadOpts = loadOptionsFrom(opts);
  const indexHtml = readIndexHtml();

  // Control is disabled by default; the route is registered only when enabled
  // (or when a control setup is injected for tests).
  const control = opts.control ?? createControlSetup(opts.allowControl ?? false);
  const controlRoutes = opts.allowControl === true || opts.control !== undefined;

  // root (when set) now travels inside loadOpts, honored by loadFleetView.
  //
  // Single-flight + short TTL cache: a dashboard refresh fires /api/fleet,
  // /api/timeline, /api/trend and /api/health in parallel, and each read
  // endpoint calls view() → load() → a full readdir walk + parse of every
  // transcript. Sharing one in-flight load across the burst (and reusing it for
  // a short freshness window) cuts the per-cycle scans from 4 to 1 while keeping
  // the read-only/stateless contract intact. The default loader resolves to the
  // exact same snapshot for all four requests anyway.
  const cacheTtlMs = opts.cacheTtlMs ?? 500;
  let inFlight: Promise<FleetView> | null = null;
  let cached: { value: FleetView; at: number } | null = null;
  const view = async (): Promise<FleetView> => {
    if (inFlight) return inFlight; // dedupe concurrent loads (single flight)
    if (cached && cacheTtlMs > 0 && Date.now() - cached.at < cacheTtlMs) return cached.value;
    inFlight = load(loadOpts)
      .then((value) => {
        if (cacheTtlMs > 0) cached = { value, at: Date.now() };
        return value;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

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
