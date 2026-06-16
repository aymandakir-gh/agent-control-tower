import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFleetView, readTranscript, sampleRoot, scanRoot } from '../../src/sources/transcripts.js';
import type { AgentSnapshot } from '../../src/core/index.js';

const byProject = (agents: AgentSnapshot[], project: string): AgentSnapshot =>
  agents.find((a) => a.project === project)!;

describe('sources/transcripts — sample fleet', () => {
  it('loads all five sample sessions', async () => {
    const view = await loadFleetView({ sample: true });
    expect(view.sample).toBe(true);
    expect(view.fileCount).toBe(5);
    expect(view.fleet.agents).toHaveLength(5);
    expect(view.root).toBe(sampleRoot());
  });

  it('derives the intended state for each sample agent', async () => {
    const { fleet } = await loadFleetView({ sample: true });
    const a = fleet.agents;

    expect(byProject(a, 'api-server').status).toBe('working');
    expect(byProject(a, 'api-server').currentTool).toBe('Bash');

    expect(byProject(a, 'web-app').status).toBe('waiting');
    expect(byProject(a, 'web-app').currentTool).toBe('AskUserQuestion');

    expect(byProject(a, 'data-pipeline').status).toBe('error');

    expect(byProject(a, 'marketing-site').status).toBe('idle');
    expect(byProject(a, 'marketing-site').isStale).toBe(true);

    const infra = byProject(a, 'infra');
    expect(infra.status).toBe('working');
    expect(infra.currentTool).toBe('Agent');
    expect(infra.subagentCount).toBe(1);
  });

  it('aggregates fleet totals and a sorted timeline', async () => {
    const view = await loadFleetView({ sample: true });
    expect(view.fleet.totals.byStatus).toEqual({ working: 2, waiting: 1, error: 1, idle: 1 });
    expect(view.fleet.totals.costUsd).toBeGreaterThan(0);
    expect(view.timeline.length).toBeGreaterThan(0);
    for (let i = 1; i < view.timeline.length; i++) {
      expect(view.timeline[i].ts).toBeGreaterThanOrEqual(view.timeline[i - 1].ts);
    }
  });

  it('scanRoot returns parsed transcripts and never throws on a missing root', async () => {
    const none = await scanRoot('/no/such/path/hopefully');
    expect(none).toEqual([]);
  });

  it('honors an explicit root passed via options.root (not just sample/default)', async () => {
    const view = await loadFleetView({ root: sampleRoot() });
    expect(view.root).toBe(sampleRoot());
    expect(view.sample).toBe(false);
    expect(view.fileCount).toBe(5);
  });
});

describe('sources/transcripts — sessionId backfill', () => {
  it('backfills sessionId from the filename when records omit it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'act-bf-'));
    try {
      const file = join(dir, 'fallback-name.jsonl');
      // A record with NO sessionId field.
      await writeFile(
        file,
        JSON.stringify({ type: 'assistant', timestamp: '2026-06-16T10:00:00.000Z', message: { role: 'assistant', model: 'claude-opus-4-8', content: [], stop_reason: 'end_turn' } }) + '\n',
      );
      const parsed = await readTranscript(file);
      expect(parsed.sessionId).toBe('fallback-name');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
