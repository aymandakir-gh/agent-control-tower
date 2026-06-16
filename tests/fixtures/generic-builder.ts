/**
 * Generic JSONL/hook fixture builder (PRD §12). Mirrors the framework-neutral
 * line schema the `generic-jsonl` adapter parses, so conformance + unit tests
 * assert against representative input. Parallels TranscriptBuilder (Claude
 * dialect) one-for-one so the same scenarios can be expressed in both.
 */

export interface GenericUsageInit {
  input?: number;
  output?: number;
  cacheWrite5m?: number;
  cacheWrite1h?: number;
  cacheRead?: number;
}

export interface GenericToolInit {
  name: string;
  id?: string;
}

export interface GenericAssistantInit {
  text?: string;
  thinking?: string;
  tools?: GenericToolInit[];
  stop?: 'tool_use' | 'end_turn' | 'stop_sequence';
  usage?: GenericUsageInit;
  model?: string;
}

export interface GenericBuilderInit {
  session?: string;
  slug?: string;
  cwd?: string;
  gitBranch?: string;
  model?: string;
  startTs?: number;
  stepMs?: number;
  isSidechain?: boolean;
  agentId?: string;
}

export class GenericTranscriptBuilder {
  private records: Record<string, unknown>[] = [];
  private t: number;
  private toolIdCounter = 0;
  readonly session: string;
  readonly model: string;
  private readonly slug: string;
  private readonly cwd: string;
  private readonly gitBranch: string;
  private readonly stepMs: number;
  private readonly isSidechain: boolean;
  private readonly agentId?: string;

  constructor(init: GenericBuilderInit = {}) {
    this.session = init.session ?? 'generic-session';
    this.slug = init.slug ?? 'generic-run';
    this.cwd = init.cwd ?? '/Users/dev/projects/generic-demo';
    this.gitBranch = init.gitBranch ?? 'main';
    this.model = init.model ?? 'gpt-x-pro';
    this.t = init.startTs ?? Date.parse('2026-06-16T10:00:00.000Z');
    this.stepMs = init.stepMs ?? 1000;
    this.isSidechain = init.isSidechain ?? false;
    if (init.agentId !== undefined) this.agentId = init.agentId;
  }

  get clock(): number {
    return this.t;
  }

  private stamp(deltaMs?: number): string {
    this.t += deltaMs ?? this.stepMs;
    return new Date(this.t).toISOString();
  }

  private envelope(extra?: number): Record<string, unknown> {
    return {
      ts: this.stamp(extra),
      session: this.session,
      slug: this.slug,
      cwd: this.cwd,
      gitBranch: this.gitBranch,
      isSidechain: this.isSidechain,
      ...(this.agentId !== undefined ? { agentId: this.agentId } : {}),
    };
  }

  prompt(text: string, deltaMs?: number): this {
    this.records.push({ ...this.envelope(deltaMs), kind: 'prompt', text });
    return this;
  }

  assistant(init: GenericAssistantInit = {}, deltaMs?: number): this {
    const tools = (init.tools ?? []).map((tool) => {
      this.toolIdCounter += 1;
      return { id: tool.id ?? `tool_${this.toolIdCounter}`, name: tool.name };
    });
    const stop = init.stop ?? (tools.length > 0 ? 'tool_use' : 'end_turn');
    this.records.push({
      ...this.envelope(deltaMs),
      kind: 'assistant',
      model: init.model ?? this.model,
      stop,
      ...(init.text !== undefined ? { text: init.text } : {}),
      ...(init.thinking !== undefined ? { thinking: init.thinking } : {}),
      ...(tools.length > 0 ? { tools } : {}),
      ...(init.usage ? { usage: { ...init.usage } } : {}),
    });
    return this;
  }

  lastToolId(): string {
    return `tool_${this.toolIdCounter}`;
  }

  toolResult(init: { toolUseId?: string; error?: boolean } = {}, deltaMs?: number): this {
    this.records.push({
      ...this.envelope(deltaMs),
      kind: 'tool_result',
      toolUseId: init.toolUseId ?? this.lastToolId(),
      error: init.error ?? false,
    });
    return this;
  }

  turnDuration(durationMs: number, messageCount = 1, deltaMs?: number): this {
    this.records.push({ ...this.envelope(deltaMs), kind: 'turn_duration', durationMs, messageCount });
    return this;
  }

  system(subtype: string, extra: Record<string, unknown> = {}, deltaMs?: number): this {
    this.records.push({ ...this.envelope(deltaMs), kind: 'system', subtype, ...extra });
    return this;
  }

  raw(obj: Record<string, unknown>): this {
    this.records.push(obj);
    return this;
  }

  build(): string {
    return this.records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  }

  get length(): number {
    return this.records.length;
  }
}
