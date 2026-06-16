import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../../src/core/timeline.js';
import { parseTranscript } from '../../src/core/parser.js';
import { TranscriptBuilder } from '../fixtures/builder.js';

describe('buildTimeline', () => {
  it('merges events from multiple transcripts, sorted by time', () => {
    const a = new TranscriptBuilder({ sessionId: 'a', slug: 'agent-a', startTs: Date.parse('2026-06-16T10:00:00Z') });
    a.prompt('do A').assistant({ tools: [{ name: 'Bash', id: 'toolu_1' }] });
    const b = new TranscriptBuilder({ sessionId: 'b', slug: 'agent-b', startTs: Date.parse('2026-06-16T10:00:00.500Z') });
    b.prompt('do B').assistant({ tools: [{ name: 'Read', id: 'toolu_1' }] });

    const tl = buildTimeline([parseTranscript(a.build()), parseTranscript(b.build())]);
    // sorted ascending
    for (let i = 1; i < tl.length; i++) expect(tl[i].ts).toBeGreaterThanOrEqual(tl[i - 1].ts);
    expect(tl.some((e) => e.label === 'tool: Bash' && e.sessionId === 'a')).toBe(true);
    expect(tl.some((e) => e.label === 'tool: Read' && e.sessionId === 'b')).toBe(true);
    expect(tl.some((e) => e.label === 'prompt')).toBe(true);
  });

  it('marks tool errors and respects the limit (keeps most recent)', () => {
    const b = new TranscriptBuilder();
    b.prompt('go')
      .assistant({ tools: [{ name: 'Bash', id: 'toolu_1' }] })
      .toolResult({ toolUseId: 'toolu_1', isError: true })
      .assistant({ text: 'oops', stopReason: 'end_turn' });
    const tl = buildTimeline([parseTranscript(b.build())], { limit: 2 });
    expect(tl).toHaveLength(2);
    expect(tl.some((e) => e.isError && e.label === 'tool error')).toBe(true);
  });

  it('includes subagent activity by default and can exclude it', () => {
    const main = new TranscriptBuilder({ sessionId: 's1' });
    main.prompt('go').assistant({ tools: [{ name: 'Agent', id: 'toolu_1' }] });
    const side = new TranscriptBuilder({ sessionId: 's1', isSidechain: true, agentId: 'agent-1' });
    side.assistant({ tools: [{ name: 'Grep', id: 'toolu_1' }] });
    const parsed = parseTranscript(main.build() + side.build());

    expect(buildTimeline([parsed]).some((e) => e.label === 'tool: Grep')).toBe(true);
    expect(buildTimeline([parsed], { includeSidechains: false }).some((e) => e.label === 'tool: Grep')).toBe(false);
  });

  it('skips non-error system events and labels non-terminal assistant messages', () => {
    const b = new TranscriptBuilder();
    b.prompt('go').system('informational').assistant({ text: 'thinking aloud', stopReason: 'tool_use' });
    const tl = buildTimeline([parseTranscript(b.build())]);
    expect(tl.some((e) => e.label === 'message')).toBe(true);
    expect(tl.some((e) => e.kind === 'system')).toBe(false);
  });

  it('emits a "completed turn" entry for clean end_turn messages', () => {
    const b = new TranscriptBuilder();
    b.prompt('go').assistant({ text: 'all done', stopReason: 'end_turn' });
    const tl = buildTimeline([parseTranscript(b.build())]);
    expect(tl.some((e) => e.label === 'completed turn')).toBe(true);
  });
});
