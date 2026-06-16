import { describe, expect, it } from 'vitest';
import { DEFAULT_PORT, parseArgs } from '../../src/cli/args.js';

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
});
