/**
 * Control layer barrel + high-level wiring (PRD §15).
 *
 * Disabled by default: `createController(false)` returns a Fake that refuses
 * every action with a clear reason. `createController(true)` returns the real
 * SIGSTOP/SIGCONT/focus controller, still gated by the pure policy. The
 * frontends depend only on the `Controller`/`ProcessLocator` interfaces.
 */

import type { AgentSnapshot } from '../core/index.js';
import { defaultProtectedPids } from './assess.js';
import { FakeController } from './fake.js';
import { NullProcessLocator, PsProcessLocator } from './locate.js';
import { ProcessController } from './process.js';
import type { Controller, ControlAction, ControlPolicy, ControlResult, ControlTarget, ProcessLocator } from './types.js';

export * from './types.js';
export * from './assess.js';
export * from './fake.js';
export * from './process.js';
export * from './locate.js';

export interface ControlSetup {
  controller: Controller;
  locator: ProcessLocator;
  enabled: boolean;
}

/**
 * Build the controller + locator pair for a session.
 * - `allow=false` (default): a FakeController that refuses everything, and a
 *   locator that resolves nothing — completely inert.
 * - `allow=true`: the real ProcessController + PsProcessLocator, with self/
 *   parent/init protected.
 */
export function createControlSetup(allow: boolean): ControlSetup {
  const policy: ControlPolicy = { allow, protectedPids: defaultProtectedPids() };
  if (!allow) {
    return { controller: new FakeController(policy), locator: new NullProcessLocator(), enabled: false };
  }
  return { controller: new ProcessController(policy), locator: new PsProcessLocator(), enabled: true };
}

/** Build a control target from an agent snapshot. */
export function targetFromAgent(agent: Pick<AgentSnapshot, 'sessionId' | 'cwd' | 'project' | 'slug'>): ControlTarget {
  return {
    sessionId: agent.sessionId,
    ...(agent.cwd !== undefined ? { cwd: agent.cwd } : {}),
    label: agent.project ?? agent.slug ?? agent.sessionId,
  };
}

/**
 * Resolve a target's pid via the locator, then run the action through the
 * controller (which re-checks the policy). One call the frontends can await.
 */
export async function executeControl(
  setup: ControlSetup,
  target: ControlTarget,
  action: ControlAction,
): Promise<ControlResult> {
  const pid = await setup.locator.locate(target);
  const resolved: ControlTarget = pid !== undefined ? { ...target, pid } : target;
  return setup.controller.run(resolved, action);
}
