/**
 * E2E: 04 구현계획 단계별 "완료 기준" 시나리오 (e2e/).
 * 로컬 PostgreSQL(E2E_DATABASE_URL)을 초기화하고 Mock 인증으로 실행한다.
 *   E2E_DATABASE_URL=postgres://aircon:aircon@localhost:5432/aircon_e2e pnpm e2e
 * E2E_SERVER=start 이면 dev 대신 빌드 결과(next start)로 띄운다. CI는 이 방식을 쓴다:
 * 전체 46건+을 dev 서버로 돌리면 화면 첫 컴파일이 느리고, 메모리 한도에 닿은 dev 서버가 스스로 재시작해 진행 중 테스트가 끊긴다.
 * 이때 빌드는 NEXT_PUBLIC_ADDRESS_DRIVER=mock 으로 해야 한다(브라우저 코드에 빌드 때 박힌다).
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
  NEXT_PUBLIC_ADDRESS_DRIVER: 'mock',
  CRON_SECRET: 'e2e-cron-secret',
};

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  // dev 서버는 화면을 처음 열 때 컴파일하므로 CI에서 5초(기본값)를 넘길 수 있다
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: `http://localhost:${port}`, viewport: { width: 1440, height: 900 }, trace: 'off' },
  webServer: {
    command: `pnpm --filter @aircon/web exec next ${process.env.E2E_SERVER === 'start' ? 'start' : 'dev'} -p ${port}`,
    port,
    timeout: 120_000,
    reuseExistingServer: false,
    env: E2E_ENV,
  },
});
