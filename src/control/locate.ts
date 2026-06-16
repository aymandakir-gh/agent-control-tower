/**
 * Best-effort, READ-ONLY session → pid resolution (PRD §15).
 *
 * Enumerates processes with `ps` and (when a cwd is known) narrows by working
 * directory via `lsof`. Returns a pid only when exactly one candidate matches —
 * ambiguity resolves to `undefined`, and the safety policy then refuses. These
 * are read-only inspections; nothing is signaled here.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ControlTarget, ProcessLocator } from './types.js';

const exec = promisify(execFile);

export interface ProcInfo {
  pid: number;
  command: string;
  /** Working directory, if known. */
  cwd?: string;
}

/** Looks like an agent process we might control (Claude Code CLI / similar). */
function looksLikeAgent(command: string): boolean {
  if (/agent-control-tower/i.test(command)) return false; // never target ourselves
  return /\bclaude\b/i.test(command);
}

/**
 * Pure: pick the unique pid for a target from process candidates.
 * Filters to agent-like processes, then narrows by cwd when known. Returns a
 * pid only if exactly one candidate remains.
 */
export function matchProcess(candidates: ProcInfo[], target: ControlTarget): number | undefined {
  let pool = candidates.filter((c) => looksLikeAgent(c.command));
  if (target.cwd !== undefined) {
    const byCwd = pool.filter((c) => c.cwd !== undefined && c.cwd === target.cwd);
    // Only narrow when at least one has a known, matching cwd; otherwise keep pool.
    if (byCwd.length > 0) pool = byCwd;
  }
  return pool.length === 1 ? pool[0].pid : undefined;
}

/** Parse `ps -axww -o pid=,command=` output into ProcInfo[]. Pure. */
export function parsePs(stdout: string): ProcInfo[] {
  const out: ProcInfo[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const m = /^(\d+)\s+(.*)$/.exec(trimmed);
    if (!m) continue;
    out.push({ pid: Number(m[1]), command: m[2] });
  }
  return out;
}

/** Real locator backed by `ps` + `lsof` (read-only). */
export class PsProcessLocator implements ProcessLocator {
  async locate(target: ControlTarget): Promise<number | undefined> {
    let candidates: ProcInfo[];
    try {
      const { stdout } = await exec('ps', ['-axww', '-o', 'pid=,command=']);
      candidates = parsePs(stdout);
    } catch {
      return undefined; // ps unavailable — cannot resolve
    }
    const agentish = candidates.filter((c) => /\bclaude\b/i.test(c.command));
    // Enrich with cwd (via lsof) only for the narrowed agent set, and only when
    // we have a target cwd to compare against (keeps it cheap + read-only).
    if (target.cwd !== undefined) {
      for (const c of agentish) {
        c.cwd = await this.cwdOf(c.pid);
      }
    }
    return matchProcess(agentish, target);
  }

  private async cwdOf(pid: number): Promise<string | undefined> {
    try {
      const { stdout } = await exec('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
      // -Fn output: lines like "n/path/to/cwd"; take the first n-line.
      for (const line of stdout.split('\n')) {
        if (line.startsWith('n')) return line.slice(1);
      }
    } catch {
      // lsof unavailable / permission — leave cwd unknown
    }
    return undefined;
  }
}

/** A locator that resolves nothing — the safe default when control is disabled. */
export class NullProcessLocator implements ProcessLocator {
  async locate(_target: ControlTarget): Promise<number | undefined> {
    return undefined;
  }
}
