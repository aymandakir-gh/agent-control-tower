import { describe, expect, it } from 'vitest';
import { alertRulesFromArgs, DEFAULT_PORT, parseArgs } from '../../src/cli/args.js';

describe('parseArgs', () => {
  it('defaults to the tui command', () => {
    const o = parseArgs([]);
    expect(o.command).toBe('tui');
    expect(o.sample).toBe(false);
    expect(o.port).toBe(DEFAULT_PORT);
  });

  it('parses a command and boolean flags', () => {
    const o = parseArgs(['scan', '--sample', '--json', '--no-color']);
    expect(o.command).toBe('scan');
    expect(o.sample).toBe(true);
    expect(o.json).toBe(true);
    expect(o.noColor).toBe(true);
  });

  it('parses valued flags in both forms', () => {
    expect(parseArgs(['--root', '/tmp/x']).root).toBe('/tmp/x');
    expect(parseArgs(['--root=/tmp/y']).root).toBe('/tmp/y');
    expect(parseArgs(['--idle-ms', '5000']).idleMs).toBe(5000);
    expect(parseArgs(['--idle-ms=7000']).idleMs).toBe(7000);
    expect(parseArgs(['web', '--port', '8080']).port).toBe(8080);
    expect(parseArgs(['--port=9090']).port).toBe(9090);
  });

  it('maps help and version flags to commands', () => {
    expect(parseArgs(['-h']).command).toBe('help');
    expect(parseArgs(['--help']).command).toBe('help');
    expect(parseArgs(['-v']).command).toBe('version');
    expect(parseArgs(['--version']).command).toBe('version');
  });

  it('ignores invalid numeric flags and collects unknown flags', () => {
    expect(parseArgs(['--idle-ms', 'abc']).idleMs).toBeUndefined();
    expect(parseArgs(['--port', '0']).port).toBe(DEFAULT_PORT);
    expect(parseArgs(['--bogus']).unknown).toEqual(['--bogus']);
  });

  it('does not treat a flag value as the command', () => {
    expect(parseArgs(['--root', 'scan']).command).toBe('tui');
    expect(parseArgs(['--root', 'scan']).root).toBe('scan');
  });

  it('parses --source in both forms (defaults undefined → claude-code)', () => {
    expect(parseArgs([]).source).toBeUndefined();
    expect(parseArgs(['--source', 'generic-jsonl']).source).toBe('generic-jsonl');
    expect(parseArgs(['scan', '--source=generic-jsonl']).source).toBe('generic-jsonl');
  });

  it('parses alert threshold flags in both forms', () => {
    expect(parseArgs(['--alert-idle-min', '30']).alertIdleMin).toBe(30);
    expect(parseArgs(['--alert-idle-min=15']).alertIdleMin).toBe(15);
    expect(parseArgs(['--alert-cost', '2.5']).alertCost).toBe(2.5);
    expect(parseArgs(['--alert-cost=10']).alertCost).toBe(10);
    expect(parseArgs(['--alert-turn-min', '20']).alertTurnMin).toBe(20);
    expect(parseArgs(['--alert-turn-min=45']).alertTurnMin).toBe(45);
    expect(parseArgs(['--alert-idle-min', 'nope']).alertIdleMin).toBeUndefined();
  });
});

describe('alertRulesFromArgs', () => {
  it('returns undefined when no alert flags are set (use defaults downstream)', () => {
    expect(alertRulesFromArgs(parseArgs([]))).toBeUndefined();
  });

  it('builds an enabled rule set from flags', () => {
    const rules = alertRulesFromArgs(parseArgs(['--alert-idle-min', '5', '--alert-cost', '3', '--alert-turn-min', '20']));
    expect(rules).toBeDefined();
    expect(rules!.find((r) => r.type === 'idle')).toMatchObject({ enabled: true, minutes: 5 });
    expect(rules!.find((r) => r.type === 'cost')).toMatchObject({ enabled: true, usd: 3 });
    expect(rules!.find((r) => r.type === 'long-turn')?.minutes).toBe(20);
  });
});
