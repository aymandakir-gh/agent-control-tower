import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/web/server.js';

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

  it('GET /api/agents/:id returns one agent, 404 when unknown', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/agents/a1111111-working-bash' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().agent.sessionId).toBe('a1111111-working-bash');

    const miss = await app.inject({ method: 'GET', url: '/api/agents/nope' });
    expect(miss.statusCode).toBe(404);
    expect(miss.json().error).toMatch(/not found/);
  });

  it('GET / serves the self-contained dashboard', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('agent-control-tower');
    expect(res.body).toContain('/api/fleet');
  });
});
