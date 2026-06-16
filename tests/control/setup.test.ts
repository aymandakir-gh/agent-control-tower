import { describe, expect, it } from 'vitest';
import {
  createControlSetup,
  executeControl,
  FakeController,
  NullProcessLocator,
  ProcessController,
  PsProcessLocator,
  targetFromAgent,
  type ControlSetup,
  type ProcessLocator,
} from '../../src/control/index.js';

describe('createControlSetup', () => {
  it('is inert when disabled (fake controller + null locator)', () => {
    const s = createControlSetup(false);
    expect(s.enabled).toBe(false);
    expect(s.controller).toBeInstanceOf(FakeController);
    expect(s.locator).toBeInstanceOf(NullProcessLocator);
  });

  it('wires the real controller + locator when enabled', () => {
    const s = createControlSetup(true);
    expect(s.enabled).toBe(true);
    expect(s.controller).toBeInstanceOf(ProcessController);
    expect(s.locator).toBeInstanceOf(PsProcessLocator);
  });
});

describe('targetFromAgent', () => {
  it('carries sessionId, cwd, and a friendly label', () => {
    const t = targetFromAgent({ sessionId: 'sess', cwd: '/work/api', project: 'api', slug: 'fox' });
    expect(t).toMatchObject({ sessionId: 'sess', cwd: '/work/api', label: 'api' });
  });

  it('falls back to slug then sessionId for the label', () => {
    expect(targetFromAgent({ sessionId: 'sess', slug: 'fox' }).label).toBe('fox');
    expect(targetFromAgent({ sessionId: 'sess' }).label).toBe('sess');
  });
});

describe('executeControl — locator + controller together', () => {
  const pidLocator = (pid: number): ProcessLocator => ({ locate: async () => pid });

  it('acts when the locator resolves a unique pid', async () => {
    const controller = new FakeController({ allow: true, protectedPids: [1] });
    const setup: ControlSetup = { controller, locator: pidLocator(4242), enabled: true };
    const r = await executeControl(setup, { sessionId: 's', cwd: '/work/x' }, 'pause');
    expect(r.ok).toBe(true);
    expect(r.pid).toBe(4242);
    expect(controller.calls[0].target.pid).toBe(4242);
  });

  it('refuses when the locator resolves nothing', async () => {
    const controller = new FakeController({ allow: true, protectedPids: [1] });
    const setup: ControlSetup = { controller, locator: new NullProcessLocator(), enabled: true };
    const r = await executeControl(setup, { sessionId: 's' }, 'pause');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('could not resolve');
  });
});
