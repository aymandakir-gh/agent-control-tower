import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { Board } from '../../src/tui/Board.js';
import { loadFleetView } from '../../src/sources/transcripts.js';

describe('<Board/>', () => {
  it('renders the sample fleet with statuses, tools and totals', async () => {
    const view = await loadFleetView({ sample: true });
    const { lastFrame } = render(
      <Board view={view} now={view.now} selectedIndex={0} sortKey="status" showDetail={false} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('agent-control-tower');
    expect(frame).toContain('api-server');
    expect(frame).toContain('working');
    expect(frame).toContain('AskUserQuestion');
    expect(frame).toContain('fleet total:');
    expect(frame).toContain('q quit');
  });

  it('shows the detail panel for the selected agent', async () => {
    const view = await loadFleetView({ sample: true });
    const { lastFrame } = render(
      <Board view={view} now={view.now} selectedIndex={0} sortKey="status" showDetail={true} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('state:');
    expect(frame).toContain('tokens —');
  });

  it('renders an empty state with no agents', async () => {
    const view = await loadFleetView('/no/such/root', {});
    const { lastFrame } = render(
      <Board view={view} now={Date.now()} selectedIndex={0} sortKey="status" showDetail={false} />,
    );
    expect(lastFrame() ?? '').toContain('No agents found');
  });

  it('renders an alerts panel for the sample fleet (error + waiting)', async () => {
    const view = await loadFleetView({ sample: true });
    const { lastFrame } = render(
      <Board view={view} now={view.now} selectedIndex={0} sortKey="status" showDetail={false} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('alerts');
    expect(frame).toContain('critical');
    expect(frame).toContain('waiting for input');
  });
});
