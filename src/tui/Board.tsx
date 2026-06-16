/**
 * Presentational fleet board. Pure: given a FleetView + view-state props it
 * renders the whole screen. No data loading or input handling here, so it is
 * deterministic and snapshot-testable with ink-testing-library.
 */

import { Box, Text } from 'ink';
import React from 'react';
import {
  formatDuration,
  formatRelativeTime,
  formatTokensCompact,
  formatUsd,
  statusGlyph,
  type AgentSnapshot,
  type AgentStatus,
  type Alert,
  type AlertSeverity,
} from '../core/index.js';
import type { FleetView } from '../sources/transcripts.js';

const STATUS_INK_COLOR: Record<AgentStatus, string> = {
  working: 'green',
  waiting: 'yellow',
  error: 'red',
  idle: 'gray',
};

const SEVERITY_INK_COLOR: Record<AlertSeverity, string> = {
  critical: 'red',
  warn: 'yellow',
  info: 'blue',
};

const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, warn: 1, info: 2 };

/** Map each agent session to its most-severe alert (for per-row badges). */
function alertsBySession(alerts: Alert[]): Map<string, AlertSeverity> {
  const m = new Map<string, AlertSeverity>();
  for (const a of alerts) {
    const cur = m.get(a.sessionId);
    if (cur === undefined || SEVERITY_RANK[a.severity] < SEVERITY_RANK[cur]) m.set(a.sessionId, a.severity);
  }
  return m;
}

const STATUS_ORDER: AgentStatus[] = ['working', 'waiting', 'error', 'idle'];

export type SortKey = 'status' | 'duration' | 'cost' | 'project';

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, Math.max(0, n - 1)) + '…';
}
function pad(s: string, n: number): string {
  return s.length >= n ? truncate(s, n) : s + ' '.repeat(n - s.length);
}

const COLS = { status: 9, project: 16, branch: 14, model: 18, tool: 16, turn: 9, tokens: 8, cost: 9 };

function HeaderCells(): React.ReactElement {
  return (
    <Box>
      <Text dimColor>{pad('STATUS', COLS.status)} </Text>
      <Text dimColor>{pad('PROJECT', COLS.project)} </Text>
      <Text dimColor>{pad('BRANCH', COLS.branch)} </Text>
      <Text dimColor>{pad('MODEL', COLS.model)} </Text>
      <Text dimColor>{pad('TOOL', COLS.tool)} </Text>
      <Text dimColor>{pad('TURN', COLS.turn)} </Text>
      <Text dimColor>{pad('TOKENS', COLS.tokens)} </Text>
      <Text dimColor>{pad('COST', COLS.cost)} </Text>
      <Text dimColor>LAST</Text>
    </Box>
  );
}

function AgentRow({
  a,
  now,
  selected,
  alert,
}: {
  a: AgentSnapshot;
  now: number;
  selected: boolean;
  alert?: AlertSeverity;
}): React.ReactElement {
  const color = STATUS_INK_COLOR[a.status];
  const marker = selected ? '›' : ' ';
  const cost = a.cost.estimated ? `~${formatUsd(a.cost.usd)}` : formatUsd(a.cost.usd);
  return (
    <Box>
      <Text color={color} bold={selected}>
        {marker}
        {pad(`${statusGlyph(a.status)} ${a.status}`, COLS.status - 1)}{' '}
      </Text>
      <Text bold={selected}>{pad(a.project ?? a.slug ?? a.sessionId, COLS.project)} </Text>
      <Text dimColor>{pad(a.gitBranch ?? '—', COLS.branch)} </Text>
      <Text>{pad(a.model ?? '—', COLS.model)} </Text>
      <Text color="cyan">{pad(a.currentTool ?? '—', COLS.tool)} </Text>
      <Text>{pad(formatDuration(a.turnDurationMs), COLS.turn)} </Text>
      <Text>{pad(formatTokensCompact(a.totalTokens), COLS.tokens)} </Text>
      <Text>{pad(cost, COLS.cost)} </Text>
      <Text dimColor>{pad(formatRelativeTime(a.lastActivityAt, now), 8)}</Text>
      {alert ? <Text color={SEVERITY_INK_COLOR[alert]}> ▲</Text> : null}
    </Box>
  );
}

function AlertsPanel({ alerts, summary }: { alerts: Alert[]; summary: FleetView['alertSummary'] }): React.ReactElement {
  const counts = [
    summary.critical > 0 ? { n: summary.critical, label: 'critical', sev: 'critical' as const } : null,
    summary.warn > 0 ? { n: summary.warn, label: 'warn', sev: 'warn' as const } : null,
    summary.info > 0 ? { n: summary.info, label: 'info', sev: 'info' as const } : null,
  ].filter((x): x is { n: number; label: string; sev: AlertSeverity } => x !== null);
  return (
    <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Box>
        <Text bold color="yellow">⚠ alerts </Text>
        {counts.map((c, i) => (
          <Text key={c.label} color={SEVERITY_INK_COLOR[c.sev]}>
            {i > 0 ? ' · ' : ''}
            {c.n} {c.label}
          </Text>
        ))}
      </Box>
      {alerts.slice(0, 6).map((al, i) => (
        <Text key={`${al.sessionId}-${al.ruleId}-${i}`}>
          <Text color={SEVERITY_INK_COLOR[al.severity]}>▲ </Text>
          <Text bold>{pad(al.project ?? al.sessionId, COLS.project)} </Text>
          <Text dimColor>{al.message}</Text>
        </Text>
      ))}
    </Box>
  );
}

function Detail({ a, now }: { a: AgentSnapshot; now: number }): React.ReactElement {
  const t = a.tokens;
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>
        {a.slug ?? a.sessionId} <Text dimColor>({a.sessionId})</Text>
      </Text>
      <Text dimColor>{a.cwd ?? '—'}</Text>
      <Text>
        state: <Text color={STATUS_INK_COLOR[a.status]}>{a.status}</Text> — {a.reason}
      </Text>
      <Text>
        model: {a.model ?? '—'} · branch: {a.gitBranch ?? '—'} · subagents: {a.subagentCount}
      </Text>
      <Text>
        turn: {formatDuration(a.turnDurationMs)} · messages: {a.messageCount} · last:{' '}
        {formatRelativeTime(a.lastActivityAt, now)}
      </Text>
      <Text dimColor>
        tokens — in {formatTokensCompact(t.input)} · out {formatTokensCompact(t.output)} · cache-w{' '}
        {formatTokensCompact(t.cacheWrite5m + t.cacheWrite1h)} · cache-r {formatTokensCompact(t.cacheRead)}
      </Text>
      <Text>
        cost: {a.cost.estimated ? '~' : ''}
        {formatUsd(a.cost.usd)}
      </Text>
    </Box>
  );
}

export interface BoardProps {
  view: FleetView;
  now: number;
  selectedIndex: number;
  sortKey: SortKey;
  showDetail: boolean;
  message?: string;
  paused?: boolean;
}

export function Board({
  view,
  now,
  selectedIndex,
  sortKey,
  showDetail,
  message,
  paused,
}: BoardProps): React.ReactElement {
  const { fleet } = view;
  const agents = fleet.agents;
  const selected = agents[selectedIndex];
  const alertSeverity = alertsBySession(view.alerts);

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>agent-control-tower</Text>
        <Text dimColor>
          {'  '}
          {fleet.totals.agents} agent{fleet.totals.agents === 1 ? '' : 's'}
          {'  '}
          {view.sample ? 'sample data' : view.root}
          {paused ? '  [paused]' : ''}
        </Text>
      </Box>

      <Box>
        {STATUS_ORDER.map((s, i) => (
          <Text key={s} color={STATUS_INK_COLOR[s]}>
            {i > 0 ? '   ' : ''}
            {statusGlyph(s)} {fleet.totals.byStatus[s]} {s}
          </Text>
        ))}
      </Box>

      <Box marginTop={1} flexDirection="column">
        {agents.length === 0 ? (
          <Text dimColor>No agents found. Run with --sample to see a demo fleet.</Text>
        ) : (
          <>
            <HeaderCells />
            {agents.map((a, i) => (
              <AgentRow
                key={a.sessionId}
                a={a}
                now={now}
                selected={i === selectedIndex}
                {...(alertSeverity.has(a.sessionId) ? { alert: alertSeverity.get(a.sessionId) } : {})}
              />
            ))}
          </>
        )}
      </Box>

      {view.alerts.length > 0 && <AlertsPanel alerts={view.alerts} summary={view.alertSummary} />}

      {agents.length > 0 && (
        <Box marginTop={1}>
          <Text dimColor>fleet total: </Text>
          <Text>
            {formatTokensCompact(fleet.totals.totalTokens)} tokens  {formatUsd(fleet.totals.costUsd)}
          </Text>
          <Text dimColor>   · sort: {sortKey}</Text>
        </Box>
      )}

      {showDetail && selected && <Detail a={selected} now={now} />}

      {message && (
        <Box marginTop={1}>
          <Text color="yellow">{message}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          ↑/↓ select · enter detail · s sort · r refresh · p pause · k kill* · f focus* · q quit
          {'   '}(* stubbed)
        </Text>
      </Box>
    </Box>
  );
}
