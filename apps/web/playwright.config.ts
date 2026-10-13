import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests drive the real app (API + web) against a dedicated database, wewin_erp_e2e,
 * which global setup migrates and seeds on every run. Ports 4100 / 5174 avoid clashing with `pnpm dev`.
 */
const root = path.resolve(import.meta.dirname, '../..');
export const E2E_DB = process.env.E2E_DATABASE_URL ?? 'postgresql://wewin:wewin@localhost:5432/wewin_erp_e2e';
export const E2E_OWNER_PASSWORD = 'E2E-owner-pass-2026';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1366, height: 860 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 } } }],
  webServer: [
    {
      // Prepare wewin_erp_e2e (create if missing, migrate, idempotent seed), then start the API.
      command:
        'pnpm --filter @wewin/db exec tsx scripts/ensure-db.ts && pnpm --filter @wewin/db exec prisma migrate deploy && pnpm --filter @wewin/db exec tsx prisma/seed.ts && pnpm --filter @wewin/api exec tsx src/main.ts',
      cwd: root,
      url: 'http://localhost:4100/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: E2E_DB,
        SEED_OWNER_PASSWORD: E2E_OWNER_PASSWORD,
        SEED_DEMO: 'true',
        PORT: '4100',
        JWT_SECRET: 'e2e-only-secret-not-used-anywhere-else-0123456789',
        CORS_ORIGIN: 'http://localhost:5174',
        TZ: 'Asia/Kolkata',
        FY_START_MONTH: '4',
        NODE_ENV: 'test',
        JOBS_ENABLED: 'false',
        AUTH_RATE_LIMIT: '1000',
      },
    },
    {
      command: 'pnpm --filter @wewin/web exec vite',
      cwd: root,
      url: 'http://localhost:5174',
      reuseExistingServer: false,
      timeout: 120_000,
      env: { API_PROXY_TARGET: 'http://localhost:4100', WEB_PORT: '5174' },
    },
  ],
});
