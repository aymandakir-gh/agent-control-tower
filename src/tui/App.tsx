/**
 * Stateful TUI app: loads the fleet, watches for changes, ticks the clock for
 * live turn durations, and handles keyboard input. Renders the pure <Board/>.
 *
 * kill/focus are intentionally stubbed (emit intent) per PRD M2 — the displayed
 * state is real; no process is signaled and nothing under ~/.claude is written.
 */

import { Box, Text, useApp, useInput } from 'ink';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  createControlSetup,
  executeControl,
  targetFromAgent,
  type ControlAction,
  type ControlSetup,
} from '../control/index.js';
import { loadFleetView, watchRoot, type FleetView, type LoadOptions } from '../sources/index.js';
import { Board, type SortKey } from './Board.js';
import { nextSort, sortAgentsBy } from './sort.js';

export type Loader = (opts: LoadOptions) => Promise<FleetView>;

export interface AppProps {
  options: LoadOptions & { root?: string };
  /** Injectable for tests; defaults to the real read-only loader. */
  loader?: Loader;
  /** Enable real management actions (focus/pause/resume). Off by default. */
  allowControl?: boolean;
  /** Injectable control setup (tests). Defaults to one built from allowControl. */
  control?: ControlSetup;
  /** Clock tick (ms) for live durations. Default 1000. */
  tickMs?: number;
  /** Disable the filesystem watcher (tests). */
  noWatch?: boolean;
}

function applySort(view: FleetView, key: SortKey): FleetView {
  return { ...view, fleet: { ...view.fleet, agents: sortAgentsBy(view.fleet.agents, key) } };
}

export function App({ options, loader = loadFleetView, allowControl, control, tickMs = 1_000, noWatch }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const controlRef = useRef<ControlSetup>(control ?? createControlSetup(allowControl ?? false));
  const [view, setView] = useState<FleetView | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>('status');
  const [showDetail, setShowDetail] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const refresh = useCallback(async () => {
    try {
      const next = await loader({ ...options, sample: options.sample ?? false });
      setView(applySort(next, sortKey));
      if (!options.sample) setNow(Date.now());
      else setNow(next.now);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [loader, options, sortKey]);

  // Initial load (once on mount). refresh closes over current props/state.
  useEffect(() => {
    void refresh();
  }, []);

  // Clock tick for live durations (live mode only).
  useEffect(() => {
    if (options.sample) return;
    const id = setInterval(() => {
      if (!pausedRef.current) setNow(Date.now());
    }, tickMs);
    if (typeof id.unref === 'function') id.unref();
    return () => clearInterval(id);
  }, [options.sample, tickMs]);

  // Watch for transcript changes → reload (live mode only). We watch the
  // resolved root from the loaded view so the correct source's directory is
  // observed (e.g. a custom --root or a non-Claude --source default).
  const watchTarget = view?.root;
  useEffect(() => {
    if (noWatch || options.sample || !watchTarget) return;
    const w = watchRoot(watchTarget, () => {
      if (!pausedRef.current) void refresh();
    });
    return () => w.stop();
  }, [noWatch, options.sample, watchTarget, refresh]);

  // Re-sort in place when the sort key changes.
  useEffect(() => {
    setView((v) => (v ? applySort(v, sortKey) : v));
  }, [sortKey]);

  const agentCount = view?.fleet.agents.length ?? 0;

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
      return;
    }
    if (input === 'r') {
      setMessage('refreshing…');
      void refresh().then(() => setMessage(undefined));
      return;
    }
    if (input === 's') {
      setSortKey((k) => nextSort(k));
      return;
    }
    if (input === 'p') {
      setPaused((p) => !p);
      return;
    }
    if (key.return) {
      setShowDetail((d) => !d);
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(Math.max(0, agentCount - 1), i + 1));
      return;
    }
    const selected = view?.fleet.agents[selectedIndex];
    const action: ControlAction | undefined =
      input === 'f' ? 'focus' : input === 'z' ? 'pause' : input === 'x' ? 'resume' : undefined;
    if (action && selected) {
      const label = selected.project ?? selected.slug ?? selected.sessionId;
      setMessage(`${action}: resolving ${label}…`);
      void executeControl(controlRef.current, targetFromAgent(selected), action).then((r) => {
        setMessage(`${r.ok ? '✓' : '✗'} ${action} ${label} — ${r.reason}`);
      });
      return;
    }
  });

  if (error) {
    return (
      <Box>
        <Text color="red">Error: {error}</Text>
      </Box>
    );
  }
  if (!view) {
    return (
      <Box>
        <Text dimColor>Loading fleet…</Text>
      </Box>
    );
  }

  const clampedIndex = Math.min(selectedIndex, Math.max(0, agentCount - 1));
  return (
    <Board
      view={view}
      now={now}
      selectedIndex={clampedIndex}
      sortKey={sortKey}
      showDetail={showDetail}
      {...(message !== undefined ? { message } : {})}
      paused={paused}
      controlEnabled={controlRef.current.enabled}
    />
  );
}
