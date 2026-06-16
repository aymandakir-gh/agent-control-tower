import { describe, expect, it } from 'vitest';
import {
  looksLikeAgent,
  matchProcess,
  parsePs,
  NullProcessLocator,
  PsProcessLocator,
  type ProcInfo,
} from '../../src/control/index.js';

describe('parsePs', () => {
  it('parses `pid command` lines, ignoring blanks/garbage', () => {
    const out = parsePs('  123 node /usr/bin/claude code\n\nnotaline\n  456 claude\n');
    expect(out).toEqual([
      { pid: 123, command: 'node /usr/bin/claude code' },
      { pid: 456, command: 'claude' },
    ]);
  });
});

describe('looksLikeAgent', () => {
  it('accepts genuine claude CLI invocations', () => {
    expect(looksLikeAgent('node /usr/local/bin/claude')).toBe(true);
    expect(looksLikeAgent('claude --resume')).toBe(true);
  });

  it('rejects ourselves, the desktop app, and editors/viewers that merely mention claude', () => {
    expect(looksLikeAgent('node dist/cli.js agent-control-tower --source claude-code')).toBe(false);
    expect(looksLikeAgent('/Applications/Claude.app/Contents/MacOS/Claude --type=renderer')).toBe(false);
    expect(looksLikeAgent('vim claude-notes.md')).toBe(false);
    expect(looksLikeAgent('tail -f /var/log/claude.log')).toBe(false);
    expect(looksLikeAgent('ssh user@claude-server')).toBe(false);
    expect(looksLikeAgent('bash')).toBe(false);
  });
});

describe('matchProcess', () => {
  const procs: ProcInfo[] = [
    { pid: 10, command: 'node /usr/local/bin/claude', cwd: '/work/api' },
    { pid: 11, command: 'node /usr/local/bin/claude', cwd: '/work/web' },
    { pid: 12, command: 'vim notes.txt', cwd: '/work/api' },
  ];

  it('resolves a unique claude process by cwd', () => {
    expect(matchProcess(procs, { sessionId: 's', cwd: '/work/web' })).toBe(11);
  });

  it('refuses (undefined) when cwd is known but no agent matches it — NO unsafe fallback', () => {
    // Regression for the adversarial-review finding: a single claude process whose
    // cwd does NOT match must NOT be signaled just because it is the only candidate.
    const single: ProcInfo[] = [{ pid: 7, command: 'claude', cwd: '/somewhere/else' }];
    expect(matchProcess(single, { sessionId: 's', cwd: '/work/api' })).toBeUndefined();
  });

  it('never targets our own process even when it is the unique cwd match', () => {
    // self-process command contains "claude" (via --source claude-code) AND matches
    // the target cwd; only the agent-control-tower exclusion prevents selecting it.
    const self: ProcInfo[] = [{ pid: 99, command: 'node dist/cli.js agent-control-tower --source claude-code', cwd: '/work/tower' }];
    expect(matchProcess(self, { sessionId: 's', cwd: '/work/tower' })).toBeUndefined();
  });

  it('resolves a sole agent when no cwd is provided', () => {
    expect(matchProcess([{ pid: 7, command: 'claude', cwd: '/x' }], { sessionId: 's' })).toBe(7);
  });

  it('returns undefined when ambiguous (no cwd to disambiguate)', () => {
    expect(matchProcess(procs, { sessionId: 's' })).toBeUndefined(); // two claude procs
  });

  it('returns undefined when nothing looks like an agent', () => {
    expect(matchProcess([{ pid: 5, command: 'bash' }], { sessionId: 's' })).toBeUndefined();
  });
});

describe('NullProcessLocator', () => {
  it('resolves nothing', async () => {
    expect(await new NullProcessLocator().locate({ sessionId: 's' })).toBeUndefined();
  });
});

describe('PsProcessLocator (integration, tolerant)', () => {
  it('returns a number or undefined without throwing on the host', async () => {
    const pid = await new PsProcessLocator().locate({ sessionId: 's', cwd: '/no/such/cwd/for/agent' });
    expect(pid === undefined || typeof pid === 'number').toBe(true);
  });
});
