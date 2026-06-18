import { describe, expect, it } from 'vitest';
import {
  buildSessionReplay,
  estimateCost,
  eventLabel,
  parseTranscript,
  sumUsage,
  totalTokens,
  type NormalizedEvent,
  type ParsedTranscript,
} from '../../src/core/index.js';
import { TranscriptBuilder } from '../fixtures/builder.js';

const parse = (b: TranscriptBuilder) => parseTranscript(b.build());

const REPLAY_MEANINGFUL = new Set<NormalizedEvent['kind']>([
  'human_prompt',
  'assistant_message',
  'tool_result',
  'turn_duration',
  'system',
]);

/**
 * The previous O(events × frames) reconstruction, re-derived independently from
 * the public cost/token helpers. Used to pin that the optimized single-pass
 * implementation produces byte-identical per-frame cost + token totals.
 */
function referenceFrameTotals(parsed: ParsedTranscript): { costUsd: number[]; totalTokens: number[] } {
  const events = parsed.events;
  const idx: number[] = [];
  for (let i = 0; i < events.length; i++) if (REPLAY_MEANINGFUL.has(events[i].kind)) idx.push(i);
  const costUsd: number[] = [];
  const totals: number[] = [];
  for (const i of idx) {
    const frameTs = events[i].ts;
    const all = [...events.slice(0, i + 1), ...parsed.sidechainEvents.filter((s) => s.ts <= frameTs)];
    costUsd.push(estimateCost(all).usd);
    totals.push(totalTokens(sumUsage(all)));
  }
  return { costUsd, totalTokens: totals };
}

describe('buildSessionReplay', () => {
  it('emits one frame per meaningful event with evolving status', () => {
    const b = new TranscriptBuilder({ slug: 'replay-me', cwd: '/Users/dev/projects/api-server' });
    b.prompt('run tests')
      .assistant({ tools: [{ name: 'Bash', id: 'toolu_1' }], usage: { input: 1000, output: 200 } })
      .toolResult({ toolUseId: 'toolu_1' })
      .assistant({ text: 'all green', stopReason: 'end_turn', usage: { input: 300, output: 150 } });

    const replay = buildSessionReplay(parse(b));
    expect(replay.frames).toHaveLength(4);
    expect(replay.frames.map((f) => f.event)).toEqual(['prompt', 'tool: Bash', 'tool result', 'completed turn']);
    expect(replay.frames.map((f) => f.status)).toEqual(['working', 'working', 'working', 'waiting']);
    expect(replay.frames[1].currentTool).toBe('Bash');
    // cumulative cost is non-decreasing and ends > 0
    const costs = replay.frames.map((f) => f.costUsd);
    expect(costs[0]).toBeLessThanOrEqual(costs[3]);
    expect(costs[3]).toBeGreaterThan(0);
    expect(replay.project).toBe('api-server');
    expect(replay.slug).toBe('replay-me');
    expect(replay.finalStatus).toBe('waiting');
    expect(replay.timeline.length).toBeGreaterThan(0);
  });

  it('captures an error path in the final state and a frame', () => {
    const b = new TranscriptBuilder();
    b.prompt('build')
      .assistant({ tools: [{ name: 'Bash', id: 'toolu_1' }] })
      .toolResult({ toolUseId: 'toolu_1', isError: true })
      .assistant({ text: 'it broke', stopReason: 'end_turn' });
    const replay = buildSessionReplay(parse(b));
    expect(replay.finalStatus).toBe('error');
    expect(replay.frames.some((f) => f.status === 'error')).toBe(true);
    expect(replay.frames.some((f) => f.event === 'tool error')).toBe(true);
  });

  it('reports duration as last − first frame timestamp', () => {
    const b = new TranscriptBuilder({ startTs: Date.parse('2026-06-16T10:00:00Z'), stepMs: 1000 });
    b.prompt('go').assistant({ text: 'ok', stopReason: 'end_turn' }); // 2 events, 1s apart
    const replay = buildSessionReplay(parse(b));
    expect(replay.durationMs).toBe(1000);
  });

  it('caps frames via maxFrames while keeping the final event', () => {
    const b = new TranscriptBuilder();
    for (let i = 0; i < 12; i++) {
      b.prompt(`q${i}`).assistant({ text: `a${i}`, stopReason: 'end_turn' });
    }
    const full = buildSessionReplay(parse(b));
    expect(full.frames.length).toBe(24);
    const capped = buildSessionReplay(parse(b), { maxFrames: 5 });
    expect(capped.frames.length).toBeLessThanOrEqual(5);
    // last frame is still the final meaningful event
    expect(capped.frames[capped.frames.length - 1].seq).toBe(full.frames[full.frames.length - 1].seq);
  });

  it('does not crash for degenerate maxFrames (<= 1) — keeps the final frame', () => {
    // Regression: maxFrames=1 used to divide by zero → NaN index → throw.
    const b = new TranscriptBuilder();
    for (let i = 0; i < 6; i++) b.prompt(`q${i}`).assistant({ text: `a${i}`, stopReason: 'end_turn' });
    const parsed = parse(b);
    const one = buildSessionReplay(parsed, { maxFrames: 1 });
    expect(one.frames).toHaveLength(1);
    const full = buildSessionReplay(parsed);
    expect(one.frames[0].seq).toBe(full.frames[full.frames.length - 1].seq);
    expect(() => buildSessionReplay(parsed, { maxFrames: 0 })).not.toThrow();
    expect(buildSessionReplay(parsed, { maxFrames: 0 }).frames).toHaveLength(0);
  });

  it('handles an empty transcript', () => {
    const replay = buildSessionReplay(parseTranscript(''));
    expect(replay.frames).toHaveLength(0);
    expect(replay.finalStatus).toBe('idle');
    expect(replay.durationMs).toBe(0);
    expect(replay.totalCostUsd).toBe(0);
  });

  it('labels every event kind', () => {
    const base = { seq: 0, ts: 1, isSidechain: false } as const;
    const cases: Array<[NormalizedEvent, string]> = [
      [{ ...base, kind: 'human_prompt', text: 'x' }, 'prompt'],
      [{ ...base, kind: 'assistant_message', model: 'm', toolUses: [{ name: 'Bash' }, { name: 'Read' }], textLength: 0, hasThinking: false }, 'tool: Bash+Read'],
      [{ ...base, kind: 'assistant_message', model: 'm', stopReason: 'end_turn', toolUses: [], textLength: 0, hasThinking: false }, 'completed turn'],
      [{ ...base, kind: 'assistant_message', model: 'm', stopReason: 'tool_use', toolUses: [], textLength: 0, hasThinking: false }, 'message'],
      [{ ...base, kind: 'tool_result', isError: false }, 'tool result'],
      [{ ...base, kind: 'tool_result', isError: true }, 'tool error'],
      [{ ...base, kind: 'turn_duration', durationMs: 1000 }, 'turn duration'],
      [{ ...base, kind: 'system', subtype: 'note', isError: false }, 'note'],
      [{ ...base, kind: 'system', subtype: 'boom', isError: true }, 'error: boom'],
      [{ ...base, kind: 'system', isError: true }, 'error: system'],
      [{ ...base, kind: 'meta', recordType: 'attachment' }, 'attachment'],
    ];
    for (const [ev, label] of cases) expect(eventLabel(ev)).toBe(label);
  });

  it('per-frame cost + tokens match the reference O(n²) derivation (with messy subagents)', () => {
    // Pins the single-pass reconstruction to the old algorithm byte-for-byte,
    // including subagent activity whose timestamps are NOT in array order.
    const main = new TranscriptBuilder({ sessionId: 's1', cwd: '/Users/dev/projects/api-server' });
    for (let i = 0; i < 40; i++) {
      main
        .prompt(`q${i}`)
        .assistant({ tools: [{ name: 'Bash', id: `t${i}` }], usage: { input: 111 + i, output: 37, cacheRead: 13, cacheWrite5m: 5 } })
        .toolResult({ toolUseId: `t${i}`, isError: i % 7 === 0 })
        .assistant({ text: `d${i}`, stopReason: 'end_turn', usage: { input: 29, output: 17 } });
    }
    let side = '';
    for (let k = 0; k < 25; k++) {
      // Interleaved, out-of-array-order timestamps to stress the fold ordering.
      const sb = new TranscriptBuilder({ sessionId: 's1', isSidechain: true, agentId: `a${k % 3}`, startTs: main.clock - 80_000 + ((k * 7919) % 50_000) });
      sb.assistant({ text: `s${k}`, stopReason: 'end_turn', usage: { input: 300 + k, output: 200 + k, cacheRead: 9 } });
      side += sb.build();
    }
    const parsed = parseTranscript(main.build() + side);
    const replay = buildSessionReplay(parsed);
    const ref = referenceFrameTotals(parsed);
    expect(replay.frames.map((f) => f.costUsd)).toEqual(ref.costUsd);
    expect(replay.frames.map((f) => f.totalTokens)).toEqual(ref.totalTokens);
  });

  it('reconstructs a large session far faster than the old per-frame derivation', () => {
    // Each prompt/tool/result/turn adds 4 events; 8k events → frames capped at
    // 1000. The old code re-derived state from event 0 for EVERY frame
    // (referenceFrameTotals below mirrors that O(events × frames) work).
    // Comparing both on the same run normalizes out machine speed and coverage
    // overhead, so the guard is robust to noisy/instrumented CI yet fails iff
    // the per-frame re-derivation creeps back in. The real correctness pin is
    // the byte-identical test above.
    const b = new TranscriptBuilder({ sessionId: 'big' });
    for (let i = 0; i < 2000; i++) {
      b.prompt(`q${i}`)
        .assistant({ tools: [{ name: 'Bash', id: `t${i}` }], usage: { input: 50, output: 20, cacheRead: 5 } })
        .toolResult({ toolUseId: `t${i}` })
        .assistant({ text: `done ${i}`, stopReason: 'end_turn', usage: { input: 10, output: 8 } });
    }
    const parsed = parseTranscript(b.build());
    expect(parsed.events.length).toBeGreaterThan(7_000);

    const tOldStart = performance.now();
    referenceFrameTotals(parsed); // the old O(events × frames) shape
    const oldMs = performance.now() - tOldStart;

    const tNewStart = performance.now();
    const replay = buildSessionReplay(parsed);
    const newMs = performance.now() - tNewStart;

    expect(replay.frames.length).toBeLessThanOrEqual(1000);
    expect(replay.frames.length).toBeGreaterThan(0);
    // Single-pass is ~30× faster in practice; require a conservative 5× so the
    // assertion is robust to noisy/instrumented CI yet still catches a return to
    // re-deriving per frame.
    expect(newMs * 5).toBeLessThan(oldMs);
  });

  it('accounts subagent cost up to each frame', () => {
    const main = new TranscriptBuilder({ sessionId: 's1' });
    main.prompt('go').assistant({ text: 'spawning', stopReason: 'end_turn', usage: { input: 100, output: 50 } });
    const side = new TranscriptBuilder({ sessionId: 's1', isSidechain: true, agentId: 'a1', startTs: main.clock + 500 })
      .assistant({ text: 'sub', stopReason: 'end_turn', usage: { input: 200, output: 100 } });
    const replay = buildSessionReplay(parseTranscript(main.build() + side.build()));
    expect(replay.totalCostUsd).toBeGreaterThan(0);
  });
});
