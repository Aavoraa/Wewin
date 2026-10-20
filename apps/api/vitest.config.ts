import path from 'node:path';
import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

const root = path.resolve(import.meta.dirname, '../..');
config({ path: path.join(root, '.env'), quiet: true });
const testDb = process.env.TEST_DATABASE_URL ?? 'postgresql://wewin:wewin@localhost:5432/wewin_erp_test';
// Global setup runs in this process: point it at the test database too.
process.env.DATABASE_URL = testDb;

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // One shared test database: run files one at a time; tests inside a file may still use concurrency.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDb,
      JOBS_ENABLED: 'false',
      AUTH_RATE_LIMIT: '1000',
      TZ: 'Asia/Kolkata',
      // Scans in tests: private test storage, local extraction only (never calls an external AI service).
      STORAGE_DIR: path.join(root, 'storage', 'test'),
      SCAN_AI_PROVIDER: '',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/**/*.test.ts'],
      reporter: ['text-summary', 'html', 'json-summary'],
      // Ledger, numbering, matching and loss must stay ≥ 90 % covered (IMPLEMENTATION-PLAN).
      thresholds: {
        'src/core/ledger/**': { lines: 90, statements: 90, functions: 90 },
        'src/core/numbering/**': { lines: 90, statements: 90, functions: 90 },
        'src/**/*.match.ts': { lines: 90, statements: 90, functions: 90, branches: 90 },
        'src/**/*.loss.ts': { lines: 90, statements: 90, functions: 90, branches: 90 },
      },
    },
  },
});
