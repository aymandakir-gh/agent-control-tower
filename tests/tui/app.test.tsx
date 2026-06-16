import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/tui/App.js';
import { loadFleetView, type FleetView } from '../../src/sources/transcripts.js';

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe('<App/>', () => {
  it('loads via an injected loader and renders the board', async () => {
    const view = await loadFleetView({ sample: true });
    const loader = async (): Promise<FleetView> => view;
    const { lastFrame, unmount } = render(
      <App options={{ sample: true }} loader={loader} noWatch tickMs={10_000} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('agent-control-tower');
    expect(frame).toContain('api-server');
    unmount();
  });

  it('shows an error state when the loader rejects', async () => {
    const loader = async (): Promise<FleetView> => {
      throw new Error('boom');
    };
    const { lastFrame, unmount } = render(
      <App options={{ sample: true }} loader={loader} noWatch tickMs={10_000} />,
    );
    await tick();
    expect(lastFrame() ?? '').toContain('Error: boom');
    unmount();
  });

  it('responds to the sort keypress', async () => {
    const view = await loadFleetView({ sample: true });
    const loader = async (): Promise<FleetView> => view;
    const { lastFrame, stdin, unmount } = render(
      <App options={{ sample: true }} loader={loader} noWatch tickMs={10_000} />,
    );
    await tick();
    expect(lastFrame() ?? '').toContain('sort: status');
    stdin.write('s');
    await tick();
    expect(lastFrame() ?? '').toContain('sort: duration');
    unmount();
  });
});
