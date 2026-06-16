import { describe, expect, it } from 'vitest';
import { loadFleetView, sampleRoot, scanRoot } from '../../src/sources/transcripts.js';
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
});
