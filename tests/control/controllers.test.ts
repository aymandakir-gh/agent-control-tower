import { describe, expect, it } from 'vitest';
import {
  FakeController,
  ProcessController,
  type ControlTarget,
  type ProcessOps,
} from '../../src/control/index.js';

const TARGET: ControlTarget = { sessionId: 's', cwd: '/work/x', pid: 4242 };

describe('FakeController', () => {
  it('acts when allowed and records the call', async () => {
    const c = new FakeController({ allow: true, protectedPids: [1] });
    const r = await c.run(TARGET, 'pause');
    expect(r.ok).toBe(true);
    expect(r.pid).toBe(4242);
    expect(r.reason).toContain('(fake)');
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0].action).toBe('pause');
  });

  it('refuses when disabled and still records the (refused) call', async () => {
    const c = new FakeController({ allow: false });
    const r = await c.run(TARGET, 'pause');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('disabled');
    expect(c.calls[0].result.ok).toBe(false);
  });

  it('refuses a protected pid', async () => {
    const c = new FakeController({ allow: true, protectedPids: [4242] });
    expect((await c.run(TARGET, 'resume')).ok).toBe(false);
  });
});

describe('ProcessController (injected OS ops)', () => {
  function spyOps(): { ops: ProcessOps; killed: Array<[number, string]>; focused: ControlTarget[] } {
    const killed: Array<[number, string]> = [];
    const focused: ControlTarget[] = [];
    const ops: ProcessOps = {
      kill: (pid, signal) => killed.push([pid, signal]),
      focus: async (t) => {
        focused.push(t);
        return { ok: true, reason: 'focused tmux pane' };
      },
    };
    return { ops, killed, focused };
  }

  it('pause sends SIGSTOP, resume sends SIGCONT', async () => {
    const { ops, killed } = spyOps();
    const c = new ProcessController({ allow: true, protectedPids: [1] }, ops);
    expect((await c.run(TARGET, 'pause')).ok).toBe(true);
    expect((await c.run(TARGET, 'resume')).ok).toBe(true);
    expect(killed).toEqual([[4242, 'SIGSTOP'], [4242, 'SIGCONT']]);
  });

  it('focus delegates to ops.focus', async () => {
    const { ops, focused } = spyOps();
    const c = new ProcessController({ allow: true, protectedPids: [1] }, ops);
    const r = await c.run(TARGET, 'focus');
    expect(r.ok).toBe(true);
    expect(r.reason).toContain('tmux');
    expect(focused).toHaveLength(1);
  });

  it('refuses (and never signals) when disabled or protected', async () => {
    const { ops, killed } = spyOps();
    const disabled = new ProcessController({ allow: false }, ops);
    expect((await disabled.run(TARGET, 'pause')).ok).toBe(false);

    const protect = new ProcessController({ allow: true, protectedPids: [4242] }, ops);
    expect((await protect.run(TARGET, 'pause')).ok).toBe(false);

    expect(killed).toHaveLength(0); // crucial: nothing was signaled
  });

  it('reports a clean failure when the signal throws (e.g. process gone)', async () => {
    const ops: ProcessOps = {
      kill: () => {
        throw new Error('ESRCH');
      },
      focus: async () => ({ ok: false, reason: 'n/a' }),
    };
    const c = new ProcessController({ allow: true, protectedPids: [1] }, ops);
    const r = await c.run(TARGET, 'pause');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('failed');
    expect(r.reason).toContain('ESRCH');
  });

  it('returns ops.focus failure verbatim', async () => {
    const ops: ProcessOps = {
      kill: () => undefined,
      focus: async () => ({ ok: false, reason: 'no tmux pane matches this session' }),
    };
    const c = new ProcessController({ allow: true, protectedPids: [1] }, ops);
    const r = await c.run(TARGET, 'focus');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('no tmux pane');
  });
});
