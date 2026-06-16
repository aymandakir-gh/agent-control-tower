/**
 * Read-only polling watcher. Detects when transcripts under a root change
 * (added, removed, or appended) and fires a debounced callback.
 *
 * Polling (stat mtimes/sizes) is used rather than fs.watch for deterministic,
 * cross-platform behavior — and so the change-detection logic is pure and
 * testable in isolation. Strictly read-only.
 */

import { findSessionFiles, type SessionFileRef } from './transcripts.js';

/** A stable signature of the file set; changes when any file is added/removed/grown. */
export function signature(refs: SessionFileRef[]): string {
  return refs
    .map((r) => `${r.path}:${r.size}:${r.mtimeMs}`)
    .sort()
    .join('|');
}

export interface WatcherHandle {
  /** Force an immediate check; resolves true if a change was detected. */
  poll: () => Promise<boolean>;
  /** Stop polling. */
  stop: () => void;
}

export interface WatchOptions {
  /** Poll interval in milliseconds. Default 1000. */
  intervalMs?: number;
}

/**
 * Watch `root`; call `onChange` whenever the transcript file set changes.
 * Returns a handle to poll on demand and to stop.
 */
export function watchRoot(root: string, onChange: () => void, opts: WatchOptions = {}): WatcherHandle {
  const intervalMs = opts.intervalMs ?? 1_000;
  let last = '';
  let timer: ReturnType<typeof setInterval> | undefined;
  let initialized = false;
  let polling = false;

  const poll = async (): Promise<boolean> => {
    // Re-entrancy guard: if a scan is slower than the interval, skip overlapping
    // ticks so concurrent runs can't race on `last`/`initialized`.
    if (polling) return false;
    polling = true;
    try {
      const sig = signature(await findSessionFiles(root));
      const changed = initialized && sig !== last;
      last = sig;
      initialized = true;
      if (changed) onChange();
      return changed;
    } finally {
      polling = false;
    }
  };

  // The first poll (interval tick or explicit) seeds the baseline and reports
  // no change; subsequent polls report changes relative to it.
  timer = setInterval(() => {
    void poll();
  }, intervalMs);
  // Don't keep the event loop alive on our account.
  if (timer && typeof timer.unref === 'function') timer.unref();

  return {
    poll,
    stop: () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
