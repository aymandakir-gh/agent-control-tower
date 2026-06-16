import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatRelativeTime,
  formatTokensCompact,
  formatUsd,
  statusGlyph,
  statusLabel,
} from '../../src/core/format.js';

describe('formatDuration', () => {
  it('formats across magnitudes', () => {
    expect(formatDuration(820)).toBe('820ms');
    expect(formatDuration(5_000)).toBe('5s');
    expect(formatDuration(83_000)).toBe('1m 23s');
    expect(formatDuration(2 * 3_600_000 + 4 * 60_000)).toBe('2h 04m');
  });
  it('handles invalid input', () => {
    expect(formatDuration(-1)).toBe('—');
    expect(formatDuration(NaN)).toBe('—');
  });
});

describe('formatTokensCompact', () => {
  it('formats compactly', () => {
    expect(formatTokensCompact(940)).toBe('940');
    expect(formatTokensCompact(1_200)).toBe('1.2k');
    expect(formatTokensCompact(3_450_000)).toBe('3.45M');
  });
});

describe('formatUsd', () => {
  it('shows more precision under a dollar', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(0.0546)).toBe('$0.0546');
    expect(formatUsd(12.345)).toBe('$12.35');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-06-16T12:00:00Z');
  it('formats relative times', () => {
    expect(formatRelativeTime(0, now)).toBe('—');
    expect(formatRelativeTime(now, now)).toBe('now');
    expect(formatRelativeTime(now - 5_000, now)).toBe('5s ago');
    expect(formatRelativeTime(now - 3 * 60_000, now)).toBe('3m ago');
    expect(formatRelativeTime(now - 2 * 3_600_000, now)).toBe('2h ago');
    expect(formatRelativeTime(now - 25 * 3_600_000, now)).toBe('1d ago');
  });
  it('treats future timestamps as now', () => {
    expect(formatRelativeTime(now + 5_000, now)).toBe('now');
  });
});

describe('status helpers', () => {
  it('maps glyphs and labels', () => {
    expect(statusGlyph('working')).toBe('▶');
    expect(statusGlyph('error')).toBe('✖');
    expect(statusLabel('idle')).toBe('IDLE');
  });
});
