import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/tui/App.js';
import { loadFleetView, type FleetView } from '../../src/sources/transcripts.js';
import { FakeController, NullProcessLocator, type ControlSetup, type ProcessLocator } from '../../src/control/index.js';

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const pidLocator = (pid: number): ProcessLocator => ({ locate: async () => pid });

describe('<App/> management actions', () => {
  it('acts on pause when control is enabled (injected fake)', async () => {
    const view = await loadFleetView({ sample: true });
    const controller = new FakeController({ allow: true, protectedPids: [1] });
    const control: ControlSetup = { controller, locator: pidLocator(4242), enabled: true };
    const { lastFrame, stdin, unmount } = render(
      <App options={{ sample: true }} loader={async (): Promise<FleetView> => view} control={control} noWatch tickMs={10_000} />,
    );
    await tick();
    expect(lastFrame() ?? '').toContain('[control ON]');
    stdin.write('z'); // pause
    await tick();
    expect(controller.calls).toHaveLength(1);
    expect(controller.calls[0].action).toBe('pause');
    expect(lastFrame() ?? '').toContain('✓ pause');
    unmount();
  });

  it('acts on the highlighted agent after the fleet shrinks (clamped target)', async () => {
    // Regression: selectedIndex used to drive the control target unclamped, so
    // after a refresh loaded a SMALLER fleet the keypress hit an out-of-range
    // (undefined) agent and was silently dropped, while the Board highlighted a
    // different, in-range row. The target must follow the highlighted row.
    const full = await loadFleetView({ sample: true });
    expect(full.fleet.agents.length).toBeGreaterThan(2);
    // After a refresh, the loader returns a fleet of just the first agent.
    const small: FleetView = { ...full, fleet: { ...full.fleet, agents: [full.fleet.agents[0]] } };
    let loads = 0;
    const loader = async (): Promise<FleetView> => (loads++ === 0 ? full : small);
    const controller = new FakeController({ allow: true, protectedPids: [1] });
    const control: ControlSetup = { controller, locator: pidLocator(4242), enabled: true };
    const { stdin, unmount } = render(
      <App options={{ sample: true }} loader={loader} control={control} noWatch tickMs={10_000} />,
    );
    await tick();
    stdin.write('[B'); // down → index 1
    await tick();
    stdin.write('[B'); // down → index 2 (past the end of the soon-to-be 1-agent fleet)
    await tick();
    stdin.write('r'); // refresh → loader now returns the 1-agent fleet
    await tick();
    stdin.write('f'); // focus the highlighted agent
    await tick();
    expect(controller.calls).toHaveLength(1);
    expect(controller.calls[0].action).toBe('focus');
    // The highlighted row is agent 0 of the shrunken fleet — the target must match it.
    expect(controller.calls[0].target.sessionId).toBe(small.fleet.agents[0].sessionId);
    unmount();
  });

  it('refuses with a clear message when control is disabled', async () => {
    const view = await loadFleetView({ sample: true });
    const controller = new FakeController({ allow: false });
    const control: ControlSetup = { controller, locator: new NullProcessLocator(), enabled: false };
    const { lastFrame, stdin, unmount } = render(
      <App options={{ sample: true }} loader={async (): Promise<FleetView> => view} control={control} noWatch tickMs={10_000} />,
    );
    await tick();
    expect(lastFrame() ?? '').toContain('control off');
    stdin.write('f'); // focus
    await tick();
    expect(controller.calls[0].action).toBe('focus');
    const frame = lastFrame() ?? '';
    expect(frame).toContain('✗ focus');
    expect(frame).toContain('disabled');
    unmount();
  });
});
