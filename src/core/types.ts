/**
 * Core domain types for agent-control-tower.
 *
 * Everything here is plain data. The core library (parser, fsm, cost, timeline,
 * fleet) operates only on these types and never performs I/O — see PRD §8.
 */

/** The four states an agent can be in (PRD §6). */
export type AgentStatus = 'idle' | 'working' | 'waiting' | 'error';

/** Token usage, normalized from a Claude Code `usage` block. */
export interface TokenUsage {
  /** Non-cached input tokens. */
  input: number;
  /** Output (generated) tokens. */
  output: number;
  /** Tokens written to the 5-minute ephemeral cache. */
  cacheWrite5m: number;
  /** Tokens written to the 1-hour ephemeral cache. */
  cacheWrite1h: number;
  /** Tokens read from cache. */
  cacheRead: number;
}

/** A tool invocation requested by the assistant. */
export interface ToolUseRef {
  id?: string;
  name: string;
}

/** Discriminator for normalized events. */
export type AgentEventKind =
  | 'human_prompt'
  | 'assistant_message'
  | 'tool_result'
  | 'turn_duration'
  | 'system'
  | 'meta';

export interface BaseEvent {
  kind: AgentEventKind;
  /** Sequential index within the transcript (stable tiebreaker for equal timestamps). */
  seq: number;
  /** Epoch milliseconds; 0 when the source record had no/invalid timestamp. */
  ts: number;
  /** Original ISO-8601 timestamp string, if present. */
  tsIso?: string;
  uuid?: string;
  sessionId?: string;
  /** True for subagent (Task/Agent) turns. */
  isSidechain: boolean;
  /** Present on subagent turns. */
  agentId?: string;
}

/** A human-authored prompt (Claude Code `user` record with string content). */
export interface HumanPromptEvent extends BaseEvent {
  kind: 'human_prompt';
  text: string;
}

/** An assistant turn. May carry text, thinking, and zero or more tool_use blocks. */
export interface AssistantMessageEvent extends BaseEvent {
  kind: 'assistant_message';
  model: string;
  stopReason?: string;
  usage?: TokenUsage;
  toolUses: ToolUseRef[];
  /** Combined length of text blocks (used for timeline summaries). */
  textLength: number;
  hasThinking: boolean;
}

/** A tool result fed back to the assistant (Claude Code `user` record, array content). */
export interface ToolResultEvent extends BaseEvent {
  kind: 'tool_result';
  toolUseId?: string;
  isError: boolean;
}

/** A `system`/`turn_duration` marker carrying the measured duration of a completed turn. */
export interface TurnDurationEvent extends BaseEvent {
  kind: 'turn_duration';
  durationMs: number;
  messageCount?: number;
}

/** Any other `system` record (stop_hook_summary, local_command, informational, ...). */
export interface SystemEvent extends BaseEvent {
  kind: 'system';
  subtype?: string;
  /** True when the record signals an error condition. */
  isError: boolean;
}

/** Records we keep but mostly ignore (attachment, queue-operation, ...). */
export interface MetaEvent extends BaseEvent {
  kind: 'meta';
  recordType: string;
}

export type NormalizedEvent =
  | HumanPromptEvent
  | AssistantMessageEvent
  | ToolResultEvent
  | TurnDurationEvent
  | SystemEvent
  | MetaEvent;

/** Result of parsing a single transcript file. */
export interface ParsedTranscript {
  sessionId?: string;
  /** Human-readable session name (Claude Code `slug`), e.g. "swift-singing-truffle". */
  slug?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  /** Main-chain events (isSidechain === false), chronological. */
  events: NormalizedEvent[];
  /** Subagent events (isSidechain === true), chronological. */
  sidechainEvents: NormalizedEvent[];
  stats: ParseStats;
}

export interface ParseStats {
  totalLines: number;
  parsed: number;
  /** Lines that were blank, malformed JSON, or otherwise unparseable. */
  skipped: number;
}

/** Per-model USD price, per **million** tokens. */
export interface ModelPricing {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

export type PricingTable = Record<string, ModelPricing>;

export interface CostBreakdown {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

export interface CostEstimate {
  /** Total estimated cost in USD. */
  usd: number;
  /** True if any contributing model used a fallback price (mark "~" in UIs). */
  estimated: boolean;
  breakdown: CostBreakdown;
  /** USD attributed per model id. */
  perModel: Record<string, number>;
}

/** Tunable thresholds for the state machine (PRD §6). */
export interface FsmConfig {
  /** A completed agent older than this (ms) is `idle`, otherwise `waiting`. */
  idleMs: number;
  /** Tool names that mean the agent is blocked on a human. */
  interactiveTools: string[];
}

export const DEFAULT_FSM_CONFIG: FsmConfig = {
  idleMs: 120_000,
  interactiveTools: ['AskUserQuestion'],
};

/** A point-in-time view of one agent. */
export interface AgentSnapshot {
  sessionId: string;
  slug?: string;
  cwd?: string;
  /** Basename of `cwd`, a short project label. */
  project?: string;
  gitBranch?: string;
  version?: string;
  model?: string;
  status: AgentStatus;
  /** Which FSM rule decided the status (for transparency + tests). */
  reason: string;
  /** Name of the pending or most-recent tool, if any. */
  currentTool?: string;
  /** Epoch ms when the in-progress (or most recent) turn began. */
  turnStartedAt?: number;
  /** Elapsed ms for an active turn (now − turnStartedAt), or the recorded duration. */
  turnDurationMs: number;
  lastActivityAt: number;
  /** Whether the agent has had no activity within `idleMs`. */
  isStale: boolean;
  messageCount: number;
  assistantTurns: number;
  /** Distinct subagent ids spawned by this session. */
  subagentCount: number;
  tokens: TokenUsage;
  totalTokens: number;
  cost: CostEstimate;
}

export interface FleetTotals {
  agents: number;
  byStatus: Record<AgentStatus, number>;
  tokens: TokenUsage;
  totalTokens: number;
  costUsd: number;
}

export interface FleetSnapshot {
  generatedAt: number;
  agents: AgentSnapshot[];
  totals: FleetTotals;
}

/** A single entry in the unified cross-agent timeline. */
export interface TimelineEntry {
  ts: number;
  tsIso?: string;
  sessionId: string;
  slug?: string;
  project?: string;
  kind: AgentEventKind;
  /** Short human-readable summary, e.g. "tool: Bash" or "error: tool failed". */
  label: string;
  isError: boolean;
  toolName?: string;
}

export const ALL_STATUSES: readonly AgentStatus[] = ['working', 'waiting', 'error', 'idle'];

export const EMPTY_TOKEN_USAGE: TokenUsage = {
  input: 0,
  output: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
};
