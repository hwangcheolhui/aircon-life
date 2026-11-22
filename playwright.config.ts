/**
 * E2E: 04 구현계획 단계별 "완료 기준" 시나리오 (e2e/).
 * 로컬 PostgreSQL(E2E_DATABASE_URL)을 초기화하고 Mock 인증으로 실행한다.
 *   E2E_DATABASE_URL=postgres://aircon:aircon@localhost:5432/aircon_e2e pnpm e2e
 */
import { defineConfig } from '@playwright/test';

const port = 3100;
export const E2E_ENV = {
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgres://aircon:aircon@localhost:5432/aircon_e2e',
  AUTH_DRIVER: 'mock',
  SESSION_SECRET: 'e2e-session-secret-0123456789',
  MOCK_AUTH_FILE: `${__dirname}/test-results/.e2e/mock-auth.json`,
  PII_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  PII_HASH_PEPPER: 'e2e',
  STORAGE_DRIVER: 'mock',
  STORAGE_LOCAL_DIR: `${__dirname}/test-results/.e2e/files`,
  SEED_SUPER_ADMIN_LOGIN_ID: 'superadmin',
  SEED_SUPER_ADMIN_PASSWORD: 'E2e-super-1',
};

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: `http://localhost:${port}`, viewport: { width: 1440, height: 900 }, trace: 'off' },
  webServer: {
    command: `pnpm --filter @aircon/web exec next dev -p ${port}`,
    port,
    timeout: 120_000,
    reuseExistingServer: false,
    env: E2E_ENV,
  },
});
