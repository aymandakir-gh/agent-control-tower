/**
 * Source adapters (PRD §12): plug a concrete on-disk transcript dialect into the
 * normalized core model. Each adapter contributes a pure `parse(text)` (the
 * conformance contract) plus read-only discovery/read I/O. Downstream — the FSM,
 * cost estimator and timeline — operates on the normalized result, identically
 * for every source.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  basename,
  parseGenericTranscript,
  parseTranscript,
  type ParsedTranscript,
} from '../core/index.js';
import { findSessionFiles, readFileText, type SessionFileRef } from './fs.js';

export interface SourceAdapter {
  /** Stable id used by the `--source` flag and the API. */
  readonly id: string;
  /** Human-readable name for help text / dashboards. */
  readonly displayName: string;
  /** File extension this source's transcripts use. */
  readonly extension: string;
  /** Default filesystem root for this source. */
  defaultRoot(): string;
  /** Recursively discover session files under `root` (read-only I/O). */
  discover(root: string): Promise<SessionFileRef[]>;
  /** Read + parse one discovered session (read-only I/O). */
  read(ref: SessionFileRef): Promise<ParsedTranscript>;
  /** PURE: normalize raw transcript text → ParsedTranscript. */
  parse(text: string): ParsedTranscript;
}

/**
 * Shared read: load file text, parse with the adapter's pure parser, and
 * backfill a missing sessionId from the filename using a separator-agnostic
 * basename (correct on Windows paths too).
 */
async function readWith(ref: SessionFileRef, parse: (t: string) => ParsedTranscript): Promise<ParsedTranscript> {
  const text = await readFileText(ref.path);
  const parsed = parse(text);
  if (!parsed.sessionId) {
    const name = basename(ref.path).replace(/\.[^.]+$/, '');
    return { ...parsed, sessionId: name };
  }
  return parsed;
}

/** Reference adapter for Claude Code transcripts (`~/.claude/projects/**`). */
export const claudeCodeAdapter: SourceAdapter = {
  id: 'claude-code',
  displayName: 'Claude Code',
  extension: '.jsonl',
  defaultRoot: () => join(homedir(), '.claude', 'projects'),
  discover: (root) => findSessionFiles(root, '.jsonl'),
  read: (ref) => readWith(ref, parseTranscript),
  parse: parseTranscript,
};

/** Framework-neutral generic JSONL/hook adapter (PRD §12). */
export const genericJsonlAdapter: SourceAdapter = {
  id: 'generic-jsonl',
  displayName: 'Generic JSONL / hook',
  extension: '.jsonl',
  defaultRoot: () => join(homedir(), '.agent-control-tower', 'sessions'),
  discover: (root) => findSessionFiles(root, '.jsonl'),
  read: (ref) => readWith(ref, parseGenericTranscript),
  parse: parseGenericTranscript,
};

/** All registered adapters, keyed by id. */
export const ADAPTERS: Record<string, SourceAdapter> = {
  [claudeCodeAdapter.id]: claudeCodeAdapter,
  [genericJsonlAdapter.id]: genericJsonlAdapter,
};

export const DEFAULT_SOURCE_ID = claudeCodeAdapter.id;

/** All known source ids (for help text / validation). */
export function listSourceIds(): string[] {
  return Object.keys(ADAPTERS);
}

/** Resolve an adapter by id; defaults to Claude Code for unknown/empty ids. */
export function getAdapter(id?: string): SourceAdapter {
  if (id && id in ADAPTERS) return ADAPTERS[id];
  return claudeCodeAdapter;
}

/** True iff `id` names a registered adapter. */
export function isKnownSource(id: string): boolean {
  return id in ADAPTERS;
}
