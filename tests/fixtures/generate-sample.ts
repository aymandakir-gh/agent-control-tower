/**
 * Generates a static, realistic sample fleet under tests/fixtures/sample/,
 * mimicking the ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl layout.
 *
 * The fleet intentionally exercises every agent state (working / waiting /
 * error / idle) plus a subagent. Run with: `pnpm tsx tests/fixtures/generate-sample.ts`.
 * Output is committed so `--sample` works from a clean install with zero agents.
 *
 * Timestamps are anchored so the four "live" sessions are recent and the idle
 * one is ~15 minutes stale; the sample loader picks `now` relative to the newest
 * event, so the demo renders correctly regardless of wall-clock time.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TranscriptBuilder } from './builder.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'sample');

const BASE = Date.parse('2026-06-16T12:00:00.000Z');
const MIN = 60_000;

/** Encode a cwd the way Claude Code names its project directories. */
function encodeCwd(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

function write(cwd: string, sessionId: string, jsonl: string): void {
  const dir = join(OUT, encodeCwd(cwd));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.jsonl`), jsonl);
}

rmSync(OUT, { recursive: true, force: true });

// 1) WORKING — running a Bash command (tool_use pending).
{
  const cwd = '/Users/dev/projects/api-server';
  const b = new TranscriptBuilder({
    sessionId: 'a1111111-working-bash',
    slug: 'swift-fox',
    cwd,
    gitBranch: 'feat/payments',
    model: 'claude-opus-4-8',
    startTs: BASE - 45_000,
    stepMs: 4_000,
  });
  b.prompt('Add idempotency keys to the payments endpoint and run the tests.')
    .assistant({ thinking: 'plan', text: 'Wiring it up, then running the suite.', usage: { input: 24_000, output: 900, cacheRead: 18_000, cacheWrite5m: 3_000 } })
    .assistant({ text: 'Running tests…', tools: [{ name: 'Bash', input: { command: 'pnpm test' } }], usage: { input: 26_500, output: 320, cacheRead: 22_000 } });
  write(cwd, 'a1111111-working-bash', b.build());
}

// 2) WAITING — blocked on an AskUserQuestion.
{
  const cwd = '/Users/dev/projects/web-app';
  const b = new TranscriptBuilder({
    sessionId: 'b2222222-waiting-ask',
    slug: 'calm-river',
    cwd,
    gitBranch: 'main',
    model: 'claude-sonnet-4-6',
    startTs: BASE - 30_000,
    stepMs: 5_000,
  });
  b.prompt('Refactor the auth flow.')
    .assistant({ text: 'A couple of approaches — which do you prefer?', tools: [{ name: 'AskUserQuestion', input: { question: 'Session vs JWT?' } }], usage: { input: 12_000, output: 260, cacheRead: 8_000 } });
  write(cwd, 'b2222222-waiting-ask', b.build());
}

// 3) ERROR — last turn ended on a failed tool.
{
  const cwd = '/Users/dev/projects/data-pipeline';
  const b = new TranscriptBuilder({
    sessionId: 'c3333333-error-build',
    slug: 'bold-eagle',
    cwd,
    gitBranch: 'fix/etl',
    model: 'claude-opus-4-8',
    startTs: BASE - 50_000,
    stepMs: 6_000,
  });
  b.prompt('Build the ETL job.')
    .assistant({ text: 'Building.', tools: [{ name: 'Bash', input: { command: 'make build' } }], usage: { input: 15_000, output: 200, cacheRead: 9_000 } })
    .toolResult({ isError: true, content: 'make: *** [build] Error 2' })
    .assistant({ text: 'The build failed with exit code 2; the linker is missing a symbol.', stopReason: 'end_turn', usage: { input: 16_000, output: 480, cacheRead: 12_000 } });
  write(cwd, 'c3333333-error-build', b.build());
}

// 4) IDLE — completed long ago (stale).
{
  const cwd = '/Users/dev/projects/marketing-site';
  const b = new TranscriptBuilder({
    sessionId: 'd4444444-idle-done',
    slug: 'quiet-moon',
    cwd,
    gitBranch: 'main',
    model: 'claude-haiku-4-5',
    startTs: BASE - 16 * MIN,
    stepMs: 8_000,
  });
  b.prompt('Fix the typo in the footer.')
    .assistant({ text: 'Fixed the typo and verified the build.', stopReason: 'end_turn', usage: { input: 5_000, output: 150, cacheRead: 2_000 } })
    .turnDuration(42_000, 4);
  write(cwd, 'd4444444-idle-done', b.build());
}

// 5) WORKING with a subagent (Task/Agent in flight).
{
  const cwd = '/Users/dev/projects/infra';
  const sessionId = 'e5555555-working-agent';
  const main = new TranscriptBuilder({
    sessionId,
    slug: 'eager-otter',
    cwd,
    gitBranch: 'chore/upgrade',
    model: 'claude-opus-4-8',
    startTs: BASE - 38_000,
    stepMs: 5_000,
  });
  main
    .prompt('Audit the repo for deprecated APIs across all services.')
    .assistant({ text: 'Spawning a search subagent to sweep the codebase.', tools: [{ name: 'Agent', input: { description: 'find deprecated APIs' } }], usage: { input: 20_000, output: 350, cacheRead: 14_000, cacheWrite5m: 2_000 } });
  const side = new TranscriptBuilder({
    sessionId,
    slug: 'eager-otter',
    cwd,
    isSidechain: true,
    agentId: 'sub-agent-7',
    model: 'claude-sonnet-4-6',
    startTs: BASE - 30_000,
    stepMs: 4_000,
  });
  side
    .assistant({ text: 'Searching for deprecated calls.', tools: [{ name: 'Grep', input: { pattern: '@deprecated' } }], usage: { input: 9_000, output: 180, cacheRead: 4_000 } })
    .toolResult({ content: '42 matches across 11 files' })
    .assistant({ text: 'Reading the worst offenders.', tools: [{ name: 'Read', input: { file: 'svc/old.ts' } }], usage: { input: 11_000, output: 220, cacheRead: 6_000 } });
  write(cwd, sessionId, main.build() + side.build());
}

console.log(`Sample fleet written to ${OUT}`);
