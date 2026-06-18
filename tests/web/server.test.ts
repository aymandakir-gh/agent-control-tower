import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/web/server.js';
import { loadFleetView, sampleRoot, type FleetView } from '../../src/sources/transcripts.js';

let app: FastifyInstance;

beforeAll(() => {
  app = createServer({ sample: true });
});
afterAll(async () => {
  await app.close();
});

describe('web API (sample fleet)', () => {
  it('GET /api/health reports a healthy, read-only sample server', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.sample).toBe(true);
    expect(body.agents).toBe(5);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('GET /api/fleet returns the same core snapshot the TUI uses', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.agents).toHaveLength(5);
    expect(body.totals.byStatus).toEqual({ working: 2, waiting: 1, error: 1, idle: 1 });
    expect(body.totals.costUsd).toBeGreaterThan(0);
    const working = body.agents.find((a: { project: string }) => a.project === 'api-server');
    expect(working.status).toBe('working');
    expect(working.currentTool).toBe('Bash');
  });

  it('GET /api/timeline honors the limit', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/timeline?limit=3' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entries).toHaveLength(3);
    expect(body.count).toBe(3);
  });

  it('GET /api/timeline?limit=0 returns an empty list (not the whole array)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/timeline?limit=0' });
    expect(res.statusCode).toBe(200);
    expect(res.json().entries).toHaveLength(0);
    expect(res.json().count).toBe(0);
  });

  it('GET /api/agents/:id returns one agent, 404 when unknown', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/agents/a1111111-working-bash' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().agent.sessionId).toBe('a1111111-working-bash');

    const miss = await app.inject({ method: 'GET', url: '/api/agents/nope' });
    expect(miss.statusCode).toBe(404);
    expect(miss.json().error).toMatch(/not found/);
  });

  it('GET /api/agents/:id/replay reconstructs a session, 404 when unknown', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/agents/a1111111-working-bash/replay' });
    expect(ok.statusCode).toBe(200);
    const replay = ok.json().replay;
    expect(replay.sessionId).toBe('a1111111-working-bash');
    expect(replay.frames.length).toBeGreaterThan(0);
    expect(replay.timeline.length).toBeGreaterThan(0);

    const miss = await app.inject({ method: 'GET', url: '/api/agents/nope/replay' });
    expect(miss.statusCode).toBe(404);
  });

  it('GET /api/trend returns a cumulative cost series', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/trend' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.bucketMs).toBe(3_600_000);
    expect(Array.isArray(body.points)).toBe(true);
    expect(body.count).toBe(body.points.length);
    if (body.points.length > 0) {
      expect(body.points[0]).toHaveProperty('cumulativeUsd');
    }
  });

  it('GET /api/trend?bucketMs honors a custom bucket width', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/trend?bucketMs=60000' });
    expect(res.json().bucketMs).toBe(60_000);
  });

  it('GET /api/trend echoes the bucket actually used for non-positive/garbage widths', async () => {
    // Regression: 0 / negative used to be echoed verbatim while bucketing fell back to 1h.
    for (const q of ['0', '-100', 'abc']) {
      const res = await app.inject({ method: 'GET', url: `/api/trend?bucketMs=${q}` });
      expect(res.json().bucketMs).toBe(3_600_000);
    }
  });

  it('GET / serves the self-contained dashboard with the upgraded features', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('agent-control-tower');
    expect(res.body).toContain('/api/fleet');
    // M9: live refresh control, filtering, drill-down, cost trend — all inline.
    expect(res.body).toContain('/api/trend');
    expect(res.body).toContain('/api/agents/');
    expect(res.body).toContain('renderTrend');
    expect(res.body).toContain('openDrawer');
    expect(res.body).toContain('statusFilter');
    // Offline guarantee: no external resource references.
    expect(res.body).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/);
  });

  it('GET /api/sources lists adapters and the active source', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sources' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.active).toBe('claude-code');
    expect(body.sources.map((s: { id: string }) => s.id).sort()).toEqual(['claude-code', 'generic-jsonl']);
    expect(body.sources.find((s: { id: string }) => s.id === 'generic-jsonl').displayName).toBe('Generic JSONL / hook');
  });

  it('GET /api/alerts surfaces alerts (error + waiting) with a summary', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/alerts' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // The sample fleet has one error agent and one waiting-for-input agent.
    expect(body.summary.total).toBeGreaterThanOrEqual(2);
    expect(body.alerts.some((a: { type: string }) => a.type === 'error')).toBe(true);
    expect(body.alerts.some((a: { type: string }) => a.type === 'waiting')).toBe(true);
    // most-urgent first
    expect(body.alerts[0].severity).toBe('critical');
  });

  it('GET /api/fleet embeds the same alerts + summary', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    const body = res.json();
    expect(body.alertSummary.total).toBe(body.alerts.length);
    expect(body.alertSummary.critical).toBeGreaterThanOrEqual(1);
  });
});

describe('web API — request-level load dedup (perf)', () => {
  it('shares ONE fleet scan across a parallel dashboard refresh cycle', async () => {
    // Regression: every read endpoint called view() → load() → a full transcript
    // scan, so the dashboard's 4 parallel fetches re-walked + re-parsed the whole
    // tree 4× per 3s cycle. Single-flight + a short TTL must collapse the burst.
    const base = await loadFleetView({ sample: true });
    let loads = 0;
    const loader = async (): Promise<FleetView> => {
      loads++;
      return base;
    };
    const srv = createServer({ sample: true, loader });
    try {
      const responses = await Promise.all([
        srv.inject({ method: 'GET', url: '/api/fleet' }),
        srv.inject({ method: 'GET', url: '/api/timeline?limit=80' }),
        srv.inject({ method: 'GET', url: '/api/trend' }),
        srv.inject({ method: 'GET', url: '/api/health' }),
      ]);
      // Every response is still correct…
      for (const r of responses) expect(r.statusCode).toBe(200);
      // …and they were all served from a single scan.
      expect(loads).toBeLessThanOrEqual(1);
    } finally {
      await srv.close();
    }
  });

  it('re-scans after the freshness window so data does not go stale', async () => {
    let loads = 0;
    const loader = async (): Promise<FleetView> => {
      loads++;
      return loadFleetView({ sample: true });
    };
    // ttl=0 disables the freshness cache; sequential (non-concurrent) requests
    // each scan, proving the cache is a short window and not a permanent freeze.
    const srv = createServer({ sample: true, loader, cacheTtlMs: 0 });
    try {
      await srv.inject({ method: 'GET', url: '/api/fleet' });
      await srv.inject({ method: 'GET', url: '/api/health' });
      expect(loads).toBe(2);
    } finally {
      await srv.close();
    }
  });
});

describe('web API — configurable alert rules', () => {
  it('honors injected alert rules (cost ceiling fires)', async () => {
    const { resolveAlertRules } = await import('../../src/core/index.js');
    const rooted = createServer({ sample: true, alertRules: resolveAlertRules({ costUsd: 0.01 }) });
    try {
      const res = await rooted.inject({ method: 'GET', url: '/api/alerts' });
      const body = res.json();
      expect(body.alerts.some((a: { type: string }) => a.type === 'cost')).toBe(true);
    } finally {
      await rooted.close();
    }
  });
});

describe('web API — management actions (PRD §15)', () => {
  it('does NOT register the control endpoint by default', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/a1111111-working-bash/control',
      payload: { action: 'pause' },
    });
    expect(res.statusCode).toBe(404);
    const health = (await app.inject({ method: 'GET', url: '/api/health' })).json();
    expect(health.control).toBe(false);
  });

  it('acts when an enabled control setup is injected, and refuses unknown actions/agents', async () => {
    const { FakeController } = await import('../../src/control/index.js');
    const controller = new FakeController({ allow: true, protectedPids: [1] });
    const control = { controller, locator: { locate: async () => 4242 }, enabled: true };
    const srv = createServer({ sample: true, control });
    try {
      const ok = await srv.inject({ method: 'POST', url: '/api/agents/a1111111-working-bash/control', payload: { action: 'pause' } });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().result.ok).toBe(true);
      expect(ok.json().result.pid).toBe(4242);
      expect(controller.calls).toHaveLength(1);

      const bad = await srv.inject({ method: 'POST', url: '/api/agents/a1111111-working-bash/control', payload: { action: 'kill' } });
      expect(bad.statusCode).toBe(400);

      const missing = await srv.inject({ method: 'POST', url: '/api/agents/nope/control', payload: { action: 'pause' } });
      expect(missing.statusCode).toBe(404);

      expect((await srv.inject({ method: 'GET', url: '/api/health' })).json().control).toBe(true);
    } finally {
      await srv.close();
    }
  });

  it('refuses (200, ok:false) when control is injected but disabled', async () => {
    const { FakeController, NullProcessLocator } = await import('../../src/control/index.js');
    const controller = new FakeController({ allow: false });
    const control = { controller, locator: new NullProcessLocator(), enabled: false };
    const srv = createServer({ sample: true, control });
    try {
      const res = await srv.inject({ method: 'POST', url: '/api/agents/a1111111-working-bash/control', payload: { action: 'pause' } });
      expect(res.statusCode).toBe(200);
      expect(res.json().result.ok).toBe(false);
      expect(res.json().result.reason).toContain('disabled');
    } finally {
      await srv.close();
    }
  });
});

describe('web API — explicit --root', () => {
  it('honors a root option instead of the default ~/.claude root', async () => {
    const rooted = createServer({ root: sampleRoot() });
    try {
      const res = await rooted.inject({ method: 'GET', url: '/api/health' });
      const body = res.json();
      expect(body.root).toBe(sampleRoot());
      expect(body.sample).toBe(false);
      expect(body.agents).toBe(5);
    } finally {
      await rooted.close();
    }
  });
});
