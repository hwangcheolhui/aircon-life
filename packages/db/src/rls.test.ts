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
import { bookSlots } from './slot-booking';

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
  it('F-CUS-QUO-04 견적은 서버만 접근한다: 브라우저 키(anon·관리자)로는 읽기·쓰기 불가', async () => {
    await sql`INSERT INTO quote (quote_no, channel, legal_dong_code, is_serviceable, subtotal_amount, total_amount, status)
      VALUES ('Q2703020001', 'APP', '1138010400', true, 90000, 90000, 'ISSUED')`;
    expect(await as(null, (tx) => tx`SELECT * FROM quote`)).toHaveLength(0);
    expect(await as(ids.super, (tx) => tx`SELECT * FROM quote`)).toHaveLength(0);
    await expect(
      as(
        null,
        (
          tx,
        ) => tx`INSERT INTO quote (quote_no, channel, legal_dong_code, is_serviceable, subtotal_amount, total_amount, status)
        VALUES ('Q2703020002', 'APP', '1138010400', true, 1, 1, 'ISSUED')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('F-CUS-QUO-04 현장 확인 견적 기준값이 시스템 설정에 있다', async () => {
    const [r] =
      await sql`SELECT setting_value FROM system_setting WHERE setting_key = 'QUOTE_SITE_SURVEY_MIN_UNITS'`;
    expect(r?.setting_value).toBe('4');
  });

  describe('단계 2 예약·주문', () => {
    let order1 = 0;
    beforeAll(async () => {
      const [c] = await sql`INSERT INTO customer (customer_no, customer_type, name, phone1, join_channel, privacy_agree_status, status)
        VALUES ('C2703000001', 'PERSONAL', 'enc', 'enc', 'APP', 'AGREED', 'ACTIVE') RETURNING id`;
      const [a] = await sql`INSERT INTO customer_address (customer_id, zipcode, road_address, branch_id)
        VALUES (${c!.id}, '00000', '예시로 1', ${b1}) RETURNING id`;
      const mk = async (no: string, branchId: number) =>
        Number(
          ((await sql`INSERT INTO service_order (order_no, customer_id, address_id, branch_id, channel, order_type, status, subtotal_amount, total_amount, payment_status)
            VALUES (${no}, ${c!.id}, ${a!.id}, ${branchId}, 'APP', 'NORMAL', 'RECEIVED', 90000, 90000, 'UNPAID') RETURNING id`)[0] as { id: string }).id,
        );
      order1 = await mk('2703021000A1', b1);
      await mk('2703021000A2', b2);
      await sql`INSERT INTO order_status_history (order_id, to_status, actor_type) VALUES (${order1}, 'RECEIVED', 'CUSTOMER')`;
      await sql`INSERT INTO consent_history (customer_id, consent_type, action, channel) VALUES (${c!.id}, 'TERMS', 'AGREE', 'APP')`;
      await sql`INSERT INTO payment (payment_no, order_id, customer_id, payment_stage, method, amount, status)
        VALUES ('P27030200000001', ${order1}, ${c!.id}, 'PREPAY', 'CARD', 90000, 'APPROVED')`;
    });

    it('BR-100 비로그인(anon)은 고객·주문을 읽을 수 없다', async () => {
      expect(await as(null, (tx) => tx`SELECT * FROM customer`)).toHaveLength(0);
      expect(await as(null, (tx) => tx`SELECT * FROM service_order`)).toHaveLength(0);
    });

    it('BR-102 거점장은 자기 거점 주문만 조회한다', async () => {
      const rows = await as(ids.branchMgr, (tx) => tx`SELECT branch_id FROM service_order`);
      expect(rows.map((r) => Number(r.branch_id))).toEqual([Number(b1)]);
    });

    it('F-ADM-ORD-01 상담원은 주문 목록을 조회할 수 있다(전체 거점)', async () => {
      expect(await as(ids.cs, (tx) => tx`SELECT * FROM service_order`)).toHaveLength(2);
    });

    it('주문 상태 이력·동의 이력·결제는 INSERT ONLY', async () => {
      await expect(sql`UPDATE order_status_history SET memo = 'x'`).rejects.toThrow(/INSERT ONLY/);
      await expect(sql`DELETE FROM consent_history`).rejects.toThrow(/INSERT ONLY/);
      await expect(sql`UPDATE payment SET amount = 1`).rejects.toThrow(/INSERT ONLY/);
    });

    it('BR-021 동시에 마지막 1자리를 예약하면 한 건만 성공한다', async () => {
      await sql`INSERT INTO time_slot (branch_id, slot_date, slot_hour, slot_kind, capacity, booked_count)
        VALUES (${b1}, '2027-03-10', 10, 'NORMAL', 2, 1), (${b1}, '2027-03-10', 11, 'NORMAL', 1, 0)`;
      const tryBook = () => {
        const { db, sql: s } = createDb(url!, { max: 1 });
        return db
          .transaction(async (tx) => {
            const ok = await bookSlots(tx, { branchId: b1, slotDate: '2027-03-10', hours: [10] });
            if (!ok) tx.rollback();
            return ok;
          })
          .catch(() => false)
          .finally(() => s.end());
      };
      const results = await Promise.all([tryBook(), tryBook(), tryBook()]);
      expect(results.filter(Boolean)).toHaveLength(1);
      const [r] = await sql`SELECT booked_count FROM time_slot WHERE branch_id = ${b1} AND slot_hour = 10`;
      expect(r?.booked_count).toBe(2);
    });

    it('BR-021 예외: 연속 슬롯 중 한 칸이라도 차 있으면 예약 실패', async () => {
      await sql`UPDATE time_slot SET booked_count = 0 WHERE branch_id = ${b1} AND slot_hour = 10`;
      await sql`UPDATE time_slot SET is_closed = true WHERE branch_id = ${b1} AND slot_hour = 11`;
      const { db, sql: s } = createDb(url!, { max: 1 });
      const ok = await db
        .transaction(async (tx) => {
          const r = await bookSlots(tx, { branchId: b1, slotDate: '2027-03-10', hours: [10, 11] });
          if (!r) tx.rollback();
          return r;
        })
        .catch(() => false);
      await s.end();
      expect(ok).toBe(false);
      const [r] = await sql`SELECT booked_count FROM time_slot WHERE branch_id = ${b1} AND slot_hour = 10`;
      expect(r?.booked_count).toBe(0);
    });
  });
});
