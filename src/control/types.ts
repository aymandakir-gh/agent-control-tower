/**
 * Management-action types (PRD §15).
 *
 * Control acts on agent **processes / terminals** — never on files under the
 * scanned root. Actions are reversible (SIGSTOP/SIGCONT pause/resume, terminal
 * focus), disabled by default, and gated by a pure safety policy.
 */

/** The reversible actions we support. No destructive kill. */
export type ControlAction = 'focus' | 'pause' | 'resume';

export const CONTROL_ACTIONS: readonly ControlAction[] = ['focus', 'pause', 'resume'];

/** What we know about the process behind a session. */
export interface ControlTarget {
  sessionId: string;
  /** Working directory of the agent's session (used to locate/identify it). */
  cwd?: string;
  /** Resolved OS process id, if a unique one was found. */
  pid?: number;
  /** Short label for messages. */
  label?: string;
}

/** Safety policy evaluated before any action runs. */
export interface ControlPolicy {
  /** Master opt-in. When false, every action is refused. */
  allow: boolean;
  /** PIDs that must never be signaled (self, parent, init, …). */
  protectedPids?: readonly number[];
}

/** Outcome of an attempted (or refused) action. */
export interface ControlResult {
  ok: boolean;
  action: ControlAction;
  sessionId: string;
  /** Human-readable explanation of why it acted or refused. */
  reason: string;
  pid?: number;
}

/** The injectable seam the frontends depend on. */
export interface Controller {
  run(target: ControlTarget, action: ControlAction): Promise<ControlResult>;
}

/** Resolves a session → a unique pid (best-effort, read-only). */
export interface ProcessLocator {
  locate(target: ControlTarget): Promise<number | undefined>;
}
