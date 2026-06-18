import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADAPTERS,
  claudeCodeAdapter,
  genericJsonlAdapter,
  getAdapter,
  isKnownSource,
  listSourceIds,
  loadFleetView,
  scanRoot,
} from '../../src/sources/index.js';
import { GenericTranscriptBuilder } from '../fixtures/generic-builder.js';

describe('adapter registry', () => {
  it('lists both shipped adapters', () => {
    expect(listSourceIds().sort()).toEqual(['claude-code', 'generic-jsonl']);
    expect(Object.keys(ADAPTERS).sort()).toEqual(['claude-code', 'generic-jsonl']);
  });

  it('resolves adapters by id, defaulting to Claude Code only when none is given', () => {
    expect(getAdapter('generic-jsonl')).toBe(genericJsonlAdapter);
    expect(getAdapter('claude-code')).toBe(claudeCodeAdapter);
    expect(getAdapter(undefined)).toBe(claudeCodeAdapter);
  });

  it('throws on an explicit but unknown source instead of silently falling back', () => {
    // A typo'd --source must not quietly serve Claude Code data.
    expect(() => getAdapter('nope')).toThrow(/unknown source "nope"/);
    expect(() => getAdapter('nope')).toThrow(/claude-code/); // lists valid ids
  });

  it('reports known sources', () => {
    expect(isKnownSource('generic-jsonl')).toBe(true);
    expect(isKnownSource('bogus')).toBe(false);
  });

  it('each adapter exposes a default root and extension', () => {
    expect(claudeCodeAdapter.defaultRoot()).toMatch(/\.claude[/\\]projects$/);
    expect(genericJsonlAdapter.defaultRoot()).toMatch(/agent-control-tower[/\\]sessions$/);
    expect(genericJsonlAdapter.extension).toBe('.jsonl');
  });
});

describe('generic adapter — read-only discover + read against a temp dir', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'act-generic-'));
    const proj = join(dir, 'project-x');
    await mkdir(proj, { recursive: true });
    // Session with explicit `session` id.
    const a = new GenericTranscriptBuilder({ session: 'gen-1', cwd: '/work/project-x' })
      .prompt('run tests')
      .assistant({ tools: [{ name: 'Bash', id: 't1' }] });
    await writeFile(join(proj, 'gen-1.jsonl'), a.build());
    // Session WITHOUT a `session` field → adapter backfills id from filename.
    const b = new GenericTranscriptBuilder()
      .raw({ ts: '2026-06-16T10:00:01Z', kind: 'prompt', text: 'hi' });
    await writeFile(join(proj, 'from-filename.jsonl'), b.build());
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('discovers and parses generic transcripts', async () => {
    const refs = await genericJsonlAdapter.discover(dir);
    expect(refs).toHaveLength(2);
    const parsed = await scanRoot(dir, genericJsonlAdapter);
    expect(parsed).toHaveLength(2);
  });

  it('backfills a missing sessionId from the filename', async () => {
    const refs = await genericJsonlAdapter.discover(dir);
    const ref = refs.find((r) => r.path.endsWith('from-filename.jsonl'));
    expect(ref).toBeDefined();
    const parsed = await genericJsonlAdapter.read(ref!);
    expect(parsed.sessionId).toBe('from-filename');
  });

  it('loadFleetView with source=generic-jsonl derives correct fleet state', async () => {
    const view = await loadFleetView(dir, { source: 'generic-jsonl', now: Date.parse('2026-06-16T10:05:00Z') });
    expect(view.source).toBe('generic-jsonl');
    expect(view.sourceName).toBe('Generic JSONL / hook');
    expect(view.fleet.totals.agents).toBe(2);
    const working = view.fleet.agents.find((agent) => agent.sessionId === 'gen-1');
    expect(working?.status).toBe('working');
    expect(working?.currentTool).toBe('Bash');
  });
});

describe('loadFleetView — source selection defaults', () => {
  it('sample mode always uses the Claude Code adapter regardless of --source', async () => {
    const view = await loadFleetView({ sample: true, source: 'generic-jsonl' });
    expect(view.source).toBe('claude-code');
    expect(view.fleet.totals.agents).toBe(5);
  });
});
