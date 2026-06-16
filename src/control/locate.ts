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

/** First tokens that mean "a viewer/editor opening a claude-named file", not an agent. */
const VIEWERS = /^(vim|nvim|vi|emacs|nano|less|more|tail|cat|head|grep|rg|ssh|man|bat|code|git)$/i;

/**
 * Looks like an agent process we might control (Claude Code CLI / similar).
 * Deliberately conservative: excludes ourselves, the Claude **desktop** app, and
 * editors/pagers that merely happen to have "claude" in their arguments — better
 * to refuse than to signal the wrong process.
 */
export function looksLikeAgent(command: string): boolean {
  if (/agent-control-tower/i.test(command)) return false; // never target ourselves
  if (/Claude\.app/i.test(command)) return false; // the desktop app, not the CLI
  const exe = (command.trim().split(/\s+/)[0] ?? '').replace(/.*[/\\]/, '');
  if (VIEWERS.test(exe)) return false; // e.g. `vim claude-notes.md`, `tail -f claude.log`
  return /\bclaude\b/i.test(command);
}

/**
 * Pure: pick the unique pid for a target from process candidates.
 * Filters to agent-like processes; when a cwd is known it is a REQUIRED
 * disambiguator (never falls back to an unrelated process). Returns a pid only
 * if exactly one candidate remains — ambiguity/no-match resolves to undefined.
 */
export function matchProcess(candidates: ProcInfo[], target: ControlTarget): number | undefined {
  let pool = candidates.filter((c) => looksLikeAgent(c.command));
  if (target.cwd !== undefined) {
    // cwd must match: do not signal a process that isn't demonstrably this session's.
    pool = pool.filter((c) => c.cwd !== undefined && c.cwd === target.cwd);
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
    const agentish = candidates.filter((c) => looksLikeAgent(c.command));
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
