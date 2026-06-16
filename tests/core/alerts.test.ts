import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALERT_RULES,
  EMPTY_TOKEN_USAGE,
  evaluateAlerts,
  resolveAlertRules,
  sortAlerts,
  summarizeAlerts,
  type AgentSnapshot,
  type Alert,
  type AlertRule,
  type FleetSnapshot,
} from '../../src/core/index.js';

const MIN = 60_000;

function mkAgent(over: Partial<AgentSnapshot> & { sessionId: string }): AgentSnapshot {
  return {
    status: 'waiting',
    reason: 'turn complete — awaiting next prompt',
    waitingForInput: false,
    turnDurationMs: 0,
    lastActivityAt: 0,
    isStale: false,
    messageCount: 1,
    assistantTurns: 1,
    subagentCount: 0,
    tokens: { ...EMPTY_TOKEN_USAGE },
    totalTokens: 0,
    cost: { usd: 0, estimated: false, breakdown: { ...EMPTY_TOKEN_USAGE }, perModel: {} },
    ...over,
  };
}

function mkFleet(agents: AgentSnapshot[], generatedAt = 0): FleetSnapshot {
  return {
    generatedAt,
    agents,
    totals: {
      agents: agents.length,
      byStatus: { working: 0, waiting: 0, error: 0, idle: 0 },
      tokens: { ...EMPTY_TOKEN_USAGE },
      totalTokens: 0,
      costUsd: 0,
    },
  };
}

const ONLY = (type: AlertRule['type'], over: Partial<AlertRule> = {}): AlertRule[] => [
  { id: type, type, enabled: true, severity: 'warn', ...over },
];

describe('evaluateAlerts — error rule', () => {
  it('fires (critical) on an errored agent', () => {
    const fleet = mkFleet([mkAgent({ sessionId: 's', status: 'error', reason: 'last turn ended on a tool error' })]);
    const alerts = evaluateAlerts(fleet, ONLY('error', { severity: 'critical' }), 0);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: 'error', severity: 'critical', sessionId: 's' });
    expect(alerts[0].message).toContain('tool error');
  });

  it('stays silent on a non-errored agent', () => {
    const fleet = mkFleet([mkAgent({ sessionId: 's', status: 'working' })]);
    expect(evaluateAlerts(fleet, ONLY('error'), 0)).toHaveLength(0);
  });
});

describe('evaluateAlerts — waiting (needs input) rule', () => {
  it('fires only when blocked on input', () => {
    const fleet = mkFleet([
      mkAgent({ sessionId: 'blocked', status: 'waiting', waitingForInput: true, currentTool: 'AskUserQuestion' }),
    ]);
    const alerts = evaluateAlerts(fleet, ONLY('waiting'), 0);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toContain('AskUserQuestion');
  });

  it('stays silent for a benign "awaiting next prompt" waiting agent', () => {
    const fleet = mkFleet([mkAgent({ sessionId: 'idle-wait', status: 'waiting', waitingForInput: false })]);
    expect(evaluateAlerts(fleet, ONLY('waiting'), 0)).toHaveLength(0);
  });

  it('renders without a tool name when none is set', () => {
    const fleet = mkFleet([mkAgent({ sessionId: 'b', status: 'waiting', waitingForInput: true })]);
    expect(evaluateAlerts(fleet, ONLY('waiting'), 0)[0].message).toBe('waiting for input');
  });
});

describe('evaluateAlerts — idle rule', () => {
  const BASE = 1_000_000;
  it('fires when idle longer than the threshold (with rounded value)', () => {
    const agent = mkAgent({ sessionId: 's', status: 'idle', lastActivityAt: BASE });
    const alerts = evaluateAlerts(mkFleet([agent]), ONLY('idle', { minutes: 30, severity: 'info' }), BASE + 45 * MIN);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: 'idle', value: 45 });
    expect(alerts[0].message).toBe('idle for 45m');
  });

  it('stays silent below the threshold', () => {
    const agent = mkAgent({ sessionId: 's', status: 'idle', lastActivityAt: BASE });
    expect(evaluateAlerts(mkFleet([agent]), ONLY('idle', { minutes: 30 }), BASE + 10 * MIN)).toHaveLength(0);
  });

  it('stays silent for non-idle agents and for missing activity timestamps', () => {
    const working = mkAgent({ sessionId: 'w', status: 'working', lastActivityAt: BASE });
    const noTs = mkAgent({ sessionId: 'n', status: 'idle', lastActivityAt: 0 });
    // working never matches idle; noTs has lastActivityAt<=0 so cannot be measured.
    expect(evaluateAlerts(mkFleet([working]), ONLY('idle', { minutes: 1 }), BASE + 100 * MIN)).toHaveLength(0);
    expect(evaluateAlerts(mkFleet([noTs]), ONLY('idle', { minutes: 1 }), 100 * MIN)).toHaveLength(0);
  });

  it('never fires when the rule omits a minutes threshold', () => {
    const agent = mkAgent({ sessionId: 's', status: 'idle', lastActivityAt: 1 });
    expect(evaluateAlerts(mkFleet([agent]), ONLY('idle'), 10 ** 12)).toHaveLength(0);
  });
});

describe('evaluateAlerts — long-turn rule', () => {
  it('fires for a working agent past the turn threshold', () => {
    const agent = mkAgent({ sessionId: 's', status: 'working', turnDurationMs: 20 * MIN });
    const alerts = evaluateAlerts(mkFleet([agent]), ONLY('long-turn', { minutes: 15 }), 0);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: 'long-turn', value: 20 });
    expect(alerts[0].message).toBe('turn running 20m');
  });

  it('stays silent for short turns and for non-working agents with long durations', () => {
    const short = mkAgent({ sessionId: 'a', status: 'working', turnDurationMs: 5 * MIN });
    const doneLong = mkAgent({ sessionId: 'b', status: 'idle', turnDurationMs: 99 * MIN });
    expect(evaluateAlerts(mkFleet([short]), ONLY('long-turn', { minutes: 15 }), 0)).toHaveLength(0);
    expect(evaluateAlerts(mkFleet([doneLong]), ONLY('long-turn', { minutes: 15 }), 0)).toHaveLength(0);
  });

  it('never fires when the rule omits a minutes threshold', () => {
    const agent = mkAgent({ sessionId: 's', status: 'working', turnDurationMs: 10 ** 9 });
    expect(evaluateAlerts(mkFleet([agent]), ONLY('long-turn'), 0)).toHaveLength(0);
  });
});

describe('evaluateAlerts — cost rule', () => {
  it('fires at or above the USD ceiling', () => {
    const agent = mkAgent({
      sessionId: 's',
      cost: { usd: 12.345, estimated: false, breakdown: { ...EMPTY_TOKEN_USAGE }, perModel: {} },
    });
    const alerts = evaluateAlerts(mkFleet([agent]), ONLY('cost', { usd: 10 }), 0);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: 'cost', value: 12.345 });
    expect(alerts[0].message).toContain('$10');
    expect(alerts[0].message).toContain('12.3');
  });

  it('stays silent below the ceiling', () => {
    const agent = mkAgent({
      sessionId: 's',
      cost: { usd: 4, estimated: false, breakdown: { ...EMPTY_TOKEN_USAGE }, perModel: {} },
    });
    expect(evaluateAlerts(mkFleet([agent]), ONLY('cost', { usd: 10 }), 0)).toHaveLength(0);
  });

  it('never fires when the rule omits a USD threshold', () => {
    const agent = mkAgent({
      sessionId: 's',
      cost: { usd: 9999, estimated: false, breakdown: { ...EMPTY_TOKEN_USAGE }, perModel: {} },
    });
    expect(evaluateAlerts(mkFleet([agent]), ONLY('cost'), 0)).toHaveLength(0);
  });
});

describe('evaluateAlerts — rule gating & defaults', () => {
  it('skips disabled rules', () => {
    const fleet = mkFleet([mkAgent({ sessionId: 's', status: 'error' })]);
    expect(evaluateAlerts(fleet, [{ id: 'error', type: 'error', enabled: false, severity: 'critical' }], 0)).toHaveLength(0);
  });

  it('uses DEFAULT_ALERT_RULES and now=generatedAt when omitted', () => {
    // Defaults: error+waiting+long-turn enabled; an errored agent must alert.
    const fleet = mkFleet([mkAgent({ sessionId: 's', status: 'error' })], 1000);
    const alerts = evaluateAlerts(fleet);
    expect(alerts.some((a) => a.type === 'error')).toBe(true);
    // idle is off by default → an old idle agent does not alert under defaults.
    const idleFleet = mkFleet([mkAgent({ sessionId: 'i', status: 'idle', lastActivityAt: 1 })], 10 ** 12);
    expect(evaluateAlerts(idleFleet).some((a) => a.type === 'idle')).toBe(false);
  });
});

describe('resolveAlertRules', () => {
  it('returns the defaults unchanged when no overrides are given', () => {
    const rules = resolveAlertRules();
    expect(rules.find((r) => r.type === 'idle')?.enabled).toBe(false);
    expect(rules.find((r) => r.type === 'cost')?.enabled).toBe(false);
    expect(rules.find((r) => r.type === 'long-turn')?.minutes).toBe(15);
    // a fresh copy, not the frozen default array
    expect(rules).not.toBe(DEFAULT_ALERT_RULES);
  });

  it('enables idle and cost and overrides the long-turn threshold', () => {
    const rules = resolveAlertRules({ idleMinutes: 5, costUsd: 2.5, turnMinutes: 30 });
    expect(rules.find((r) => r.type === 'idle')).toMatchObject({ enabled: true, minutes: 5 });
    expect(rules.find((r) => r.type === 'cost')).toMatchObject({ enabled: true, usd: 2.5 });
    expect(rules.find((r) => r.type === 'long-turn')?.minutes).toBe(30);
  });
});

describe('sortAlerts & summarizeAlerts', () => {
  const sample: Alert[] = [
    { ruleId: 'cost', type: 'cost', severity: 'warn', sessionId: 'z', project: 'zeta', message: 'm' },
    { ruleId: 'error', type: 'error', severity: 'critical', sessionId: 'a', project: 'alpha', message: 'm' },
    { ruleId: 'idle', type: 'idle', severity: 'info', sessionId: 'b', message: 'm' },
    { ruleId: 'waiting', type: 'waiting', severity: 'warn', sessionId: 'a', project: 'alpha', message: 'm' },
  ];

  it('orders by severity, then project/session, then ruleId', () => {
    const order = sortAlerts(sample).map((a) => a.ruleId);
    expect(order).toEqual(['error', 'waiting', 'cost', 'idle']);
  });

  it('counts by severity', () => {
    expect(summarizeAlerts(sample)).toEqual({ total: 4, critical: 1, warn: 2, info: 1 });
  });

  it('breaks ties on ruleId when severity and project match', () => {
    const tie: Alert[] = [
      { ruleId: 'long-turn', type: 'long-turn', severity: 'warn', sessionId: 'a', project: 'alpha', message: 'm' },
      { ruleId: 'cost', type: 'cost', severity: 'warn', sessionId: 'a', project: 'alpha', message: 'm' },
    ];
    expect(sortAlerts(tie).map((a) => a.ruleId)).toEqual(['cost', 'long-turn']);
  });
});

describe('evaluateAlerts — integration ordering across agents', () => {
  it('returns alerts most-urgent first', () => {
    const fleet = mkFleet([
      mkAgent({ sessionId: 'w', project: 'web', status: 'waiting', waitingForInput: true, currentTool: 'AskUserQuestion' }),
      mkAgent({ sessionId: 'e', project: 'etl', status: 'error', reason: 'boom' }),
    ]);
    const alerts = evaluateAlerts(fleet, [...DEFAULT_ALERT_RULES], 0);
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].sessionId).toBe('e');
  });
});
