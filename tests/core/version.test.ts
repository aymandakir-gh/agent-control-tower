import { describe, expect, it } from 'vitest';
import { PRODUCT_NAME, VERSION } from '../../src/core/version.js';

describe('version', () => {
  it('exposes a semver-ish version string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('exposes the product name', () => {
    expect(PRODUCT_NAME).toBe('agent-control-tower');
  });
});
