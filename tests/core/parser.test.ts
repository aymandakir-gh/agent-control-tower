import { describe, expect, it } from 'vitest';
import { normalizeUsage, parseTranscript } from '../../src/core/parser.js';
import { TranscriptBuilder } from '../fixtures/builder.js';
import type { AssistantMessageEvent, ToolResultEvent } from '../../src/core/types.js';

describe('parseTranscript — normalization', () => {
  it('normalizes an assistant message: model, usage, tool_use, text, thinking', () => {
    const text = new TranscriptBuilder({ model: 'claude-sonnet-4-6' })
      .assistant({
        thinking: 'hmm',
        text: 'hello world',
        tools: [{ name: 'Bash', id: 'toolu_1' }],
        usage: { input: 100, output: 20, cacheRead: 5, cacheWrite5m: 10 },
      })
      .build();
    const parsed = parseTranscript(text);
    expect(parsed.events).toHaveLength(1);
    const ev = parsed.events[0] as AssistantMessageEvent;
    expect(ev.kind).toBe('assistant_message');
    expect(ev.model).toBe('claude-sonnet-4-6');
    expect(ev.hasThinking).toBe(true);
    expect(ev.textLength).toBe('hello world'.length);
    expect(ev.toolUses).toEqual([{ id: 'toolu_1', name: 'Bash' }]);
    expect(ev.usage).toEqual({
      input: 100,
      output: 20,
      cacheWrite5m: 10,
      cacheWrite1h: 0,
      cacheRead: 5,
    });
    expect(ev.stopReason).toBe('tool_use');
  });

  it('parses a human prompt (string content)', () => {
    const text = new TranscriptBuilder().prompt('do the thing').build();
    const parsed = parseTranscript(text);
    expect(parsed.events[0]).toMatchObject({ kind: 'human_prompt', text: 'do the thing' });
  });

  it('parses a tool_result and flags errors', () => {
    const text = new TranscriptBuilder()
      .assistant({ tools: [{ name: 'Bash', id: 'toolu_1' }] })
      .toolResult({ toolUseId: 'toolu_1', isError: true, content: 'boom' })
      .build();
    const parsed = parseTranscript(text);
    const tr = parsed.events[1] as ToolResultEvent;
    expect(tr.kind).toBe('tool_result');
    expect(tr.isError).toBe(true);
    expect(tr.toolUseId).toBe('toolu_1');
  });

  it('emits one tool_result event per block when results are batched in one message', () => {
    const text =
      JSON.stringify({
        type: 'user',
        timestamp: '2026-06-16T10:00:00.000Z',
        sessionId: 's1',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_1', is_error: false, content: 'ok' },
            { type: 'tool_result', tool_use_id: 'toolu_2', is_error: true, content: 'boom' },
          ],
        },
      }) + '\n';
    const parsed = parseTranscript(text);
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0]).toMatchObject({ kind: 'tool_result', toolUseId: 'toolu_1', isError: false, seq: 0 });
    expect(parsed.events[1]).toMatchObject({ kind: 'tool_result', toolUseId: 'toolu_2', isError: true, seq: 1 });
  });

  it('treats a user array of text blocks (no tool_result) as a human prompt', () => {
    const text =
      JSON.stringify({
        type: 'user',
        timestamp: '2026-06-16T10:00:00.000Z',
        sessionId: 's1',
        message: { role: 'user', content: [{ type: 'text', text: 'part-a ' }, { type: 'text', text: 'part-b' }] },
      }) + '\n';
    const parsed = parseTranscript(text);
    expect(parsed.events[0]).toMatchObject({ kind: 'human_prompt', text: 'part-a part-b' });
  });

  it('parses system turn_duration markers', () => {
    const text = new TranscriptBuilder().turnDuration(53000, 12).build();
    const parsed = parseTranscript(text);
    expect(parsed.events[0]).toMatchObject({ kind: 'turn_duration', durationMs: 53000, messageCount: 12 });
  });

  it('flags system error records', () => {
    const text = new TranscriptBuilder()
      .system('informational', { level: 'error' })
      .build();
    const parsed = parseTranscript(text);
    expect(parsed.events[0]).toMatchObject({ kind: 'system', isError: true });
  });

  it('handles assistant content provided as a plain string', () => {
    const text =
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-06-16T10:00:00.000Z',
        sessionId: 's1',
        message: { role: 'assistant', model: 'claude-opus-4-8', content: 'just text', stop_reason: 'end_turn' },
      }) + '\n';
    const ev = parseTranscript(text).events[0] as AssistantMessageEvent;
    expect(ev.kind).toBe('assistant_message');
    expect(ev.textLength).toBe('just text'.length);
    expect(ev.toolUses).toEqual([]);
  });

  it('ignores non-text blocks when collapsing a user array to a prompt', () => {
    const text =
      JSON.stringify({
        type: 'user',
        timestamp: '2026-06-16T10:00:00.000Z',
        sessionId: 's1',
        message: {
          role: 'user',
          content: [{ type: 'image', source: {} }, { type: 'text', text: 'caption' }],
        },
      }) + '\n';
    expect(parseTranscript(text).events[0]).toMatchObject({ kind: 'human_prompt', text: 'caption' });
  });

  it('keeps unknown record types as meta without throwing', () => {
    const text = new TranscriptBuilder()
      .raw({ type: 'file-history-snapshot', timestamp: '2026-06-16T10:00:00.000Z' })
      .build();
    const parsed = parseTranscript(text);
    expect(parsed.events[0]).toMatchObject({ kind: 'meta', recordType: 'file-history-snapshot' });
  });
});

describe('parseTranscript — robustness (PRD §5)', () => {
  it('skips malformed JSON, blank lines, and partial trailing lines without throwing', () => {
    const good = new TranscriptBuilder().prompt('hi').build().trim();
    const text = ['', good, '{not json', '   ', '42', '{"partial": ', ''].join('\n');
    const parsed = parseTranscript(text);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.stats.skipped).toBeGreaterThanOrEqual(3);
    expect(parsed.stats.parsed).toBe(1);
  });

  it('handles an empty string', () => {
    const parsed = parseTranscript('');
    expect(parsed.events).toHaveLength(0);
    expect(parsed.stats.totalLines).toBe(0);
  });

  it('treats a bare JSON array line as unparseable (not an object)', () => {
    const parsed = parseTranscript('[1,2,3]\n');
    expect(parsed.stats.skipped).toBe(1);
    expect(parsed.events).toHaveLength(0);
  });
});

describe('parseTranscript — metadata & sidechains', () => {
  it('extracts session metadata from records', () => {
    const text = new TranscriptBuilder({
      sessionId: 'sess-abc',
      slug: 'brave-otter',
      cwd: '/Users/dev/projects/api',
      gitBranch: 'feature/x',
      version: '2.1.200',
    })
      .prompt('hi')
      .build();
    const parsed = parseTranscript(text);
    expect(parsed).toMatchObject({
      sessionId: 'sess-abc',
      slug: 'brave-otter',
      cwd: '/Users/dev/projects/api',
      gitBranch: 'feature/x',
      version: '2.1.200',
    });
  });

  it('splits sidechain (subagent) events from the main chain', () => {
    const main = new TranscriptBuilder({ sessionId: 's1' });
    main.prompt('hi').assistant({ tools: [{ name: 'Agent', id: 'toolu_1' }] });
    const sideText = new TranscriptBuilder({ sessionId: 's1', isSidechain: true, agentId: 'agent-9' })
      .assistant({ text: 'subagent work', usage: { input: 10, output: 2 } })
      .build();
    const parsed = parseTranscript(main.build() + sideText);
    expect(parsed.events.every((e) => !e.isSidechain)).toBe(true);
    expect(parsed.sidechainEvents).toHaveLength(1);
    expect(parsed.sidechainEvents[0].agentId).toBe('agent-9');
  });
});

describe('normalizeUsage', () => {
  it('returns undefined for non-objects', () => {
    expect(normalizeUsage(undefined)).toBeUndefined();
    expect(normalizeUsage(null)).toBeUndefined();
    expect(normalizeUsage(42)).toBeUndefined();
  });

  it('falls back to aggregate cache_creation when the split is absent', () => {
    const u = normalizeUsage({ input_tokens: 5, cache_creation_input_tokens: 30 });
    expect(u).toMatchObject({ input: 5, cacheWrite5m: 30, cacheWrite1h: 0 });
  });

  it('coerces non-numeric token fields to 0', () => {
    const u = normalizeUsage({ input_tokens: 'x', output_tokens: null });
    expect(u).toMatchObject({ input: 0, output: 0 });
  });
});
