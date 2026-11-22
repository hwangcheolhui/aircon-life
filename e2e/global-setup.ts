import { rmSync } from 'node:fs';
import postgres from 'postgres';
import { createDb, seedBaseData } from '../packages/db/src/index';
import { runMigrations } from '../packages/db/scripts/migrate';
import { createAuthAdapter } from '../packages/integrations/src/index';
import { E2E_ENV } from '../playwright.config';

export default async function globalSetup() {
  const url = E2E_ENV.DATABASE_URL;
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS auth CASCADE; CREATE SCHEMA public;');
  await sql.end();
  await runMigrations(url);
  rmSync(E2E_ENV.MOCK_AUTH_FILE, { force: true });
  const env = { ...process.env, ...E2E_ENV };
  const { db, sql: s } = createDb(url, { max: 1 });
  await seedBaseData(db, {
    loginId: E2E_ENV.SEED_SUPER_ADMIN_LOGIN_ID,
    email: 'superadmin@example.invalid',
    name: '슈퍼관리자',
    createAuthUser: () => createAuthAdapter({ getAll: () => [], setAll: () => undefined }, env).createUser('superadmin@example.invalid', E2E_ENV.SEED_SUPER_ADMIN_PASSWORD),
  });
  await s.end();
}
