/**
 * Tiny pure helpers. Core avoids Node built-ins so it stays portable and
 * trivially testable.
 */

/** Last path segment of a POSIX or Windows path, ignoring trailing slashes. */
export function basename(p: string): string {
  const cleaned = p.replace(/[/\\]+$/, '');
  const idx = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'));
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

/** Clamp a number into [min, max]. */
export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
