import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSessionReplay, parseTranscript } from '../../src/core/index.js';
import { renderReplayText, resolveTranscript } from '../../src/cli/replay.js';
import { parseArgs } from '../../src/cli/args.js';
import { TranscriptBuilder } from '../fixtures/builder.js';

describe('renderReplayText', () => {
  it('renders a header, transitions, and a timeline tail', () => {
    const b = new TranscriptBuilder({ slug: 'demo-run', cwd: '/Users/dev/projects/web-app' });
    b.prompt('go')
      .assistant({ tools: [{ name: 'Bash', id: 'toolu_1' }] })
      .toolResult({ toolUseId: 'toolu_1' })
      .assistant({ text: 'done', stopReason: 'end_turn' });
    const replay = buildSessionReplay(parseTranscript(b.build()));
    const text = renderReplayText(replay, false);
    expect(text).toContain('demo-run');
    expect(text).toContain('web-app');
    expect(text).toContain('State transitions');
    expect(text).toContain('working');
    expect(text).toContain('Timeline');
  });
});

describe('resolveTranscript', () => {
  it('finds a session by id in --sample mode', async () => {
    const opts = parseArgs(['replay', 'a1111111-working-bash', '--sample']);
    const parsed = await resolveTranscript(opts);
    expect(parsed).not.toBeNull();
    expect(parsed!.sessionId).toBe('a1111111-working-bash');
  });

  it('returns null for an unknown session', async () => {
    const opts = parseArgs(['replay', 'does-not-exist', '--sample']);
    expect(await resolveTranscript(opts)).toBeNull();
  });

  describe('from an explicit file path', () => {
    let dir: string;
    let file: string;
    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), 'act-replay-'));
      file = join(dir, 'sess.jsonl');
      const b = new TranscriptBuilder({ sessionId: 'file-sess' }).prompt('hi').assistant({ text: 'ok', stopReason: 'end_turn' });
      await writeFile(file, b.build());
    });
    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('reads and parses a direct .jsonl path', async () => {
      const opts = parseArgs(['replay', file]);
      const parsed = await resolveTranscript(opts);
      expect(parsed).not.toBeNull();
      expect(parsed!.sessionId).toBe('file-sess');
    });
  });
});
