import { describe, expect, it } from 'vitest';
import { renderScanText } from '../../src/cli/scan.js';
import { loadFleetView } from '../../src/sources/transcripts.js';

describe('renderScanText', () => {
  it('renders the sample fleet as a readable table', async () => {
    const view = await loadFleetView({ sample: true });
    const text = renderScanText(view, false);
    expect(text).toContain('agent-control-tower');
    expect(text).toContain('2 working');
    expect(text).toContain('1 waiting');
    expect(text).toContain('1 error');
    expect(text).toContain('api-server');
    expect(text).toContain('AskUserQuestion');
    expect(text).toContain('Fleet total:');
    expect(text).toContain('Recent activity:');
  });

  it('shows a helpful empty state with no agents', async () => {
    const view = await loadFleetView('/no/such/root/here', {});
    const text = renderScanText(view, false);
    expect(text).toContain('0 agents');
    expect(text).toContain('No agents found');
  });
});
