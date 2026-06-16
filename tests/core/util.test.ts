import { describe, expect, it } from 'vitest';
import { basename, clamp } from '../../src/core/util.js';

describe('basename', () => {
  it('returns the last POSIX segment', () => {
    expect(basename('/Users/dev/projects/api')).toBe('api');
  });
  it('handles trailing slashes', () => {
    expect(basename('/Users/dev/projects/api/')).toBe('api');
  });
  it('handles Windows separators', () => {
    expect(basename('C:\\Users\\dev\\repo')).toBe('repo');
  });
  it('returns the input when there is no separator', () => {
    expect(basename('repo')).toBe('repo');
  });
});

describe('clamp', () => {
  it('clamps into range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});
