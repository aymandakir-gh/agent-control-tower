/**
 * Pure presentation formatters shared by every frontend (TUI, web, scan).
 * No colors here — each frontend maps status → color itself; this module only
 * produces plain strings and status-agnostic glyphs/labels.
 */

import type { AgentStatus } from './types.js';

/** Human duration: "820ms", "5s", "1m 23s", "2h 04m". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  const totalSec = Math.floor(ms / 1_000);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) return `${totalMin}m ${totalSec % 60}s`;
  const hours = Math.floor(totalMin / 60);
  return `${hours}h ${String(totalMin % 60).padStart(2, '0')}m`;
}

/** Compact token count: 940, "1.2k", "3.45M". */
export function formatTokensCompact(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n < 1_000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/** USD: "$0", "$0.0546", "$12.34". More precision under a dollar. */
export function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0';
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

/** Relative time: "—", "now", "5s ago", "3m ago", "2h ago", "1d ago". */
export function formatRelativeTime(ts: number, now: number): string {
  if (!ts || ts <= 0) return '—';
  const diff = now - ts;
  if (diff < 0) return 'now';
  const sec = Math.floor(diff / 1_000);
  if (sec < 1) return 'now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

const GLYPHS: Record<AgentStatus, string> = {
  working: '▶',
  waiting: '⏸',
  error: '✖',
  idle: '·',
};

/** A status-agnostic glyph for a status (frontends add color). */
export function statusGlyph(status: AgentStatus): string {
  return GLYPHS[status];
}

/** Upper-case status label. */
export function statusLabel(status: AgentStatus): string {
  return status.toUpperCase();
}
