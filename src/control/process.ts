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
import { looksLikeAgent } from './locate.js';
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
  /**
   * Re-confirm `pid` still belongs to an agent process *right now* (closes the
   * locate→signal TOCTOU window / pid recycling). Optional; when present it is
   * checked before pause/resume.
   */
  verifyAgent?(pid: number): Promise<boolean>;
}

/** Real re-validation: read the live command for `pid` and re-apply the classifier. */
export async function isAgentPid(pid: number): Promise<boolean> {
  try {
    const { stdout } = await exec('ps', ['-o', 'command=', '-p', String(pid)]);
    return looksLikeAgent(stdout.trim());
  } catch {
    return false; // process gone / ps failed → not safe to signal
  }
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
  verifyAgent: isAgentPid,
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
      if (action === 'pause' || action === 'resume') {
        // Defense-in-depth: re-confirm the pid is still an agent before signaling
        // (the locator read it earlier; a pid can be recycled in between).
        if (this.ops.verifyAgent && !(await this.ops.verifyAgent(pid))) {
          return {
            ok: false,
            action,
            sessionId: target.sessionId,
            reason: `pid ${pid} no longer matches an agent process — not signaling`,
            pid,
          };
        }
        const signal = action === 'pause' ? 'SIGSTOP' : 'SIGCONT';
        this.ops.kill(pid, signal);
        const verb = action === 'pause' ? 'paused (SIGSTOP)' : 'resumed (SIGCONT)';
        return { ok: true, action, sessionId: target.sessionId, reason: `${verb} pid ${pid}`, pid };
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
