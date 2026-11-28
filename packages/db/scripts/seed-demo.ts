/**
 * 테스트용 가상 데이터 넣기 (docs/07_테스트데이터.md).
 * 사용: DATABASE_URL=... PII_ENCRYPTION_KEY=... PII_HASH_PEPPER=... SEED_DEMO_PASSWORD=... pnpm db:seed:demo
 * - 기본 데이터(pnpm db:seed)가 먼저 들어가 있어야 한다.
 * - PII_ENCRYPTION_KEY·PII_HASH_PEPPER 는 앱(Vercel)과 같은 값이어야 화면에서 이름·연락처가 보이고 휴대폰 번호로 로그인된다.
 * - 테스트 관리자·기사 비밀번호 = SEED_DEMO_PASSWORD (없으면 SEED_SUPER_ADMIN_PASSWORD). 코드에 비밀번호를 두지 않는다.
 * - 관리자 인증 계정은 AUTH_DRIVER(mock|supabase)에 맞는 어댑터로, 예시 이미지는 STORAGE_DRIVER 저장소로 올린다.
 */
import { createAuthAdapter, createStorageAdapter } from '@aircon/integrations';
import { createDb } from '../src/client';
import { seedDemoData } from '../src/seed-demo';

function required(name: string, value: string | undefined): string {
  if (!value?.trim()) throw new Error(`${name} 이(가) 필요합니다. (docs/07_테스트데이터.md 참고)`);
  return value.trim();
}

async function main() {
  const url = required('DATABASE_URL', process.env.DATABASE_URL);
  const piiKey = required('PII_ENCRYPTION_KEY', process.env.PII_ENCRYPTION_KEY);
  if (Buffer.from(piiKey, 'base64').length !== 32) throw new Error('PII_ENCRYPTION_KEY는 32바이트 base64 값이어야 합니다.');
  const pepper = required('PII_HASH_PEPPER', process.env.PII_HASH_PEPPER);
  const password = required('SEED_DEMO_PASSWORD(또는 SEED_SUPER_ADMIN_PASSWORD)', process.env.SEED_DEMO_PASSWORD || process.env.SEED_SUPER_ADMIN_PASSWORD);
  if (password.length < 8) throw new Error('테스트 계정 비밀번호는 8자 이상이어야 합니다.');

  const noCookies = { getAll: () => [], setAll: () => undefined };
  const storage = (() => {
    try {
      return createStorageAdapter();
    } catch (e) {
      console.warn(`예시 이미지 저장소를 쓸 수 없어 이미지 없이 진행합니다: ${(e as Error).message}`);
      return null;
    }
  })();

  const { db, sql } = createDb(url, { max: 1 });
  try {
    const r = await seedDemoData(db, {
      piiKey,
      pepper,
      password,
      createAuthUser: (email, pw) => createAuthAdapter(noCookies).createUser(email, pw),
      putFile: storage ? (key, body, mime) => storage.put(key, body, mime) : undefined,
      log: (m) => console.log(m),
    });
    console.log(
      `테스트 데이터 완료: 관리자 +${r.admins}, 기사 +${r.technicians}, 고객 +${r.customers}, 주문 +${r.orders}` +
        ` (지난 이력 ${r.historyInserted ? '넣음' : '이미 있음'}, 오늘 일정 ${r.todayInserted ? '넣음' : '이미 있음'})`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
