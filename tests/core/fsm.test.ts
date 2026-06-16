import { describe, expect, it } from 'vitest';
import { deriveAgentState } from '../../src/core/fsm.js';
import { parseTranscript } from '../../src/core/parser.js';
import { TranscriptBuilder } from '../fixtures/builder.js';

const parse = (b: TranscriptBuilder) => parseTranscript(b.build());

describe('deriveAgentState — precedence table (PRD §6)', () => {
  it('row 1: interactive tool pending → waiting', () => {
    const b = new TranscriptBuilder();
    b.prompt('which option?').assistant({ tools: [{ name: 'AskUserQuestion', id: 'toolu_1' }] });
    const snap = deriveAgentState(parse(b), b.clock + 5_000);
    expect(snap.status).toBe('waiting');
    expect(snap.currentTool).toBe('AskUserQuestion');
    expect(snap.reason).toContain('AskUserQuestion');
  });

  it('row 2: unresolved (non-interactive) tool_use → working', () => {
    const b = new TranscriptBuilder();
    b.prompt('run tests').assistant({ tools: [{ name: 'Bash', id: 'toolu_1' }] });
    const snap = deriveAgentState(parse(b), b.clock + 2_000);
    expect(snap.status).toBe('working');
    expect(snap.currentTool).toBe('Bash');
    expect(snap.reason).toContain('Bash');
  });

  it('row 3: tool results in, last assistant stop_reason was tool_use → working', () => {
    const b = new TranscriptBuilder();
    b.prompt('run tests')
      .assistant({ tools: [{ name: 'Bash', id: 'toolu_1' }] })
      .toolResult({ toolUseId: 'toolu_1' });
    const snap = deriveAgentState(parse(b), b.clock + 2_000);
    expect(snap.status).toBe('working');
    expect(snap.reason).toContain('tool results');
  });

  it('row 4: last record is a human prompt with no reply → working', () => {
    const b = new TranscriptBuilder();
    b.prompt('hello there');
    const snap = deriveAgentState(parse(b), b.clock + 2_000);
    expect(snap.status).toBe('working');
    expect(snap.reason).toContain('responding');
  });

  it('row 5a: turn ended on a tool error → error', () => {
    const b = new TranscriptBuilder();
    b.prompt('build it')
      .assistant({ tools: [{ name: 'Bash', id: 'toolu_1' }] })
      .toolResult({ toolUseId: 'toolu_1', isError: true })
      .assistant({ text: 'that failed', stopReason: 'end_turn' });
    const snap = deriveAgentState(parse(b), b.clock + 2_000);
    expect(snap.status).toBe('error');
    expect(snap.reason).toContain('tool error');
  });

  it('row 5b: trailing system error → error', () => {
    const b = new TranscriptBuilder();
    b.prompt('go')
      .assistant({ text: 'done', stopReason: 'end_turn' })
      .system('informational', { level: 'error' });
    const snap = deriveAgentState(parse(b), b.clock + 2_000);
    expect(snap.status).toBe('error');
    expect(snap.reason).toContain('system error');
  });

  it('a later successful tool result clears the error (not error)', () => {
    const b = new TranscriptBuilder();
    b.prompt('go')
      .assistant({ tools: [{ name: 'Bash', id: 'toolu_1' }] })
      .toolResult({ toolUseId: 'toolu_1', isError: true })
      .assistant({ tools: [{ name: 'Bash', id: 'toolu_2' }] })
      .toolResult({ toolUseId: 'toolu_2', isError: false })
      .assistant({ text: 'fixed', stopReason: 'end_turn' });
    const snap = deriveAgentState(parse(b), b.clock + 2_000);
    expect(snap.status).toBe('waiting');
  });

  it('row 6: completed turn, stale beyond idleMs → idle', () => {
    const b = new TranscriptBuilder();
    b.prompt('go').assistant({ text: 'done', stopReason: 'end_turn' });
    const snap = deriveAgentState(parse(b), b.clock + 5 * 60_000);
    expect(snap.status).toBe('idle');
    expect(snap.isStale).toBe(true);
  });

  it('row 7: completed turn, recent → waiting for next prompt', () => {
    const b = new TranscriptBuilder();
    b.prompt('go').assistant({ text: 'done', stopReason: 'end_turn' });
    const snap = deriveAgentState(parse(b), b.clock + 5_000);
    expect(snap.status).toBe('waiting');
    expect(snap.isStale).toBe(false);
    expect(snap.reason).toContain('awaiting next prompt');
  });

  it('treats stop_sequence as a completed turn', () => {
    const b = new TranscriptBuilder();
    b.prompt('go').assistant({ text: 'done', stopReason: 'stop_sequence' });
    const snap = deriveAgentState(parse(b), b.clock + 5_000);
    expect(snap.status).toBe('waiting');
  });

  it('resolves a pending tool via FIFO when the result id does not match', () => {
    const b = new TranscriptBuilder();
    b.prompt('go')
      .assistant({ tools: [{ name: 'Bash', id: 'toolu_1' }] })
      .toolResult({ toolUseId: 'does-not-match' });
    const snap = deriveAgentState(parse(b), b.clock + 2_000);
    expect(snap.status).toBe('working');
    expect(snap.reason).toContain('tool results');
  });

  it('empty transcript → idle', () => {
    const snap = deriveAgentState(parseTranscript(''), Date.parse('2026-06-16T10:00:00Z'));
    expect(snap.status).toBe('idle');
    expect(snap.reason).toContain('no agent activity');
  });
});

describe('deriveAgentState — timing', () => {
  it('reports elapsed duration for an active turn (now − turnStart)', () => {
    const b = new TranscriptBuilder({ startTs: Date.parse('2026-06-16T10:00:00Z'), stepMs: 1000 });
    b.prompt('go'); // prompt at start+1000
    const snap = deriveAgentState(parse(b), b.clock + 3_000);
    expect(snap.status).toBe('working');
    expect(snap.turnDurationMs).toBe(3_000);
  });

  it('uses the recorded turn_duration for a completed turn', () => {
    const b = new TranscriptBuilder();
    b.prompt('go').assistant({ text: 'done', stopReason: 'end_turn' }).turnDuration(45_000, 3);
    const snap = deriveAgentState(parse(b), b.clock + 5_000);
    expect(snap.turnDurationMs).toBe(45_000);
  });
});

describe('deriveAgentState — accounting', () => {
  it('aggregates tokens & cost across main chain and subagents', () => {
    const main = new TranscriptBuilder({ sessionId: 's1', model: 'claude-opus-4-8' });
    main.prompt('go').assistant({ text: 'working', stopReason: 'end_turn', usage: { input: 1000, output: 500 } });
    const side = new TranscriptBuilder({
      sessionId: 's1',
      isSidechain: true,
      agentId: 'agent-1',
      model: 'claude-sonnet-4-6',
    }).assistant({ text: 'sub', stopReason: 'end_turn', usage: { input: 200, output: 100 } });

    const parsed = parseTranscript(main.build() + side.build());
    const snap = deriveAgentState(parsed, main.clock + 5_000);

    expect(snap.tokens.input).toBe(1200);
    expect(snap.tokens.output).toBe(600);
    expect(snap.totalTokens).toBe(1800);
    expect(snap.subagentCount).toBe(1);
    expect(snap.model).toBe('claude-opus-4-8');
    // opus: (1000*15 + 500*75)/1e6 = 0.0525 ; sonnet: (200*3 + 100*15)/1e6 = 0.0021
    expect(snap.cost.usd).toBeCloseTo(0.0546, 6);
    expect(snap.cost.estimated).toBe(false);
  });

  it('exposes session metadata in the snapshot', () => {
    const b = new TranscriptBuilder({
      sessionId: 'sess-9',
      slug: 'happy-panda',
      cwd: '/Users/dev/projects/api-server',
      gitBranch: 'main',
    });
    b.prompt('go').assistant({ text: 'ok', stopReason: 'end_turn' });
    const snap = deriveAgentState(parse(b), b.clock + 1_000);
    expect(snap).toMatchObject({
      sessionId: 'sess-9',
      slug: 'happy-panda',
      project: 'api-server',
      gitBranch: 'main',
    });
  });
});
