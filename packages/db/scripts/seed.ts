/**
 * 사용: DATABASE_URL=... SEED_SUPER_ADMIN_PASSWORD=... pnpm db:seed
 * 슈퍼관리자 인증 계정은 AUTH_DRIVER(mock|supabase)에 맞는 어댑터로 만든다.
 */
import { createAuthAdapter } from '@aircon/integrations';
import { createDb } from '../src/client';
import { seedBaseData } from '../src/seed';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL이 필요합니다.');
  const { db, sql } = createDb(url, { max: 1 });
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD;
  const loginId = process.env.SEED_SUPER_ADMIN_LOGIN_ID ?? 'superadmin';
  const email = process.env.SEED_SUPER_ADMIN_EMAIL ?? `${loginId}@example.invalid`;
  const noCookies = { getAll: () => [], setAll: () => undefined };
  try {
    await seedBaseData(
      db,
      password
        ? { loginId, email, name: '슈퍼관리자', createAuthUser: () => createAuthAdapter(noCookies).createUser(email, password) }
        : undefined,
    );
    console.log(password ? 'seeded (슈퍼관리자 포함)' : 'seeded (SEED_SUPER_ADMIN_PASSWORD 없음: 슈퍼관리자 생략)');
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
