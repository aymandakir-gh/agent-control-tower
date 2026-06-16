/**
 * In-memory controller for tests and the default (disabled) wiring. Records
 * every call and honors the same pure policy as the real controller, so the
 * "acts when allowed / refuses when unsafe" contract is identical — it just
 * never touches a real process.
 */

import { assessControl } from './assess.js';
import type { Controller, ControlAction, ControlPolicy, ControlResult, ControlTarget } from './types.js';

export interface FakeCall {
  target: ControlTarget;
  action: ControlAction;
  result: ControlResult;
}

export class FakeController implements Controller {
  readonly calls: FakeCall[] = [];

  constructor(private readonly policy: ControlPolicy) {}

  async run(target: ControlTarget, action: ControlAction): Promise<ControlResult> {
    const { allowed, reason } = assessControl(target, action, this.policy);
    const result: ControlResult = allowed
      ? {
          ok: true,
          action,
          sessionId: target.sessionId,
          reason: `(fake) would ${reason}`,
          ...(target.pid !== undefined ? { pid: target.pid } : {}),
        }
      : { ok: false, action, sessionId: target.sessionId, reason };
    this.calls.push({ target, action, result });
    return result;
  }
}
