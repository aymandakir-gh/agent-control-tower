/**
 * Alert engine (PRD §13). Pure: `evaluateAlerts(fleet, rules, now) → Alert[]`.
 *
 * Configurable rules surface agents that need attention — errored, blocked on
 * input, idle too long, running a single turn too long, or burning past a cost
 * ceiling. Deterministic and I/O-free, so the whole engine is unit-testable
 * against fixtures. Frontends render the result; they contain no rule logic.
 */

import type { AgentSnapshot, FleetSnapshot } from './types.js';

export type AlertSeverity = 'info' | 'warn' | 'critical';

export type AlertType = 'error' | 'waiting' | 'idle' | 'long-turn' | 'cost';

/** A configurable rule. `minutes`/`usd` apply to the threshold-based types. */
export interface AlertRule {
  id: string;
  type: AlertType;
  enabled: boolean;
  severity: AlertSeverity;
  /** Threshold in minutes for `idle` and `long-turn`. */
  minutes?: number;
  /** Threshold in USD for `cost`. */
  usd?: number;
}

/** One fired alert, tied to an agent. */
export interface Alert {
  ruleId: string;
  type: AlertType;
  severity: AlertSeverity;
  sessionId: string;
  project?: string;
  message: string;
  /** The measured value that tripped the rule (minutes for time rules, USD for cost). */
  value?: number;
}

/** Default rule set (PRD §13). idle + cost are off by default (opt-in via flags). */
export const DEFAULT_ALERT_RULES: readonly AlertRule[] = [
  { id: 'error', type: 'error', enabled: true, severity: 'critical' },
  { id: 'waiting', type: 'waiting', enabled: true, severity: 'warn' },
  { id: 'idle', type: 'idle', enabled: false, severity: 'info', minutes: 30 },
  { id: 'long-turn', type: 'long-turn', enabled: true, severity: 'warn', minutes: 15 },
  { id: 'cost', type: 'cost', enabled: false, severity: 'warn', usd: 10 },
];

const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, warn: 1, info: 2 };

const MIN = 60_000;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Tunable inputs (e.g. from CLI flags) that toggle/parameterize the defaults. */
export interface AlertOptions {
  /** Enable the idle rule at this many minutes. */
  idleMinutes?: number;
  /** Enable the cost rule at this many USD. */
  costUsd?: number;
  /** Override the long-turn threshold (minutes). */
  turnMinutes?: number;
}

/** Build a concrete rule set from the defaults + CLI-style overrides. */
export function resolveAlertRules(opts: AlertOptions = {}): AlertRule[] {
  return DEFAULT_ALERT_RULES.map((r) => {
    if (r.type === 'idle' && opts.idleMinutes !== undefined) {
      return { ...r, enabled: true, minutes: opts.idleMinutes };
    }
    if (r.type === 'cost' && opts.costUsd !== undefined) {
      return { ...r, enabled: true, usd: opts.costUsd };
    }
    if (r.type === 'long-turn' && opts.turnMinutes !== undefined) {
      return { ...r, minutes: opts.turnMinutes };
    }
    return { ...r };
  });
}

/** Evaluate one rule against one agent; returns an Alert or null. */
function evalRule(rule: AlertRule, a: AgentSnapshot, now: number): Alert | null {
  const base = {
    ruleId: rule.id,
    type: rule.type,
    severity: rule.severity,
    sessionId: a.sessionId,
    ...(a.project !== undefined ? { project: a.project } : {}),
  };

  switch (rule.type) {
    case 'error':
      if (a.status !== 'error') return null;
      return { ...base, message: `errored — ${a.reason}` };

    case 'waiting':
      if (!(a.status === 'waiting' && a.waitingForInput)) return null;
      return { ...base, message: `waiting for input${a.currentTool ? ` (${a.currentTool})` : ''}` };

    case 'idle': {
      if (a.status !== 'idle' || a.lastActivityAt <= 0) return null;
      const minutes = (now - a.lastActivityAt) / MIN;
      if (minutes < (rule.minutes ?? Infinity)) return null;
      return { ...base, value: round1(minutes), message: `idle for ${round1(minutes)}m` };
    }

    case 'long-turn': {
      // Only an in-progress turn (working) can be "running too long".
      if (a.status !== 'working') return null;
      const minutes = a.turnDurationMs / MIN;
      if (minutes < (rule.minutes ?? Infinity)) return null;
      return { ...base, value: round1(minutes), message: `turn running ${round1(minutes)}m` };
    }

    case 'cost': {
      const threshold = rule.usd ?? Infinity;
      if (a.cost.usd < threshold) return null;
      return { ...base, value: a.cost.usd, message: `cost ≥ $${threshold} (now $${round1(a.cost.usd)})` };
    }
  }
}

/** Sort alerts most-urgent first: by severity, then project/session for stability. */
export function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort((x, y) => {
    const s = SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity];
    if (s !== 0) return s;
    const p = (x.project ?? x.sessionId).localeCompare(y.project ?? y.sessionId);
    if (p !== 0) return p;
    return x.ruleId.localeCompare(y.ruleId);
  });
}

/** Evaluate all enabled rules across every agent in the fleet. */
export function evaluateAlerts(
  fleet: FleetSnapshot,
  rules: readonly AlertRule[] = DEFAULT_ALERT_RULES,
  now: number = fleet.generatedAt,
): Alert[] {
  const out: Alert[] = [];
  for (const agent of fleet.agents) {
    for (const rule of rules) {
      if (!rule.enabled) continue;
      const alert = evalRule(rule, agent, now);
      if (alert) out.push(alert);
    }
  }
  return sortAlerts(out);
}

export interface AlertSummary {
  total: number;
  critical: number;
  warn: number;
  info: number;
}

/** Count alerts by severity (for badges / headers). */
export function summarizeAlerts(alerts: Alert[]): AlertSummary {
  const summary: AlertSummary = { total: alerts.length, critical: 0, warn: 0, info: 0 };
  for (const a of alerts) summary[a.severity]++;
  return summary;
}
