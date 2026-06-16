import { describe, expect, it } from 'vitest';
import { PRODUCT_NAME, VERSION } from '../../src/core/version.js';
import pkg from '../../package.json' with { type: 'json' };

describe('version', () => {
  it('exposes a semver-ish version string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('exposes the product name', () => {
    expect(PRODUCT_NAME).toBe('agent-control-tower');
  });

  it('stays in sync with package.json (no release drift)', () => {
    expect(VERSION).toBe(pkg.version);
    expect(PRODUCT_NAME).toBe(pkg.name);
  });
});
