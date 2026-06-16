import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICING, resolvePricing } from '../../src/core/pricing.js';

describe('resolvePricing', () => {
  it('matches a known model exactly', () => {
    const r = resolvePricing('claude-opus-4-8');
    expect(r.estimated).toBe(false);
    expect(r.pricing).toEqual(DEFAULT_PRICING['claude-opus-4-8']);
  });

  it('strips a [1m] context suffix to match', () => {
    const r = resolvePricing('claude-opus-4-8[1m]');
    expect(r.estimated).toBe(false);
    expect(r.pricing).toEqual(DEFAULT_PRICING['claude-opus-4-8']);
  });

  it('strips a trailing date stamp to match', () => {
    const r = resolvePricing('claude-haiku-4-5-20251001');
    expect(r.estimated).toBe(false);
    expect(r.pricing).toEqual(DEFAULT_PRICING['claude-haiku-4-5']);
  });

  it('falls back by family keyword and flags estimated', () => {
    const r = resolvePricing('claude-3-opus-something');
    expect(r.estimated).toBe(true);
    expect(r.pricing).toEqual(DEFAULT_PRICING['claude-opus-4-8']);
  });

  it('treats synthetic as zero-cost', () => {
    const r = resolvePricing('<synthetic>');
    expect(r.pricing.input).toBe(0);
  });

  it('uses the sonnet fallback tier for fully unknown models', () => {
    const r = resolvePricing('gpt-something');
    expect(r.estimated).toBe(true);
    expect(r.pricing).toEqual(DEFAULT_PRICING['claude-sonnet-4-6']);
  });

  it('honors a custom pricing table', () => {
    const custom = { 'my-model': { input: 1, output: 2, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 } };
    const r = resolvePricing('my-model', custom);
    expect(r.estimated).toBe(false);
    expect(r.pricing.output).toBe(2);
  });
});
