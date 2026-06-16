/**
 * Fixture builder: programmatically construct realistic Claude Code transcript
 * JSONL. Mirrors the envelope + message shapes observed from real data (PRD §5)
 * so unit tests assert against representative input.
 *
 * All write-path tests use generated fixtures — never real ~/.claude data.
 */

let uuidCounter = 0;
function uuid(): string {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`;
}

export interface UsageInit {
  input?: number;
  output?: number;
  cacheWrite5m?: number;
  cacheWrite1h?: number;
  cacheRead?: number;
}

export function usage(init: UsageInit = {}): Record<string, unknown> {
  return {
    input_tokens: init.input ?? 0,
    output_tokens: init.output ?? 0,
    cache_read_input_tokens: init.cacheRead ?? 0,
    cache_creation_input_tokens: (init.cacheWrite5m ?? 0) + (init.cacheWrite1h ?? 0),
    cache_creation: {
      ephemeral_5m_input_tokens: init.cacheWrite5m ?? 0,
      ephemeral_1h_input_tokens: init.cacheWrite1h ?? 0,
    },
  };
}

export interface ToolUseInit {
  name: string;
  id?: string;
  input?: unknown;
}

export interface AssistantInit {
  text?: string;
  thinking?: string;
  tools?: ToolUseInit[];
  stopReason?: 'tool_use' | 'end_turn' | 'stop_sequence';
  usage?: UsageInit;
  model?: string;
}

export interface BuilderInit {
  sessionId?: string;
  slug?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  model?: string;
  startTs?: number;
  /** Default ms advanced between records. */
  stepMs?: number;
  isSidechain?: boolean;
  agentId?: string;
}

export class TranscriptBuilder {
  private records: Record<string, unknown>[] = [];
  private t: number;
  private toolIdCounter = 0;
  readonly sessionId: string;
  readonly slug: string;
  readonly cwd: string;
  readonly gitBranch: string;
  readonly version: string;
  readonly model: string;
  private readonly stepMs: number;
  private readonly isSidechain: boolean;
  private readonly agentId?: string;

  constructor(init: BuilderInit = {}) {
    this.sessionId = init.sessionId ?? 'sess-00000000';
    this.slug = init.slug ?? 'test-session';
    this.cwd = init.cwd ?? '/Users/dev/projects/demo';
    this.gitBranch = init.gitBranch ?? 'main';
    this.version = init.version ?? '2.1.162';
    this.model = init.model ?? 'claude-opus-4-8';
    this.t = init.startTs ?? Date.parse('2026-06-16T10:00:00.000Z');
    this.stepMs = init.stepMs ?? 1000;
    this.isSidechain = init.isSidechain ?? false;
    if (init.agentId !== undefined) this.agentId = init.agentId;
  }

  /** Current clock (ms). Useful for choosing a `now` in tests. */
  get clock(): number {
    return this.t;
  }

  /** Advance the clock and return an ISO timestamp for the next record. */
  private stamp(deltaMs?: number): { timestamp: string; ts: number } {
    this.t += deltaMs ?? this.stepMs;
    return { timestamp: new Date(this.t).toISOString(), ts: this.t };
  }

  private envelope(extra?: number): Record<string, unknown> {
    const { timestamp } = this.stamp(extra);
    return {
      uuid: uuid(),
      timestamp,
      sessionId: this.sessionId,
      slug: this.slug,
      cwd: this.cwd,
      gitBranch: this.gitBranch,
      version: this.version,
      isSidechain: this.isSidechain,
      ...(this.agentId !== undefined ? { agentId: this.agentId } : {}),
    };
  }

  prompt(text: string, deltaMs?: number): this {
    this.records.push({
      ...this.envelope(deltaMs),
      type: 'user',
      message: { role: 'user', content: text },
    });
    return this;
  }

  assistant(init: AssistantInit = {}, deltaMs?: number): this {
    const content: Record<string, unknown>[] = [];
    if (init.thinking) content.push({ type: 'thinking', thinking: init.thinking });
    if (init.text) content.push({ type: 'text', text: init.text });
    for (const tool of init.tools ?? []) {
      this.toolIdCounter += 1;
      content.push({
        type: 'tool_use',
        id: tool.id ?? `toolu_${this.toolIdCounter}`,
        name: tool.name,
        input: tool.input ?? {},
      });
    }
    const stopReason = init.stopReason ?? (init.tools && init.tools.length > 0 ? 'tool_use' : 'end_turn');
    this.records.push({
      ...this.envelope(deltaMs),
      type: 'assistant',
      message: {
        role: 'assistant',
        model: init.model ?? this.model,
        content,
        stop_reason: stopReason,
        usage: usage(init.usage ?? {}),
      },
    });
    return this;
  }

  /** Most-recent tool_use id issued by this builder (for pairing results). */
  lastToolId(): string {
    return `toolu_${this.toolIdCounter}`;
  }

  toolResult(
    init: { toolUseId?: string; isError?: boolean; content?: string } = {},
    deltaMs?: number,
  ): this {
    this.records.push({
      ...this.envelope(deltaMs),
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: init.toolUseId ?? this.lastToolId(),
            is_error: init.isError ?? false,
            content: init.content ?? 'ok',
          },
        ],
      },
    });
    return this;
  }

  turnDuration(durationMs: number, messageCount = 1, deltaMs?: number): this {
    this.records.push({
      ...this.envelope(deltaMs),
      type: 'system',
      subtype: 'turn_duration',
      durationMs,
      messageCount,
    });
    return this;
  }

  system(subtype: string, extra: Record<string, unknown> = {}, deltaMs?: number): this {
    this.records.push({ ...this.envelope(deltaMs), type: 'system', subtype, ...extra });
    return this;
  }

  /** Push an arbitrary record (for unknown types / robustness tests). */
  raw(obj: Record<string, unknown>): this {
    this.records.push(obj);
    return this;
  }

  /** Serialize to JSONL text. */
  build(): string {
    return this.records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  }

  /** Number of records added so far. */
  get length(): number {
    return this.records.length;
  }
}
