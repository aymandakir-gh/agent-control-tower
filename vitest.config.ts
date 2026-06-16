import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/core/**/*.ts'],
      exclude: ['src/core/**/*.test.ts', 'src/core/index.ts'],
      thresholds: {
        // Core is pure and must be exhaustively tested (PRD §3, §9 M1 DoD).
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
