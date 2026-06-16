import { describe, expect, it } from 'vitest';
import { renderScanText } from '../../src/cli/scan.js';
import { resolveAlertRules } from '../../src/core/index.js';
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

  it('surfaces alerts (error + waiting) for the sample fleet', async () => {
    const view = await loadFleetView({ sample: true });
    const text = renderScanText(view, false);
    expect(text).toContain('Alerts:');
    expect(text).toContain('1 critical');
    expect(text).toContain('waiting for input');
  });

  it('reflects configured alert rules (cost ceiling) in the output', async () => {
    const view = await loadFleetView({ sample: true, alertRules: resolveAlertRules({ costUsd: 0.01 }) });
    const text = renderScanText(view, false);
    expect(text).toMatch(/cost ≥ \$0\.01/);
  });

  it('shows the source tag for a non-default adapter', async () => {
    const view = await loadFleetView('/no/such/root', { source: 'generic-jsonl' });
    expect(renderScanText(view, false)).toContain('[Generic JSONL / hook]');
  });
});
