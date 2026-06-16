/** Mount the Ink TUI. Thin wrapper so the CLI doesn't import React directly. */

import { render } from 'ink';
import type { LoadOptions } from '../sources/index.js';
import { App } from './App.js';

export interface RenderTuiOptions extends LoadOptions {
  root?: string;
  /** Enable real management actions (focus/pause/resume). */
  allowControl?: boolean;
}

export async function renderTui(options: RenderTuiOptions): Promise<void> {
  const instance = render(<App options={options} allowControl={options.allowControl ?? false} />);
  await instance.waitUntilExit();
}
