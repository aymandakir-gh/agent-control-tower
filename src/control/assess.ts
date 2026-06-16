/**
 * Pure safety policy for management actions (PRD §15).
 *
 * `assessControl` is the single gate every controller consults. It refuses
 * unless: control is explicitly enabled, the action is known, the target
 * resolves to a single valid pid, and that pid is not protected (self, parent,
 * init). Pure — fully unit-testable in both directions.
 */

import { CONTROL_ACTIONS, type ControlAction, type ControlPolicy, type ControlTarget } from './types.js';

export interface Assessment {
  allowed: boolean;
  reason: string;
}

/** Decide whether `action` on `target` is permitted under `policy`. Pure. */
export function assessControl(target: ControlTarget, action: ControlAction, policy: ControlPolicy): Assessment {
  if (!policy.allow) {
    return { allowed: false, reason: 'control is disabled (enable with --allow-control)' };
  }
  if (!CONTROL_ACTIONS.includes(action)) {
    return { allowed: false, reason: `unknown action: ${String(action)}` };
  }
  const pid = target.pid;
  if (pid === undefined || !Number.isInteger(pid) || pid <= 0) {
    return { allowed: false, reason: 'could not resolve a unique process for this session' };
  }
  if ((policy.protectedPids ?? []).includes(pid)) {
    return { allowed: false, reason: `refusing to act on a protected process (pid ${pid})` };
  }
  return { allowed: true, reason: `${action} pid ${pid}` };
}

/**
 * PIDs that must never be signaled: this process, its parent, and init (1).
 * Impure (reads `process`); kept tiny and separate so `assessControl` stays pure.
 */
export function defaultProtectedPids(): number[] {
  const pids = new Set<number>([1]);
  if (typeof process.pid === 'number') pids.add(process.pid);
  if (typeof process.ppid === 'number') pids.add(process.ppid);
  return [...pids];
}
