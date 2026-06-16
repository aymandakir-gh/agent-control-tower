import { describe, expect, it } from 'vitest';
import { normalizeGenericUsage, parseGenericTranscript } from '../../src/core/generic.js';
import { GenericTranscriptBuilder } from '../fixtures/generic-builder.js';

const parse = (b: GenericTranscriptBuilder) => parseGenericTranscript(b.build());

describe('parseGenericTranscript — record kinds', () => {
  it('maps a prompt to a human_prompt event', () => {
    const t = parse(new GenericTranscriptBuilder().prompt('hello'));
    expect(t.events).toHaveLength(1);
    expect(t.events[0]).toMatchObject({ kind: 'human_prompt', text: 'hello' });
  });

  it('maps an assistant with tools to an assistant_message with toolUses', () => {
    const t = parse(
      new GenericTranscriptBuilder().assistant({
        text: 'thinking about it',
        thinking: 'hmm',
        tools: [{ name: 'shell', id: 't1' }],
        model: 'gpt-x',
      }),
    );
    const ev = t.events[0];
    expect(ev.kind).toBe('assistant_message');
    if (ev.kind !== 'assistant_message') throw new Error('unreachable');
    expect(ev.model).toBe('gpt-x');
    expect(ev.stopReason).toBe('tool_use');
    expect(ev.toolUses).toEqual([{ id: 't1', name: 'shell' }]);
    expect(ev.textLength).toBe('thinking about it'.length);
    expect(ev.hasThinking).toBe(true);
  });

  it('defaults an unnamed tool to "unknown" and skips non-object tool entries', () => {
    const t = parseGenericTranscript(
      JSON.stringify({
        ts: '2026-06-16T10:00:00Z',
        session: 's',
        kind: 'assistant',
        stop: 'tool_use',
        tools: [{ id: 'x' }, 'garbage', null, { name: 'Read', id: 'r1' }],
      }) + '\n',
    );
    const ev = t.events[0];
    if (ev.kind !== 'assistant_message') throw new Error('unreachable');
    expect(ev.toolUses).toEqual([{ id: 'x', name: 'unknown' }, { id: 'r1', name: 'Read' }]);
  });

  it('maps tool_result (error and ok)', () => {
    const t = parse(
      new GenericTranscriptBuilder()
        .toolResult({ toolUseId: 't1', error: true })
        .toolResult({ toolUseId: 't2', error: false }),
    );
    expect(t.events[0]).toMatchObject({ kind: 'tool_result', toolUseId: 't1', isError: true });
    expect(t.events[1]).toMatchObject({ kind: 'tool_result', toolUseId: 't2', isError: false });
  });

  it('maps a turn_duration record', () => {
    const t = parse(new GenericTranscriptBuilder().turnDuration(45_000, 3));
    expect(t.events[0]).toMatchObject({ kind: 'turn_duration', durationMs: 45_000, messageCount: 3 });
  });

  it('maps a system record and flags errors via error/level/subtype', () => {
    const t = parse(
      new GenericTranscriptBuilder()
        .system('informational')
        .system('hook_failed')
        .system('note', { level: 'error' })
        .system('note', { error: true }),
    );
    expect(t.events[0]).toMatchObject({ kind: 'system', subtype: 'informational', isError: false });
    expect(t.events[1]).toMatchObject({ kind: 'system', subtype: 'hook_failed', isError: true });
    expect(t.events[2]).toMatchObject({ kind: 'system', isError: true });
    expect(t.events[3]).toMatchObject({ kind: 'system', isError: true });
  });

  it('keeps unknown kinds as meta events', () => {
    const t = parse(new GenericTranscriptBuilder().raw({ ts: '2026-06-16T10:00:00Z', session: 's', kind: 'mystery' }));
    expect(t.events[0]).toMatchObject({ kind: 'meta', recordType: 'mystery' });
  });
});

describe('normalizeGenericUsage', () => {
  it('returns undefined for non-object usage', () => {
    expect(normalizeGenericUsage(undefined)).toBeUndefined();
    expect(normalizeGenericUsage(42)).toBeUndefined();
  });

  it('reads the normalized usage fields', () => {
    expect(
      normalizeGenericUsage({ input: 10, output: 5, cacheWrite5m: 2, cacheWrite1h: 3, cacheRead: 4 }),
    ).toEqual({ input: 10, output: 5, cacheWrite5m: 2, cacheWrite1h: 3, cacheRead: 4 });
  });

  it('attributes an aggregate cacheWrite to the 5m tier when no split is given', () => {
    expect(normalizeGenericUsage({ cacheWrite: 100 })).toMatchObject({ cacheWrite5m: 100, cacheWrite1h: 0 });
  });

  it('prefers an explicit split over the aggregate', () => {
    expect(normalizeGenericUsage({ cacheWrite: 100, cacheWrite5m: 7 })).toMatchObject({ cacheWrite5m: 7 });
  });
});

describe('parseGenericTranscript — robustness & structure', () => {
  it('skips blank, malformed, and non-object lines, counting them', () => {
    const text = [
      '',
      '   ',
      '{not json',
      '[1,2,3]',
      '"a string"',
      JSON.stringify({ ts: '2026-06-16T10:00:00Z', session: 's', kind: 'prompt', text: 'ok' }),
    ].join('\n');
    const t = parseGenericTranscript(text);
    expect(t.events).toHaveLength(1);
    expect(t.stats.totalLines).toBe(4); // 4 non-blank lines
    expect(t.stats.parsed).toBe(1);
    expect(t.stats.skipped).toBe(3);
  });

  it('never throws on garbage input', () => {
    expect(() => parseGenericTranscript('💥\n{}\nnull\n')).not.toThrow();
  });

  it('splits sidechain events from the main chain', () => {
    const main = new GenericTranscriptBuilder({ session: 's1' }).prompt('go').build();
    const side = new GenericTranscriptBuilder({ session: 's1', isSidechain: true, agentId: 'a1' })
      .assistant({ text: 'sub', stop: 'end_turn' })
      .build();
    const t = parseGenericTranscript(main + side);
    expect(t.events).toHaveLength(1);
    expect(t.sidechainEvents).toHaveLength(1);
    expect(t.sidechainEvents[0].agentId).toBe('a1');
  });

  it('captures session metadata (earliest session, latest cwd/branch)', () => {
    const text = [
      JSON.stringify({ ts: '2026-06-16T10:00:00Z', session: 'sess-1', slug: 'run-a', cwd: '/p/one', gitBranch: 'main', kind: 'prompt', text: 'a' }),
      JSON.stringify({ ts: '2026-06-16T10:01:00Z', session: 'sess-2', cwd: '/p/two', gitBranch: 'feat', kind: 'prompt', text: 'b' }),
    ].join('\n');
    const t = parseGenericTranscript(text);
    expect(t.sessionId).toBe('sess-1');
    expect(t.slug).toBe('run-a');
    expect(t.cwd).toBe('/p/two');
    expect(t.gitBranch).toBe('feat');
  });

  it('tolerates a record with no/invalid timestamp (ts → 0)', () => {
    const t = parseGenericTranscript(JSON.stringify({ session: 's', kind: 'prompt', text: 'x' }) + '\n');
    expect(t.events[0].ts).toBe(0);
    expect(t.events[0].tsIso).toBeUndefined();
  });
});
