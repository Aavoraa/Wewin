import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      reporter: ['text-summary', 'json-summary'],
      // Business maths must stay ≥ 90 % covered (IMPLEMENTATION-PLAN testing requirements).
      thresholds: {
        'src/loss.ts': { lines: 90, statements: 90, functions: 90, branches: 90 },
        'src/accounts.ts': { lines: 90, statements: 90, branches: 90 },
        'src/export.ts': { lines: 90, statements: 90, branches: 90 },
      },
    },
  },
});
