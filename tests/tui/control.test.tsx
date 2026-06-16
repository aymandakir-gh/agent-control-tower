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
