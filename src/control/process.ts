/**
 * Real process controller (PRD §15). Reversible actions only:
 *   pause  → SIGSTOP   ·   resume → SIGCONT   ·   focus → bring terminal forward
 *
 * Every action passes through the pure `assessControl` gate first. The OS
 * primitives are injectable (`ProcessOps`) so tests exercise the real decision +
 * dispatch logic without signaling actual processes.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assessControl } from './assess.js';
import type { Controller, ControlAction, ControlPolicy, ControlResult, ControlTarget } from './types.js';

const exec = promisify(execFile);

export interface FocusOutcome {
  ok: boolean;
  reason: string;
}

/** The OS-touching primitives, isolated for injection/testing. */
export interface ProcessOps {
  /** Send a signal to a pid. Throws on failure (e.g. ESRCH). */
  kill(pid: number, signal: NodeJS.Signals): void;
  /** Bring the agent's terminal forward (best-effort). */
  focus(target: ControlTarget): Promise<FocusOutcome>;
}

/**
 * Default focus: locate the tmux pane whose pane pid matches the target and
 * switch/select it. Refuses cleanly when there's no attachable tmux pane.
 */
export async function focusViaTmux(target: ControlTarget): Promise<FocusOutcome> {
  if (target.pid === undefined) return { ok: false, reason: 'no resolved pid to focus' };
  try {
    const { stdout } = await exec('tmux', [
      'list-panes',
      '-aF',
      '#{pane_pid} #{session_name}:#{window_index}.#{pane_index}',
    ]);
    for (const line of stdout.split('\n')) {
      const [panePid, paneId] = line.trim().split(/\s+/);
      if (paneId && Number(panePid) === target.pid) {
        await exec('tmux', ['select-window', '-t', paneId]);
        await exec('tmux', ['switch-client', '-t', paneId]).catch(() => undefined);
        return { ok: true, reason: `focused tmux pane ${paneId}` };
      }
    }
    return { ok: false, reason: 'no tmux pane matches this session' };
  } catch {
    return { ok: false, reason: 'no attachable terminal found (tmux unavailable)' };
  }
}

export const realProcessOps: ProcessOps = {
  kill: (pid, signal) => {
    process.kill(pid, signal);
  },
  focus: focusViaTmux,
};

export class ProcessController implements Controller {
  constructor(
    private readonly policy: ControlPolicy,
    private readonly ops: ProcessOps = realProcessOps,
  ) {}

  async run(target: ControlTarget, action: ControlAction): Promise<ControlResult> {
    const { allowed, reason } = assessControl(target, action, this.policy);
    if (!allowed) {
      return { ok: false, action, sessionId: target.sessionId, reason };
    }
    const pid = target.pid as number; // guaranteed valid by assessControl
    try {
      if (action === 'pause') {
        this.ops.kill(pid, 'SIGSTOP');
        return { ok: true, action, sessionId: target.sessionId, reason: `paused (SIGSTOP) pid ${pid}`, pid };
      }
      if (action === 'resume') {
        this.ops.kill(pid, 'SIGCONT');
        return { ok: true, action, sessionId: target.sessionId, reason: `resumed (SIGCONT) pid ${pid}`, pid };
      }
      // focus
      const outcome = await this.ops.focus(target);
      return { ok: outcome.ok, action, sessionId: target.sessionId, reason: outcome.reason, pid };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, action, sessionId: target.sessionId, reason: `failed: ${msg}`, pid };
    }
  }
}
