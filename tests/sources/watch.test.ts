import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signature, watchRoot } from '../../src/sources/watch.js';
import { findSessionFiles } from '../../src/sources/transcripts.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'act-watch-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('signature', () => {
  it('is stable for the same files and changes when content grows', async () => {
    await writeFile(join(dir, 'a.jsonl'), 'x\n');
    const s1 = signature(await findSessionFiles(dir));
    const s2 = signature(await findSessionFiles(dir));
    expect(s1).toBe(s2);
    await writeFile(join(dir, 'a.jsonl'), 'x\ny\n');
    const s3 = signature(await findSessionFiles(dir));
    expect(s3).not.toBe(s1);
  });
});

describe('watchRoot', () => {
  it('detects new and changed files via poll(), firing onChange', async () => {
    await writeFile(join(dir, 'a.jsonl'), 'one\n');
    let changes = 0;
    const w = watchRoot(dir, () => changes++, { intervalMs: 60_000 });
    try {
      // First explicit poll seeds the baseline (no change reported).
      expect(await w.poll()).toBe(false);
      // Add a file → change.
      await writeFile(join(dir, 'b.jsonl'), 'two\n');
      expect(await w.poll()).toBe(true);
      // No change → false.
      expect(await w.poll()).toBe(false);
      // Append to a file → change.
      await writeFile(join(dir, 'a.jsonl'), 'one\nmore\n');
      expect(await w.poll()).toBe(true);
      expect(changes).toBe(2);
    } finally {
      w.stop();
    }
  });
});
