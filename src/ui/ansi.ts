/**
 * Minimal ANSI coloring for the non-interactive `scan` output. No dependency.
 * Respects an explicit enable flag (the CLI disables it for --no-color / NO_COLOR
 * / non-TTY).
 */

import type { AgentStatus } from '../core/index.js';

export const CODES = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const;

export type ColorName = keyof typeof CODES;

export function paint(enabled: boolean, color: ColorName, s: string): string {
  if (!enabled) return s;
  return `${CODES[color]}${s}${CODES.reset}`;
}

export const STATUS_COLOR: Record<AgentStatus, ColorName> = {
  working: 'green',
  waiting: 'yellow',
  error: 'red',
  idle: 'gray',
};
