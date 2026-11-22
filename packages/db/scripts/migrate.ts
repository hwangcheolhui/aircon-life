/**
 * 마이그레이션 실행. Supabase에서는 auth 스키마가 이미 있으므로 shim을 건너뛴다.
 * 사용: DATABASE_URL=... pnpm db:migrate
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

export async function runMigrations(url: string) {
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    const rows = await sql<{ exists: boolean }[]>`SELECT to_regnamespace('auth') IS NOT NULL AS exists`;
    const exists = rows[0]?.exists ?? false;
    if (!exists) {
      await sql.unsafe(readFileSync(join(__dirname, '../sql/local-auth-shim.sql'), 'utf8'));
    }
    await migrate(drizzle(sql), { migrationsFolder: join(__dirname, '../drizzle') });
  } finally {
    await sql.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL이 필요합니다.');
  runMigrations(url)
    .then(() => console.log('migrated'))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
