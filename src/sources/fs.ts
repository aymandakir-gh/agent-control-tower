/**
 * Low-level, STRICTLY READ-ONLY filesystem helpers for the source layer.
 *
 * This is the only place that walks directories and opens files, and it does so
 * with readers only — it never writes, moves, or deletes anything under the
 * scanned root (PRD §4 non-goals, §11). Kept separate from the adapter/loader
 * code so the file-discovery primitive can be shared without import cycles.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

export interface SessionFileRef {
  path: string;
  sessionId: string;
  projectDir: string;
  mtimeMs: number;
  size: number;
}

/**
 * Recursively find transcript files under `root` (read-only). Defaults to
 * `.jsonl`; adapters that use a different extension can override `ext`.
 * Unreadable dirs/files (permissions, races) are skipped, never fatal.
 */
export async function findSessionFiles(root: string, ext = '.jsonl'): Promise<SessionFileRef[]> {
  const out: SessionFileRef[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (!entries) return;
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && extname(entry.name) === ext) {
        try {
          const s = await stat(full);
          out.push({
            path: full,
            sessionId: entry.name.slice(0, -ext.length),
            projectDir: dir,
            mtimeMs: s.mtimeMs,
            size: s.size,
          });
        } catch {
          // file vanished between readdir and stat — skip
        }
      }
    }
  }

  await walk(root);
  return out;
}

/** Read a file as UTF-8 text (read-only). */
export function readFileText(path: string): Promise<string> {
  return readFile(path, 'utf8');
}
