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

  describe('단계 3 상담 콘솔', () => {
    let cust1 = 0;
    beforeAll(async () => {
      const mk = async (no: string, branchId: number) => {
        const [c] = await sql`INSERT INTO customer (customer_no, customer_type, name, phone1, join_channel, privacy_agree_status, status)
          VALUES (${no}, 'PERSONAL', 'enc', 'enc', 'PHONE', 'NOT_ASKED', 'ACTIVE') RETURNING id`;
        await sql`INSERT INTO customer_address (customer_id, zipcode, road_address, branch_id) VALUES (${c!.id}, '00000', '상담로 1', ${branchId})`;
        await sql`INSERT INTO consultation (consult_no, customer_id, channel, consult_type, status) VALUES (${'J' + no.slice(1)}, ${c!.id}, 'PHONE', 'INQUIRY', 'OPEN')`;
        return Number(c!.id);
      };
      cust1 = await mk('C2703100001', b1);
      await mk('C2703100002', b2);
    });

    it('BR-102 거점장은 자기 거점 고객·상담만 조회한다 (A-CUS-010·A-CSL-070)', async () => {
      const customers = await as(ids.branchMgr, (tx) => tx`SELECT id FROM customer WHERE customer_no LIKE 'C27031%'`);
      expect(customers.map((r) => Number(r.id))).toEqual([cust1]);
      const consults = await as(ids.branchMgr, (tx) => tx`SELECT customer_id FROM consultation`);
      expect(consults.map((r) => Number(r.customer_id))).toEqual([cust1]);
    });

    it('F-ADM-CUS-01 상담원은 전체 거점 고객을 조회한다', async () => {
      expect(await as(ids.cs, (tx) => tx`SELECT id FROM customer WHERE customer_no LIKE 'C27031%'`)).toHaveLength(2);
    });

    it('F-ADM-CSL-16 상담원은 상담 스크립트를 읽을 수 있지만 고칠 수 없다 (A-CNT-050 W 없음)', async () => {
      expect((await as(ids.cs, (tx) => tx`SELECT script_code FROM consult_script`)).length).toBeGreaterThan(0);
      const updated = await as(ids.cs, (tx) => tx`UPDATE consult_script SET title = 'x' RETURNING id`);
      expect(updated).toHaveLength(0);
    });

    it('BR-100 비로그인(anon)은 통화·상담 기록을 읽을 수 없다', async () => {
      expect(await as(null, (tx) => tx`SELECT * FROM consultation`)).toHaveLength(0);
      expect(await as(null, (tx) => tx`SELECT * FROM call_log`)).toHaveLength(0);
    });

    it('배정 이력은 INSERT ONLY', async () => {
      const [o] = await sql`SELECT id FROM service_order LIMIT 1`;
      await sql`INSERT INTO assignment_history (order_id, action, actor_type) VALUES (${o!.id}, 'ASSIGN', 'ADMIN')`;
      await expect(sql`UPDATE assignment_history SET reason = 'x'`).rejects.toThrow(/INSERT ONLY/);
    });

    it('BR-023 동의 재질의 주기 기준값이 시스템 설정에 있다', async () => {
      const [r] = await sql`SELECT setting_value FROM system_setting WHERE setting_key = 'PRIVACY_REASK_MONTHS'`;
      expect(r?.setting_value).toBe('12');
    });
  });

  it('F-CUS-QUO-08 오픈 알림 신청은 서버만 접근한다: 브라우저 키로는 읽기·쓰기 불가', async () => {
    await sql`INSERT INTO area_open_request (legal_dong_code, sido, sigungu, eupmyeondong, phone, phone_hash, privacy_agreed_at, status)
      VALUES ('4113511000', '경기', '성남시 분당구', '백현동', 'v1:x:y:z', ${'a'.repeat(64)}, now(), 'WAITING')`;
    expect(await as(null, (tx) => tx`SELECT * FROM area_open_request`)).toHaveLength(0);
    expect(await as(ids.super, (tx) => tx`SELECT * FROM area_open_request`)).toHaveLength(0);
    await expect(
      as(
        null,
        (tx) => tx`INSERT INTO area_open_request (legal_dong_code, sido, sigungu, eupmyeondong, privacy_agreed_at, status)
        VALUES ('4113511000', '경기', '성남시 분당구', '백현동', now(), 'WAITING')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('BR-003 같은 지역·같은 번호의 대기 신청은 1건만 저장된다(안내 후에는 다시 신청 가능)', async () => {
    const h = 'b'.repeat(64);
    await sql`INSERT INTO area_open_request (legal_dong_code, sido, sigungu, eupmyeondong, phone_hash, privacy_agreed_at, status)
      VALUES ('4113511000', '경기', '성남시 분당구', '백현동', ${h}, now(), 'WAITING')`;
    await expect(
      sql`INSERT INTO area_open_request (legal_dong_code, sido, sigungu, eupmyeondong, phone_hash, privacy_agreed_at, status)
        VALUES ('4113511000', '경기', '성남시 분당구', '백현동', ${h}, now(), 'WAITING')`,
    ).rejects.toThrow(/area_open_request_waiting_uk/);
    await sql`INSERT INTO area_open_request (legal_dong_code, sido, sigungu, eupmyeondong, phone_hash, privacy_agreed_at, status)
      VALUES ('4113511000', '경기', '성남시 분당구', '백현동', ${h}, now(), 'NOTIFIED')`;
    const [r] = await sql`SELECT setting_value FROM system_setting WHERE setting_key = 'AREA_OPEN_REQUEST_KEEP_DAYS'`;
    expect(r?.setting_value).toBe('365');
  });

  describe('단계 5-1 현장작업', () => {
    beforeAll(async () => {
      const [c] = await sql`INSERT INTO customer (customer_no, customer_type, name, phone1, join_channel, privacy_agree_status, status)
        VALUES ('C2703200001', 'PERSONAL', 'enc', 'enc', 'APP', 'AGREED', 'ACTIVE') RETURNING id`;
      const [a] = await sql`INSERT INTO customer_address (customer_id, zipcode, road_address, branch_id)
        VALUES (${c!.id}, '00000', '현장로 1', ${b1}) RETURNING id`;
      const [t] = await sql`INSERT INTO technician (tech_code, name, phone, branch_id, grade, contract_type, status)
        VALUES ('T51', '현장기사', 'enc', ${b1}, 'REGULAR', 'FREELANCER', 'ACTIVE') RETURNING id`;
      for (const [no, branchId] of [['2703201000A1', b1], ['2703201000A2', b2]] as const) {
        const [o] = await sql`INSERT INTO service_order (order_no, customer_id, address_id, branch_id, channel, order_type, status, subtotal_amount, total_amount, payment_status)
          VALUES (${no}, ${c!.id}, ${a!.id}, ${branchId}, 'APP', 'NORMAL', 'IN_PROGRESS', 90000, 90000, 'UNPAID') RETURNING id`;
        const [w] = await sql`INSERT INTO work_order (order_id, main_technician_id, status) VALUES (${o!.id}, ${t!.id}, 'IN_PROGRESS') RETURNING id`;
        const [f] = await sql`INSERT INTO attachment (storage_key, original_name, mime_type, size_bytes, ref_type, ref_id, uploaded_by_type)
          VALUES (${'work_photo/' + no}, 'a.jpg', 'image/jpeg', 1, 'WORK_PHOTO', ${w!.id}, 'TECHNICIAN') RETURNING id`;
        await sql`INSERT INTO work_photo (work_order_id, photo_type, file_id) VALUES (${w!.id}, 'BEFORE', ${f!.id})`;
        await sql`INSERT INTO activity_log (order_id, actor_type, activity_type, content) VALUES (${o!.id}, 'TECHNICIAN', 'CALL', '통화')`;
      }
    });

    it('BR-100 비로그인(anon)은 작업·사진·활동내역을 읽을 수 없다', async () => {
      for (const t of ['work_order', 'work_result', 'work_photo', 'activity_log'])
        expect(await as(null, (tx) => tx.unsafe(`SELECT * FROM ${t}`))).toHaveLength(0);
    });

    it('BR-102 거점장은 자기 거점 주문의 작업·사진만 조회한다', async () => {
      expect(await as(ids.branchMgr, (tx) => tx`SELECT id FROM work_order`)).toHaveLength(1);
      expect(await as(ids.branchMgr, (tx) => tx`SELECT id FROM work_photo`)).toHaveLength(1);
      expect(await as(ids.cs, (tx) => tx`SELECT id FROM work_order`)).toHaveLength(2);
    });

    it('작업 기록 쓰기는 서버 전용: 브라우저 키(관리자)로는 수정할 수 없다', async () => {
      const updated = await as(ids.super, (tx) => tx`UPDATE work_order SET status = 'DONE' RETURNING id`);
      expect(updated).toHaveLength(0);
      await expect(
        as(ids.super, (tx) => tx`INSERT INTO activity_log (order_id, actor_type, activity_type, content) SELECT id, 'ADMIN', 'NOTE', 'x' FROM service_order LIMIT 1`),
      ).rejects.toThrow(/row-level security/);
    });

    it('F-TEC-WRK-07 처리 내용 최소 글자 수 기준값이 시스템 설정에 있다', async () => {
      const [r] = await sql`SELECT setting_value FROM system_setting WHERE setting_key = 'WORK_NOTE_MIN_LENGTH'`;
      expect(r?.setting_value).toBe('10');
      const codes = await sql`SELECT code FROM common_code WHERE group_code = 'SAFETY_CHECK' ORDER BY sort_order`;
      expect(codes.map((c) => c.code)).toEqual(['HIGH_PLACE', 'ELECTRIC', 'PROTECTIVE', 'CHEMICAL']);
    });
  });

  describe('단계 5-2 추가요금', () => {
    beforeAll(async () => {
      const works = await sql`SELECT w.id FROM work_order w JOIN service_order o ON o.id = w.order_id WHERE o.order_no IN ('2703201000A1', '2703201000A2')`;
      for (const w of works)
        await sql`INSERT INTO extra_charge (work_order_id, charge_type, title, amount, reason, approval_status)
          VALUES (${w.id}, 'ETC', '배관 연장', 30000, '배관 노후', 'REQUESTED')`;
    });

    it('BR-100 비로그인(anon)은 추가요금을 읽을 수 없다', async () => {
      expect(await as(null, (tx) => tx`SELECT * FROM extra_charge`)).toHaveLength(0);
    });

    it('BR-102 거점장은 자기 거점 주문의 추가요금만 조회한다', async () => {
      expect(await as(ids.branchMgr, (tx) => tx`SELECT id FROM extra_charge`)).toHaveLength(1);
      expect(await as(ids.cs, (tx) => tx`SELECT id FROM extra_charge`)).toHaveLength(2);
    });

    it('BR-042 승인은 서버 전용: 브라우저 키(관리자)로는 승인 상태를 바꿀 수 없다', async () => {
      const updated = await as(ids.super, (tx) => tx`UPDATE extra_charge SET approval_status = 'APPROVED' RETURNING id`);
      expect(updated).toHaveLength(0);
    });

    it('BR-032 장기 미처리 기준값·추가요금 코드가 있다', async () => {
      const [r] = await sql`SELECT setting_value FROM system_setting WHERE setting_key = 'PENDING_OVERDUE_HOURS'`;
      expect(r?.setting_value).toBe('48');
      const codes = await sql`SELECT code FROM common_code WHERE group_code = 'EXTRA_CHARGE_TYPE' ORDER BY sort_order`;
      expect(codes.map((c) => c.code)).toEqual(['RULE', 'MATERIAL', 'ETC', 'DEVICE_ADD']);
    });
  });
  describe('단계 6 결제·증빙', () => {
    beforeAll(async () => {
      const orders = await sql`SELECT id, customer_id FROM service_order WHERE order_no IN ('2703201000A1', '2703201000A2') ORDER BY order_no`;
      for (const [i, o] of orders.entries()) {
        const [p] = await sql`INSERT INTO payment (payment_no, order_id, customer_id, payment_stage, method, amount, status)
          VALUES (${'PT6' + i}, ${o.id}, ${o.customer_id}, 'ONSITE', 'CASH', 90000, 'APPROVED') RETURNING id`;
        await sql`INSERT INTO tax_document (payment_id, doc_type, identity_no, supply_amount, vat_amount, total_amount, issue_status)
          VALUES (${p!.id}, 'CASH_RECEIPT_INCOME', 'enc', 81818, 8182, 90000, 'REQUESTED')`;
        await sql`INSERT INTO memo (owner_type, owner_id, header_code, content, related_order_id, start_date, end_date)
          VALUES ('ADMIN', 1, 'RECEIVABLE', '미수 독촉', ${o.id}, '2027-03-20', '2027-03-20')`;
      }
    });

    it('BR-100 비로그인(anon)은 증빙·메모를 읽을 수 없다', async () => {
      expect(await as(null, (tx) => tx`SELECT * FROM tax_document`)).toHaveLength(0);
      expect(await as(null, (tx) => tx`SELECT * FROM memo`)).toHaveLength(0);
    });

    it('BR-102 거점장은 자기 거점 주문의 증빙·미수 메모만 조회한다', async () => {
      expect(await as(ids.branchMgr, (tx) => tx`SELECT id FROM tax_document`)).toHaveLength(1);
      expect(await as(ids.branchMgr, (tx) => tx`SELECT id FROM memo`)).toHaveLength(1);
      expect(await as(ids.super, (tx) => tx`SELECT id FROM tax_document`)).toHaveLength(2);
    });

    it('증빙 발행은 서버 전용: 브라우저 키(관리자)로는 발행 상태를 바꿀 수 없다', async () => {
      const updated = await as(ids.super, (tx) => tx`UPDATE tax_document SET issue_status = 'ISSUED' RETURNING id`);
      expect(updated).toHaveLength(0);
    });

    it('BR-082 현장 수금 결제도 INSERT ONLY (수정 불가)', async () => {
      await expect(sql`UPDATE payment SET amount = 1 WHERE payment_no = 'PT60'`).rejects.toThrow();
    });

    it('증빙 코드·결제 알림 템플릿이 있다', async () => {
      const codes = await sql`SELECT code FROM common_code WHERE group_code = 'TAX_ISSUE_STATUS' ORDER BY sort_order`;
      expect(codes.map((c) => c.code)).toEqual(['REQUESTED', 'ISSUED', 'FAILED', 'CANCELED']);
      const t = await sql`SELECT template_code FROM notification_template WHERE template_code IN ('PAYMENT_REQUEST', 'PAYMENT_LINK', 'PAYMENT_DONE')`;
      expect(t).toHaveLength(3);
    });
  });
  describe('단계 7 정산', () => {
    let s1 = 0;
    beforeAll(async () => {
      const [t1] = await sql`SELECT id FROM technician WHERE tech_code = 'T51'`;
      const [t2] = await sql`INSERT INTO technician (tech_code, name, phone, branch_id, grade, contract_type, status)
        VALUES ('T72', '정산기사', 'enc', ${b2}, 'REGULAR', 'EMPLOYEE', 'ACTIVE') RETURNING id`;
      const [b] = await sql`INSERT INTO settlement_batch (batch_no, period_start, period_end, status)
        VALUES ('S2027-W12', '2027-03-15', '2027-03-21', 'CALCULATED') RETURNING id`;
      for (const t of [t1!, t2!]) {
        const [s] = await sql`INSERT INTO settlement (batch_id, technician_id, job_count, gross_sales, base_pay, taxable_amount, net_pay, status)
          VALUES (${b!.id}, ${t.id}, 1, 90000, 49500, 49500, 47870, 'CALCULATED') RETURNING id`;
        await sql`INSERT INTO settlement_item (settlement_id, item_type, pay_amount, memo) VALUES (${s!.id}, 'INCENTIVE', 1000, '테스트')`;
        if (!s1) s1 = Number(s!.id);
      }
    });

    it('BR-100 비로그인(anon)·정산 권한 없는 상담원은 정산을 읽을 수 없다', async () => {
      for (const t of ['commission_policy', 'settlement_batch', 'settlement', 'settlement_item']) {
        expect(await as(null, (tx) => tx.unsafe(`SELECT * FROM ${t}`))).toHaveLength(0);
        expect(await as(ids.cs, (tx) => tx.unsafe(`SELECT * FROM ${t}`))).toHaveLength(0);
      }
    });

    it('BR-102 거점장은 자기 거점 기사의 정산서·항목만 조회한다', async () => {
      expect(await as(ids.branchMgr, (tx) => tx`SELECT id FROM settlement`)).toHaveLength(1);
      expect(await as(ids.branchMgr, (tx) => tx`SELECT id FROM settlement_item`)).toHaveLength(1);
      expect(await as(ids.super, (tx) => tx`SELECT id FROM settlement`)).toHaveLength(2);
    });

    it('정산 수정은 서버 전용: 브라우저 키(관리자)로는 정산서를 바꿀 수 없다', async () => {
      expect(await as(ids.super, (tx) => tx`UPDATE settlement SET net_pay = 1 RETURNING id`)).toHaveLength(0);
    });

    it('정산 상세·상태 이력은 INSERT ONLY', async () => {
      await expect(sql`UPDATE settlement_item SET pay_amount = 1`).rejects.toThrow(/INSERT ONLY/);
      await expect(sql`DELETE FROM settlement_item`).rejects.toThrow(/INSERT ONLY/);
    });

    it('BR-084 확정된 정산서는 금액을 바꾸거나 항목을 더할 수 없고, 상태(지급)만 바뀐다', async () => {
      await sql`UPDATE settlement SET status = 'CONFIRMED' WHERE id = ${s1}`;
      await expect(sql`UPDATE settlement SET net_pay = 1 WHERE id = ${s1}`).rejects.toThrow(/BR-084/);
      await expect(sql`INSERT INTO settlement_item (settlement_id, item_type, pay_amount) VALUES (${s1}, 'ADJUST', 1)`).rejects.toThrow(/BR-084/);
      await expect(sql`DELETE FROM settlement WHERE id = ${s1}`).rejects.toThrow();
      const paid = await sql`UPDATE settlement SET status = 'PAID', paid_at = now() WHERE id = ${s1} RETURNING id`;
      expect(paid).toHaveLength(1);
    });

    it('정산 코드·알림 템플릿·기본 수수료 정책이 있다', async () => {
      const codes = await sql`SELECT code FROM common_code WHERE group_code = 'SETTLEMENT_STATUS' ORDER BY sort_order`;
      expect(codes.map((c) => c.code)).toEqual(['CALCULATED', 'TECH_CONFIRMED', 'DISPUTED', 'CONFIRMED', 'PAID']);
      const t = await sql`SELECT template_code FROM notification_template WHERE template_code LIKE 'STL_%'`;
      expect(t).toHaveLength(3);
      const [p] = await sql`SELECT tech_share_rate, withholding_rate FROM commission_policy WHERE deleted_at IS NULL`;
      expect([Number(p!.tech_share_rate), Number(p!.withholding_rate)]).toEqual([55, 3.3]);
    });
  });
  describe('단계 8 사후관리·운영 마감', () => {
    let orders: { id: number; customer_id: number }[] = [];
    beforeAll(async () => {
      orders = (await sql`SELECT id, customer_id FROM service_order WHERE order_no IN ('2703201000A1', '2703201000A2') ORDER BY order_no`) as unknown as typeof orders;
      for (const [i, o] of orders.entries()) {
        const branchId = i === 0 ? b1 : b2;
        const [v] = await sql`INSERT INTO voc (voc_no, customer_id, order_id, branch_id, channel, voc_type, title, content, status)
          VALUES (${'V2703200000' + i}, ${o.customer_id}, ${o.id}, ${branchId}, 'PHONE_IN', 'COMPLAINT', '불만', '내용', 'RECEIVED') RETURNING id`;
        await sql`INSERT INTO voc_history (voc_id, to_status, actor_type) VALUES (${v!.id}, 'RECEIVED', 'SYSTEM')`;
        await sql`INSERT INTO as_request (as_no, original_order_id, customer_id, branch_id, reason, is_warranty, status)
          VALUES (${'A2703200000' + i}, ${o.id}, ${o.customer_id}, ${branchId}, 'LEAK', true, 'REQUESTED')`;
        await sql`INSERT INTO notice (notice_type, target_audience, branch_id, title, content, publish_from)
          VALUES ('BRANCH', 'TECHNICIAN', ${branchId}, ${'거점 공지 ' + i}, '내용', now())`;
      }
      await sql`INSERT INTO notice (notice_type, target_audience, title, content, publish_from) VALUES ('SAFETY', 'TECHNICIAN', '안전 공지', '내용', now())`;
    });

    it('BR-100 비로그인(anon)은 VOC·AS·안전사고·독촉·캠페인·공지를 읽을 수 없다', async () => {
      for (const t of ['voc', 'voc_history', 'as_request', 'safety_incident', 'incident_recipient', 'followup_request', 'campaign', 'campaign_target', 'notice', 'notice_read', 'faq']) {
        expect(await as(null, (tx) => tx.unsafe(`SELECT * FROM ${t}`))).toHaveLength(0);
      }
    });

    it('BR-102 거점장은 자기 거점 VOC·AS만 조회한다', async () => {
      expect(await as(ids.branchMgr, (tx) => tx`SELECT id FROM voc`)).toHaveLength(1);
      expect(await as(ids.branchMgr, (tx) => tx`SELECT id FROM voc_history`)).toHaveLength(1);
      expect(await as(ids.branchMgr, (tx) => tx`SELECT id FROM as_request`)).toHaveLength(1);
      expect(await as(ids.super, (tx) => tx`SELECT id FROM voc`)).toHaveLength(2);
    });

    it('BR-102 거점장은 전체 공지 + 자기 거점 공지만 본다', async () => {
      const rows = await as(ids.branchMgr, (tx) => tx`SELECT title FROM notice ORDER BY title`);
      expect(rows.map((r) => r.title).sort()).toEqual(['거점 공지 0', '안전 공지'].sort());
    });

    it('마케팅 권한 없는 상담원은 캠페인을 읽을 수 없다', async () => {
      expect(await as(ids.cs, (tx) => tx`SELECT id FROM campaign`)).toHaveLength(0);
      expect(await as(ids.super, (tx) => tx`SELECT id FROM campaign`)).toHaveLength(1);
    });

    it('VOC 처리 이력은 INSERT ONLY', async () => {
      await expect(sql`UPDATE voc_history SET memo = 'x'`).rejects.toThrow(/INSERT ONLY/);
      await expect(sql`DELETE FROM voc_history`).rejects.toThrow(/INSERT ONLY/);
    });

    it('BR-051 한 주문에 진행 중 AS 는 1건만', async () => {
      const o = orders[0]!;
      await expect(
        sql`INSERT INTO as_request (as_no, original_order_id, customer_id, reason, is_warranty, status) VALUES ('A27032000099', ${o.id}, ${o.customer_id}, 'NOISE', true, 'REQUESTED')`,
      ).rejects.toThrow(/as_request_open_uk/);
    });

    it('단계 8 코드·기준값·알림 템플릿·기본 FAQ·재방문 캠페인이 있다', async () => {
      const codes = await sql`SELECT code FROM common_code WHERE group_code = 'VOC_STATUS' ORDER BY sort_order`;
      expect(codes.map((c) => c.code)).toEqual(['RECEIVED', 'CONFIRMING', 'PROCESSING', 'DONE']);
      const [s] = await sql`SELECT setting_value FROM system_setting WHERE setting_key = 'PURGE_APPROVAL_MODE'`;
      expect(s?.setting_value).toBe('Y');
      const t = await sql`SELECT template_code FROM notification_template WHERE template_code IN ('FOLLOWUP_SENT', 'SAFETY_ESCALATED', 'AS_RECEIVED', 'INQUIRY_ANSWERED', 'REVISIT_11M')`;
      expect(t).toHaveLength(5);
      const faq = await sql`SELECT id FROM faq WHERE is_published`;
      expect(faq.length).toBeGreaterThan(0);
      const [c] = await sql`SELECT campaign_type, status FROM campaign`;
      expect([c?.campaign_type, c?.status]).toEqual(['REVISIT_AUTO', 'STOPPED']);
    });
  });
  describe('단계 9 품질·편의 확장', () => {
    beforeAll(async () => {
      const orders = (await sql`SELECT id, customer_id FROM service_order WHERE order_no IN ('2703201000A1', '2703201000A2') ORDER BY order_no`) as unknown as { id: number; customer_id: number }[];
      const [t] = await sql`SELECT id FROM technician WHERE tech_code = 'T51'`;
      for (const [i, o] of orders.entries()) {
        await sql`INSERT INTO review (order_id, customer_id, technician_id, branch_id, rating) VALUES (${o.id}, ${o.customer_id}, ${t!.id}, ${i === 0 ? b1 : b2}, ${i === 0 ? 5 : 1})`;
        await sql`INSERT INTO customer_device (customer_id, device_type) VALUES (${o.customer_id}, 'WALL')`;
      }
      await sql`INSERT INTO coupon (code, name, discount_type, discount_value, valid_to) VALUES ('RLS9TEST', '테스트 쿠폰', 'FIXED', 5000, '2099-12-31')`;
    });

    it('BR-100 비로그인(anon)은 기기·사진 인식·쿠폰·후기·자재 사용을 읽을 수 없다', async () => {
      for (const t of ['customer_device', 'device_image', 'coupon', 'customer_coupon', 'review', 'material_usage']) {
        expect(await as(null, (tx) => tx.unsafe(`SELECT * FROM ${t}`))).toHaveLength(0);
      }
    });

    it('BR-102 거점장은 자기 거점 후기만 조회한다', async () => {
      expect(await as(ids.branchMgr, (tx) => tx`SELECT id FROM review`)).toHaveLength(1);
      expect(await as(ids.super, (tx) => tx`SELECT id FROM review`)).toHaveLength(2);
    });

    it('마케팅 권한 없는 상담원은 쿠폰을 읽을 수 없고, 사진 인식 원본은 관리자도 브라우저 키로 못 읽는다', async () => {
      expect(await as(ids.cs, (tx) => tx`SELECT id FROM coupon`)).toHaveLength(0);
      expect(await as(ids.super, (tx) => tx`SELECT id FROM coupon`)).toHaveLength(1);
      expect(await as(ids.super, (tx) => tx`SELECT id FROM device_image`)).toHaveLength(0);
    });

    it('쓰기는 서버 전용: 브라우저 키(관리자)로는 후기를 숨기거나 쿠폰을 만들 수 없다', async () => {
      const r = await as(ids.super, (tx) => tx`UPDATE review SET is_hidden = true RETURNING id`);
      expect(r).toHaveLength(0);
      await expect(as(ids.super, (tx) => tx`INSERT INTO coupon (code, name, discount_type, discount_value, valid_to) VALUES ('RLS9X', 'x', 'FIXED', 1, '2099-12-31')`)).rejects.toThrow(/row-level security/);
    });

    it('BR-090 한 주문에 후기는 1건, 쿠폰은 고객당 1장', async () => {
      const [o] = await sql`SELECT order_id, customer_id, technician_id FROM review LIMIT 1`;
      await expect(sql`INSERT INTO review (order_id, customer_id, technician_id, rating) VALUES (${o!.order_id}, ${o!.customer_id}, ${o!.technician_id}, 3)`).rejects.toThrow(/review_order_uk/);
      const [c] = await sql`SELECT id FROM coupon WHERE code = 'RLS9TEST'`;
      await sql`INSERT INTO customer_coupon (coupon_id, customer_id, status) VALUES (${c!.id}, ${o!.customer_id}, 'ISSUED')`;
      await expect(sql`INSERT INTO customer_coupon (coupon_id, customer_id, status) VALUES (${c!.id}, ${o!.customer_id}, 'ISSUED')`).rejects.toThrow(/customer_coupon_uk/);
    });

    it('단계 9 코드·기준값·알림 템플릿이 있다', async () => {
      const codes = await sql`SELECT code FROM common_code WHERE group_code = 'INSPECTION_STATUS' ORDER BY sort_order`;
      expect(codes.map((c) => c.code)).toEqual(['WAITING', 'APPROVED', 'REJECTED']);
      const [s] = await sql`SELECT setting_value FROM system_setting WHERE setting_key = 'DORMANT_ENABLED'`;
      expect(s?.setting_value).toBe('N');
      const t = await sql`SELECT template_code FROM notification_template WHERE template_code IN ('REVIEW_REQUEST', 'COUPON_ISSUED', 'DORMANT_NOTICE', 'PG_MISMATCH', 'INSPECTION_REJECTED')`;
      expect(t).toHaveLength(5);
    });
  });

  describe('단계 10 기사 업무지원·교육', () => {
    beforeAll(async () => {
      const [t1] = await sql`SELECT id FROM technician WHERE tech_code = 'T51'`;
      const [t2] = await sql`SELECT id FROM technician WHERE tech_code = 'T72'`;
      for (const [b, t, code] of [[b1, t1!.id, 'RLS10-A'], [b2, t2!.id, 'RLS10-B']] as const) {
        const [c] = await sql`INSERT INTO training_course (course_code, name, course_type, branch_id) VALUES (${code}, '기본과정', 'BASIC', ${b}) RETURNING id`;
        await sql`INSERT INTO training_enrollment (course_id, technician_id) VALUES (${c!.id}, ${t})`;
        await sql`INSERT INTO technician_application (branch_id, name, phone, phone_hash, source) VALUES (${b}, 'enc', 'enc', ${code}, 'SNS')`;
        const [mat] = await sql`INSERT INTO material (material_code, name, unit) VALUES (${code}, '필터', 'EA') RETURNING id`;
        await sql`INSERT INTO material_request (technician_id, material_id, quantity, needed_date) VALUES (${t}, ${mat!.id}, 2, '2027-04-01')`;
        await sql`INSERT INTO technician_material_stock (technician_id, material_id, quantity) VALUES (${t}, ${mat!.id}, 3)`;
        const [m] = await sql`INSERT INTO memo (owner_type, owner_id, content, start_date, end_date, priority_source) VALUES ('ADMIN', 1, '지정 메모', '2027-04-01', '2027-04-01', 'ADMIN') RETURNING id`;
        await sql`INSERT INTO memo_recipient (memo_id, receiver_type, receiver_id) VALUES (${m!.id}, 'TECHNICIAN', ${t})`;
      }
      await sql`INSERT INTO memo (owner_type, owner_id, content, start_date, end_date, priority_source) VALUES ('TECHNICIAN', ${t1!.id}, '개인 메모', '2027-04-01', '2027-04-01', 'SELF')`;
      await sql`INSERT INTO tech_document (doc_type, title, content) VALUES ('SOP', '벽걸이 분해 SOP', '순서')`;
      await sql`INSERT INTO quick_menu (user_type, user_id, menu_code) VALUES ('TECHNICIAN', ${t1!.id}, 'T-CAL-010')`;
    });

    it('BR-100 비로그인(anon)은 교육·지원서·자재·기술자료·퀵메뉴·지정 메모를 읽을 수 없다', async () => {
      for (const t of ['training_course', 'training_enrollment', 'technician_application', 'material_request', 'technician_material_stock', 'tech_document', 'quick_menu', 'memo_recipient']) {
        expect(await as(null, (tx) => tx.unsafe(`SELECT * FROM ${t}`))).toHaveLength(0);
      }
    });

    it('BR-102 거점장은 자기 거점 과정·수강·지원서·자재 요청·지정 메모만 조회한다', async () => {
      expect(await as(ids.branchMgr, (tx) => tx`SELECT id FROM training_course WHERE course_code LIKE 'RLS10%'`)).toHaveLength(1);
      expect(await as(ids.branchMgr, (tx) => tx`SELECT e.id FROM training_enrollment e JOIN training_course c ON c.id = e.course_id WHERE c.course_code LIKE 'RLS10%'`)).toHaveLength(1);
      expect(await as(ids.branchMgr, (tx) => tx`SELECT id FROM technician_application`)).toHaveLength(1);
      expect(await as(ids.branchMgr, (tx) => tx`SELECT id FROM material_request`)).toHaveLength(1);
      expect(await as(ids.branchMgr, (tx) => tx`SELECT memo_id FROM memo_recipient`)).toHaveLength(1);
      expect(await as(ids.branchMgr, (tx) => tx`SELECT id FROM memo WHERE owner_type = 'ADMIN' AND related_order_id IS NULL`)).toHaveLength(1);
      expect(await as(ids.super, (tx) => tx`SELECT id FROM technician_application`)).toHaveLength(2);
    });

    it('기사 개인 메모·퀵메뉴는 관리자도 브라우저 키로 읽지 못한다', async () => {
      expect(await as(ids.super, (tx) => tx`SELECT id FROM memo WHERE owner_type = 'TECHNICIAN'`)).toHaveLength(0);
      expect(await as(ids.super, (tx) => tx`SELECT id FROM quick_menu`)).toHaveLength(0);
    });

    it('상담원은 기술자료를 조회만, 쓰기는 서버 전용', async () => {
      expect(await as(ids.cs, (tx) => tx`SELECT id FROM tech_document`)).toHaveLength(1);
      await expect(as(ids.super, (tx) => tx`INSERT INTO tech_document (doc_type, title, content) VALUES ('SOP', 'x', 'x')`)).rejects.toThrow(/row-level security/);
      expect(await as(ids.super, (tx) => tx`UPDATE training_enrollment SET result = 'PASSED' RETURNING id`)).toHaveLength(0);
    });

    it('같은 과정에 같은 기사는 한 번만, 퀵메뉴는 화면당 한 번', async () => {
      const [e] = await sql`SELECT course_id, technician_id FROM training_enrollment LIMIT 1`;
      await expect(sql`INSERT INTO training_enrollment (course_id, technician_id) VALUES (${e!.course_id}, ${e!.technician_id})`).rejects.toThrow(/training_enrollment_uk/);
      const [q] = await sql`SELECT user_id FROM quick_menu LIMIT 1`;
      await expect(sql`INSERT INTO quick_menu (user_type, user_id, menu_code) VALUES ('TECHNICIAN', ${q!.user_id}, 'T-CAL-010')`).rejects.toThrow(/quick_menu_uk/);
    });

    it('단계 10 코드·기준값·알림 템플릿이 있다', async () => {
      const codes = await sql`SELECT code FROM common_code WHERE group_code = 'MATERIAL_REQUEST_STATUS' ORDER BY sort_order`;
      expect(codes.map((c) => c.code)).toEqual(['REQUESTED', 'SHIPPED', 'RECEIVED', 'CANCELED']);
      const [s] = await sql`SELECT setting_value FROM system_setting WHERE setting_key = 'TRAINING_PASS_SCORE'`;
      expect(s?.setting_value).toBe('80');
      const t = await sql`SELECT template_code FROM notification_template WHERE template_code IN ('TECH_MEMO_ASSIGNED', 'APPLICANT_ACCEPTED', 'TRAINING_PASSED')`;
      expect(t).toHaveLength(3);
    });
  });
});
