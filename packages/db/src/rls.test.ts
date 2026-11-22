/**
 * RLS·INSERT ONLY 가드 통합 테스트 (실제 PostgreSQL 필요: TEST_DATABASE_URL).
 * 서버 코드의 권한 검사와 별개로, 브라우저 키(anon/authenticated)로 직접 접근해도 막히는지 확인한다.
 */
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../scripts/migrate';
import { createDb } from './client';
import { seedBaseData } from './seed';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('RLS (BR-102, F-ADM-SYS-02)', () => {
  const sql = postgres(url ?? '', { max: 1, onnotice: () => undefined });
  const ids = { super: randomUUID(), cs: randomUUID(), branchMgr: randomUUID() };
  let b1 = 0;
  let b2 = 0;

  /** 인증 사용자로 실행 (Supabase의 authenticated 역할 + auth.uid()) */
  async function as<T>(uid: string | null, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return (await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE ${uid ? 'authenticated' : 'anon'}`);
      if (uid) await tx`SELECT set_config('request.jwt.claim.sub', ${uid}, true)`;
      return fn(tx);
    })) as T;
  }

  beforeAll(async () => {
    await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS auth CASCADE; CREATE SCHEMA public;');
    await runMigrations(url!);
    const { db, sql: s } = createDb(url!, { max: 1 });
    await seedBaseData(db);
    await s.end();
    const newBranch = async (c: string) =>
      Number(((await sql`INSERT INTO branch (branch_code, name, status) VALUES (${c}, ${c}, 'ACTIVE') RETURNING id`)[0] as { id: string }).id);
    b1 = await newBranch('T01');
    b2 = await newBranch('T02');
    const roleId = async (c: string) => ((await sql`SELECT id FROM role WHERE role_code = ${c}`)[0] as { id: number }).id;
    await sql`INSERT INTO admin_user (auth_user_id, login_id, name, email, role_id, branch_id, status) VALUES
      (${ids.super}, 'sup', '슈퍼', 'sup@example.invalid', ${await roleId('ADM_SUPER')}, NULL, 'ACTIVE'),
      (${ids.cs}, 'cs', '상담', 'cs@example.invalid', ${await roleId('ADM_CS')}, NULL, 'ACTIVE'),
      (${ids.branchMgr}, 'bm', '거점장', 'bm@example.invalid', ${await roleId('ADM_BRANCH')}, ${b1}, 'ACTIVE')`;
    await sql`INSERT INTO service_area (branch_id, sido, sigungu, eupmyeondong) VALUES
      (${b1}, '서울', '은평구', '불광동'), (${b2}, '인천', '부평구', '부평동')`;
  });
  afterAll(async () => {
    await sql.end();
  });

  it('비로그인(anon)은 기준 데이터를 읽을 수 없다', async () => {
    const rows = await as(null, (tx) => tx`SELECT * FROM branch`);
    expect(rows).toHaveLength(0);
  });

  it('상담원은 거점을 등록할 수 없다 (A-SYS-030 CREATE 없음)', async () => {
    await expect(as(ids.cs, (tx) => tx`INSERT INTO branch (branch_code, name, status) VALUES ('X1','x','ACTIVE')`)).rejects.toThrow(
      /row-level security/,
    );
  });

  it('슈퍼관리자는 거점을 등록할 수 있다', async () => {
    const rows = await as(ids.super, (tx) => tx`INSERT INTO branch (branch_code, name, status) VALUES ('X2','x','ACTIVE') RETURNING id`);
    expect(rows).toHaveLength(1);
  });

  it('BR-102 거점장은 자기 거점의 관할 지역만 조회한다', async () => {
    const rows = await as(ids.branchMgr, (tx) => tx`SELECT branch_id FROM service_area`);
    expect(rows.map((r) => Number(r.branch_id))).toEqual([Number(b1)]);
  });

  it('BR-102 예외: 거점장은 다른 거점에 관할 지역을 등록할 수 없다', async () => {
    await expect(
      as(ids.branchMgr, (tx) => tx`INSERT INTO service_area (branch_id, sido, sigungu, eupmyeondong) VALUES (${b2}, '인천', '부평구', '십정동')`),
    ).rejects.toThrow(/row-level security/);
  });

  it('상담원은 관할 지역 메뉴 권한이 없어 조회 결과가 비어 있다', async () => {
    expect(await as(ids.cs, (tx) => tx`SELECT * FROM service_area`)).toHaveLength(0);
  });

  it('감사 로그는 INSERT ONLY: 수정·삭제가 막힌다', async () => {
    await sql`INSERT INTO audit_log (actor_type, action) VALUES ('ADMIN', 'LOGIN')`;
    await expect(sql`UPDATE audit_log SET action = 'X'`).rejects.toThrow(/INSERT ONLY/);
    await expect(sql`DELETE FROM audit_log`).rejects.toThrow(/INSERT ONLY/);
  });

  it('시드는 여러 번 실행해도 안전하다', async () => {
    const { db, sql: s } = createDb(url!, { max: 1 });
    await seedBaseData(db);
    await s.end();
    const [r] = await sql`SELECT count(*)::int AS c FROM common_code WHERE group_code = 'DEVICE_TYPE'`;
    expect(r?.c).toBe(7);
  });
});
