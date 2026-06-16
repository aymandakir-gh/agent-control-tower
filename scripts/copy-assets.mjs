// Copy non-TS web assets into dist after tsc (tsc only emits .js/.d.ts).
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'src', 'web', 'public');
const to = join(root, 'dist', 'web', 'public');

if (existsSync(from)) {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log(`Copied web assets → ${to}`);
} else {
  console.warn(`No web assets at ${from}`);
}
