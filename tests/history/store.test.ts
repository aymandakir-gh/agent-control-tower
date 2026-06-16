import { mkdtemp, readFile, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertHistoryPathSafe,
  defaultHistoryPath,
  isUnderRoot,
  readHistory,
  recordFleetSample,
  recordSample,
  sampleFromView,
  type HistorySample,
} from '../../src/history/store.js';
import { loadFleetView, sampleRoot } from '../../src/sources/index.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'act-history-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const mk = (ts: number, over: Partial<HistorySample> = {}): HistorySample => ({
  ts,
  agents: 3,
  byStatus: { working: 1, waiting: 1, error: 0, idle: 1 },
  totalTokens: 1000,
  costUsd: 0.5,
  alerts: 1,
  ...over,
});

describe('history store', () => {
  it('appends samples and reads them back chronologically', async () => {
    const path = join(dir, 'sub', 'history.jsonl'); // dir does not exist yet
    await recordSample(path, mk(2000));
    await recordSample(path, mk(1000)); // out of order on disk
    const samples = await readHistory(path);
    expect(samples.map((s) => s.ts)).toEqual([1000, 2000]); // sorted ascending
    expect((await readFile(path, 'utf8')).trim().split('\n')).toHaveLength(2);
  });

  it('returns [] for a missing file', async () => {
    expect(await readHistory(join(dir, 'nope.jsonl'))).toEqual([]);
  });

  it('skips malformed / partial lines', async () => {
    const path = join(dir, 'h.jsonl');
    await recordSample(path, mk(1000));
    await appendFile(path, '{not json\n{"no":"ts"}\n', 'utf8');
    await recordSample(path, mk(2000));
    const samples = await readHistory(path);
    expect(samples.map((s) => s.ts)).toEqual([1000, 2000]);
  });

  it('derives a compact sample from a fleet view', async () => {
    const view = await loadFleetView({ sample: true });
    const sample = sampleFromView(view);
    expect(sample.agents).toBe(5);
    expect(sample.byStatus).toEqual(view.fleet.totals.byStatus);
    expect(sample.costUsd).toBeGreaterThan(0);
    expect(sample.alerts).toBe(view.alerts.length);
    expect(sample.ts).toBe(view.now);
  });

  it('recordFleetSample writes a sample derived from the view', async () => {
    const path = join(dir, 'h.jsonl');
    const view = await loadFleetView({ sample: true });
    const sample = await recordFleetSample(view, path);
    const read = await readHistory(path);
    expect(read).toHaveLength(1);
    expect(read[0].agents).toBe(sample.agents);
  });
});

describe('read-only invariant — history never lands under the scanned root', () => {
  it('isUnderRoot detects descendants, the root itself, and rejects outsiders', () => {
    expect(isUnderRoot('/a/b/c/h.jsonl', '/a/b')).toBe(true);
    expect(isUnderRoot('/a/b', '/a/b')).toBe(true);
    expect(isUnderRoot('/a/sibling/h.jsonl', '/a/b')).toBe(false);
    expect(isUnderRoot('/x/y/h.jsonl', '/a/b')).toBe(false);
  });

  it('assertHistoryPathSafe throws for a path inside the scan root', () => {
    expect(() => assertHistoryPathSafe('/root/projects/x.jsonl', '/root/projects')).toThrow(/refusing to write history/);
    expect(() => assertHistoryPathSafe('/elsewhere/h.jsonl', '/root/projects')).not.toThrow();
  });

  it('recordFleetSample refuses to write under the scanned root, but writes outside it', async () => {
    const view = await loadFleetView({ sample: true }); // view.root === sampleRoot()
    const underRoot = join(sampleRoot(), 'history.jsonl');
    await expect(recordFleetSample(view, underRoot)).rejects.toThrow(/refusing to write history/);

    const safe = join(dir, 'ok.jsonl');
    await expect(recordFleetSample(view, safe)).resolves.toBeTruthy();
    expect(await readHistory(safe)).toHaveLength(1);
  });
});

describe('defaultHistoryPath', () => {
  const ORIG = process.env.XDG_STATE_HOME;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = ORIG;
  });

  it('lives in an app state dir, never under ~/.claude', () => {
    delete process.env.XDG_STATE_HOME;
    const p = defaultHistoryPath();
    expect(p).toContain('agent-control-tower');
    expect(p).toContain('history.jsonl');
    expect(p).not.toContain(join('.claude', 'projects'));
  });

  it('honors $XDG_STATE_HOME', () => {
    process.env.XDG_STATE_HOME = '/custom/state';
    expect(defaultHistoryPath()).toBe('/custom/state/agent-control-tower/history.jsonl');
  });
});
