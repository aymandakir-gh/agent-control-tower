import { describe, expect, it } from 'vitest';
import { assessControl, defaultProtectedPids } from '../../src/control/index.js';
import type { ControlPolicy } from '../../src/control/index.js';

const ALLOW: ControlPolicy = { allow: true, protectedPids: [1] };

describe('assessControl — refuses when unsafe', () => {
  it('refuses when control is disabled', () => {
    const a = assessControl({ sessionId: 's', pid: 4242 }, 'pause', { allow: false });
    expect(a.allowed).toBe(false);
    expect(a.reason).toContain('disabled');
  });

  it('refuses an unknown action', () => {
    const a = assessControl({ sessionId: 's', pid: 4242 }, 'kill' as never, ALLOW);
    expect(a.allowed).toBe(false);
    expect(a.reason).toContain('unknown action');
  });

  it('refuses when no pid was resolved', () => {
    expect(assessControl({ sessionId: 's' }, 'pause', ALLOW).allowed).toBe(false);
    expect(assessControl({ sessionId: 's', pid: 0 }, 'pause', ALLOW).allowed).toBe(false);
    expect(assessControl({ sessionId: 's', pid: -3 }, 'pause', ALLOW).allowed).toBe(false);
    expect(assessControl({ sessionId: 's', pid: 1.5 }, 'pause', ALLOW).allowed).toBe(false);
    expect(assessControl({ sessionId: 's' }, 'pause', ALLOW).reason).toContain('could not resolve');
  });

  it('refuses a protected pid (self/parent/init)', () => {
    const a = assessControl({ sessionId: 's', pid: 1 }, 'pause', ALLOW);
    expect(a.allowed).toBe(false);
    expect(a.reason).toContain('protected');
  });
});

describe('assessControl — acts when allowed', () => {
  it('allows each known action on a valid, unprotected pid', () => {
    for (const action of ['focus', 'pause', 'resume'] as const) {
      const a = assessControl({ sessionId: 's', pid: 4242 }, action, ALLOW);
      expect(a.allowed).toBe(true);
      expect(a.reason).toContain(`${action} pid 4242`);
    }
  });
});

describe('defaultProtectedPids', () => {
  it('always protects init and this process + parent', () => {
    const pids = defaultProtectedPids();
    expect(pids).toContain(1);
    expect(pids).toContain(process.pid);
    expect(pids).toContain(process.ppid);
  });
});
