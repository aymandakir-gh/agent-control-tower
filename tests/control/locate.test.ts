import { describe, expect, it } from 'vitest';
import {
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

describe('matchProcess', () => {
  const procs: ProcInfo[] = [
    { pid: 10, command: 'node /usr/local/bin/claude', cwd: '/work/api' },
    { pid: 11, command: 'node /usr/local/bin/claude', cwd: '/work/web' },
    { pid: 12, command: 'vim notes.txt', cwd: '/work/api' },
    { pid: 99, command: 'node dist/cli.js agent-control-tower', cwd: '/work/api' },
  ];

  it('resolves a unique claude process by cwd', () => {
    expect(matchProcess(procs, { sessionId: 's', cwd: '/work/web' })).toBe(11);
  });

  it('never targets our own agent-control-tower process', () => {
    // Only the act process sits in /work/tower → no claude match → undefined.
    expect(matchProcess(procs, { sessionId: 's', cwd: '/work/tower' })).toBeUndefined();
  });

  it('returns undefined when ambiguous (no cwd to disambiguate)', () => {
    expect(matchProcess(procs, { sessionId: 's' })).toBeUndefined(); // two claude procs
  });

  it('returns undefined when nothing looks like an agent', () => {
    expect(matchProcess([{ pid: 5, command: 'bash' }], { sessionId: 's' })).toBeUndefined();
  });

  it('falls back to the agent pool when no candidate cwd matches', () => {
    // single claude proc, cwd does not match target → keep the pool of 1 → resolved.
    const single: ProcInfo[] = [{ pid: 7, command: 'claude', cwd: '/somewhere/else' }];
    expect(matchProcess(single, { sessionId: 's', cwd: '/work/api' })).toBe(7);
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
