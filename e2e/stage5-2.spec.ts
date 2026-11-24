/**
 * 단계 5-2 완료 기준 (04 §2 단계 5 중 "추가요금·미처리"):
 * 추가요금은 고객 동의(앱 또는 서명) 후에만 금액에 반영되고(BR-040), 기타 유형은 관리자 승인을 거친다(BR-042).
 * 미처리 저장 시 사유가 필수이며(BR-031) 48시간 경과 건이 강조된다(BR-032, F-SYS-08).
 * + 현장 기기 추가(F-TEC-WRK-04, 동의 후 기기·금액 증가), 고객부재 2회 연속 운영자 확인(BR-031).
 * 기준 데이터는 SQL로 보장하고, 주문은 고객 화면으로 1건 만든 뒤 SQL로 오늘·배정완료로 바꾼다(이 파일만 따로 실행해도 동작).
 */
import { type Browser, type Page, expect, test } from '@playwright/test';
import postgres from 'postgres';
import { E2E_ENV } from '../playwright.config';

test.describe.configure({ mode: 'serial' });

const sql = postgres(E2E_ENV.DATABASE_URL, { max: 1, onnotice: () => undefined });
// 테스트 전용 가상 번호(실제 개인정보 아님)
const TECH = { code: 'T52-A', name: '추가요금기사', phone: '01052520001' };
const CUSTOMER_PHONE = '010-5252-0003';
const DONG_BULGWANG = '1138010400';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const WALL = '벽걸이 완전분해 세척';

let branchId = '';
let orderNo = '';
let pendingNo = '';
let techId = '';
let customer: Page;

test.beforeAll(async () => {
  await sql`INSERT INTO branch (branch_code, name, status, phone) VALUES ('EP01', '은평거점', 'ACTIVE', '02-000-0000') ON CONFLICT (branch_code) DO NOTHING`;
  await sql`UPDATE branch SET status = 'ACTIVE', phone = coalesce(phone, '02-000-0000') WHERE branch_code = 'EP01'`;
  const [b] = await sql<{ id: string }[]>`SELECT id FROM branch WHERE branch_code = 'EP01'`;
  branchId = b!.id;
  await sql`INSERT INTO service_area (branch_id, sido, sigungu, eupmyeondong, legal_dong_code, is_serviceable)
    VALUES (${branchId}, '서울특별시', '은평구', '불광동', ${DONG_BULGWANG}, true) ON CONFLICT (legal_dong_code) DO NOTHING`;
  await sql`UPDATE service_area SET is_serviceable = true, branch_id = ${branchId} WHERE legal_dong_code = ${DONG_BULGWANG}`;
  await sql`INSERT INTO service_category (code, name) VALUES ('AIRCON_CLEAN', '에어컨 청소') ON CONFLICT (code) DO NOTHING`;
  const [c] = await sql<{ id: string }[]>`SELECT id FROM service_category WHERE code = 'AIRCON_CLEAN'`;
  await sql`INSERT INTO service_product (category_id, product_code, name, device_type, clean_level, base_duration_min)
    VALUES (${c!.id}, 'AC-WALL-FULL', ${WALL}, 'WALL', 'FULL', 90) ON CONFLICT (product_code) DO NOTHING`;
  const [w] = await sql<{ id: string }[]>`SELECT id FROM service_product WHERE product_code = 'AC-WALL-FULL'`;
  await sql`INSERT INTO price_policy (product_id, branch_id, unit_price, valid_from)
    SELECT ${w!.id}, NULL, 90000, '2026-01-01' WHERE NOT EXISTS (SELECT 1 FROM price_policy WHERE product_id = ${w!.id} AND branch_id IS NULL)`;
  // 사전공개 현장 추가요금 규칙 (A-PRD-030에서 관리)
  await sql`INSERT INTO surcharge_rule (rule_code, name, apply_type, amount_type, amount, per_unit, customer_notice)
    VALUES ('HEAVY_DIRT', '오염 심함', 'ON_SITE', 'FIXED', 20000, true, '곰팡이·오염이 심하면 대당 추가')
    ON CONFLICT (rule_code) DO NOTHING`;
  await sql`UPDATE surcharge_rule SET is_active = true WHERE rule_code = 'HEAVY_DIRT'`;
  for (let d = 1; d <= 3; d++) {
    for (let h = 9; h <= 17; h++) {
      await sql`INSERT INTO time_slot (branch_id, slot_date, slot_hour, slot_kind, capacity)
        VALUES (${branchId}, (now() AT TIME ZONE 'Asia/Seoul')::date + ${d}::int, ${h}, 'NORMAL', 5)
        ON CONFLICT (branch_id, slot_date, slot_hour, slot_kind) DO UPDATE SET capacity = greatest(time_slot.capacity, time_slot.booked_count + 5), is_closed = false`;
    }
  }
});

test.afterAll(async () => {
  await sql`UPDATE system_setting SET setting_value = '48' WHERE setting_key = 'PENDING_OVERDUE_HOURS'`;
  await sql.end();
});

async function adminLogin(page: Page) {
  await page.goto('/admin/login');
  await page.getByRole('textbox', { name: 'ID' }).fill('superadmin');
  await page.getByLabel('비밀번호').fill('E2e-super-1');
  await page.getByRole('button', { name: '로그인' }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'));
}

async function techLogin(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.goto('/tech/login');
  await p.getByRole('textbox', { name: '휴대폰 번호' }).fill(TECH.phone);
  await p.getByRole('button', { name: '인증번호 받기' }).click();
  const code = ((await p.locator('.tec-mock-box strong').textContent()) ?? '').trim();
  await p.getByRole('textbox', { name: '인증번호' }).fill(code);
  await p.getByRole('button', { name: '로그인' }).click();
  await expect(p).toHaveURL(/\/tech$/, { timeout: 30_000 });
  return p;
}

async function sign(p: Page) {
  const pad = p.getByRole('img', { name: '고객 서명 칸' });
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await p.mouse.move(box.x + 20, box.y + 40);
  await p.mouse.down();
  await p.mouse.move(box.x + 120, box.y + 90, { steps: 5 });
  await p.mouse.move(box.x + 220, box.y + 50, { steps: 5 });
  await p.mouse.up();
}

const orderOf = async (no: string) =>
  (
    await sql<{ id: string; status: string; total_amount: number; extra_amount: number; pending_reason: string | null }[]>`
      SELECT id, status, total_amount, extra_amount, pending_reason FROM service_order WHERE order_no = ${no}`
  )[0]!;
const chargesOf = async (no: string) =>
  sql<{ charge_type: string; amount: number; approval_status: string; customer_agreed: boolean; agreed_method: string | null; agreed_at: Date | null; order_item_id: string | null }[]>`
    SELECT x.charge_type, x.amount, x.approval_status, x.customer_agreed, x.agreed_method, x.agreed_at, x.order_item_id
    FROM extra_charge x JOIN work_order w ON w.id = x.work_order_id JOIN service_order o ON o.id = w.order_id
    WHERE o.order_no = ${no} ORDER BY x.id`;
const notified = async (no: string, code: string) =>
  (
    await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM notification_log l JOIN notification_template t ON t.id = l.template_id
      JOIN service_order o ON o.id = l.related_id AND l.related_type = 'ORDER' WHERE o.order_no = ${no} AND t.template_code = ${code}`
  )[0]!.n;

test('준비: 기사 등록 + 고객 예약 1건 → 오늘 배정완료 (+ 미처리용 주문 1건 복제)', async ({ page, browser }) => {
  await adminLogin(page);
  await page.goto('/admin/tec/technicians');
  await page.getByRole('button', { name: '기사 등록' }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('textbox', { name: '기사 코드', exact: true }).fill(TECH.code);
  await d.getByRole('textbox', { name: '이름', exact: true }).fill(TECH.name);
  await d.getByRole('textbox', { name: '연락처', exact: true }).fill(TECH.phone);
  await d.getByRole('combobox', { name: '소속 거점' }).selectOption({ label: '은평거점' });
  await d.getByRole('button', { name: '저장' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(page.locator('.ac-toast').filter({ hasText: '저장에 성공하였습니다.' }).last()).toBeVisible();
  const [t] = await sql<{ id: string }[]>`SELECT id FROM technician WHERE tech_code = ${TECH.code}`;
  techId = t!.id;
  await sql`UPDATE technician SET status = 'ACTIVE', accompany_required_count = 0 WHERE id = ${techId}`;

  customer = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const cu = customer;
  await cu.goto('/quote');
  await cu.getByRole('button', { name: '주소 검색' }).click();
  const addr = cu.getByRole('dialog', { name: '주소 검색' });
  await addr.getByRole('textbox').fill('불광동');
  await addr.getByRole('button', { name: '검색' }).click();
  await addr.locator('.cus-address-results button').first().click();
  await cu.getByRole('button', { name: '다음' }).click();
  await cu.getByRole('button', { name: '벽걸이' }).click();
  await cu.getByRole('button', { name: '다음' }).click();
  await cu.getByRole('button', { name: '견적 보기' }).click();
  await expect(cu).toHaveURL(/\/quote\/result\/Q\d{10}$/, { timeout: 30_000 });
  await cu.getByRole('link', { name: '예약하기' }).click();
  await expect(cu).toHaveURL(/\/login\?next=/, { timeout: 30_000 });
  await cu.getByRole('link', { name: '휴대폰 번호로 계속하기' }).click();
  await cu.getByRole('textbox', { name: '이름' }).fill('추가요금고객');
  await cu.getByRole('textbox', { name: '휴대폰 번호' }).fill(CUSTOMER_PHONE);
  await cu.getByRole('button', { name: '인증번호 받기' }).click();
  const code = ((await cu.locator('.cus-mock-box strong').textContent()) ?? '').trim();
  await cu.getByRole('textbox', { name: '인증번호' }).fill(code);
  await cu.getByRole('button', { name: '확인' }).click();
  await expect(cu).toHaveURL(/\/login\/terms/, { timeout: 30_000 });
  await cu.getByRole('checkbox', { name: '전체 동의' }).check();
  await cu.getByRole('button', { name: '동의하고 가입하기' }).click();
  await expect(cu.getByRole('heading', { name: '방문 날짜와 시간을 골라 주세요' })).toBeVisible({ timeout: 30_000 });
  await cu.getByRole('group', { name: '방문 시간' }).getByRole('button').first().click();
  const notice = cu.getByRole('dialog', { name: '할증 시간대예요' });
  if (await notice.isVisible().catch(() => false)) await notice.getByRole('button', { name: '확인' }).click();
  await cu.getByRole('button', { name: '다음' }).click();
  await cu.getByRole('textbox', { name: '상세주소' }).fill('7동 202호');
  await cu.getByRole('button', { name: '아파트' }).click();
  await cu.getByRole('button', { name: '다음' }).click();
  await cu.getByRole('radio', { name: '현장 결제' }).check();
  await cu.getByRole('checkbox', { name: '취소 규정을 확인했어요 (필수)' }).check();
  await cu.getByRole('button', { name: '예약 확정' }).click();
  const dup = cu.getByRole('dialog', { name: '이미 진행 중인 예약이 있어요' });
  await expect(cu.getByRole('heading', { name: '예약이 접수됐어요' }).or(dup)).toBeVisible({ timeout: 30_000 });
  if (await dup.isVisible()) await dup.getByRole('button', { name: '새로 예약' }).click();
  await expect(cu).toHaveURL(/\/reserve\/done\/\d{10}[A-Z]\d$/, { timeout: 30_000 });
  orderNo = cu.url().split('/').pop()!;

  const o = await orderOf(orderNo);
  await sql`UPDATE service_order SET promised_at = now(), status = 'ASSIGNED' WHERE id = ${o.id}`;
  await sql`INSERT INTO order_status_history (order_id, from_status, to_status, actor_type) VALUES (${o.id}, 'RECEIVED', 'ASSIGNED', 'ADMIN')`;
  await sql`INSERT INTO assignment (order_id, technician_id, role, assign_method, status, accepted_at) VALUES (${o.id}, ${techId}, 'MAIN', 'MANUAL', 'ACCEPTED', now())`;

  // 미처리 시나리오용 두 번째 주문 (같은 고객·주소, 내일 약속)
  pendingNo = `${orderNo.slice(0, -2)}Z9`;
  const [p2] = await sql<{ id: string }[]>`
    INSERT INTO service_order (order_no, customer_id, address_id, branch_id, quote_id, channel, order_type, status, promised_at, subtotal_amount, total_amount, payment_status)
    SELECT ${pendingNo}, customer_id, address_id, branch_id, quote_id, channel, order_type, 'ASSIGNED', now() + interval '1 day', subtotal_amount, total_amount, payment_status
    FROM service_order WHERE id = ${o.id} RETURNING id`;
  await sql`INSERT INTO order_item (order_id, item_type, product_id, quantity, unit_price, amount)
    SELECT ${p2!.id}, item_type, product_id, quantity, unit_price, amount FROM order_item WHERE order_id = ${o.id}`;
  // BR-031: 이전에 이미 한 번 고객부재로 미처리됐다가 재약속된 이력
  await sql`INSERT INTO order_status_history (order_id, from_status, to_status, reason_code, actor_type) VALUES
    (${p2!.id}, 'RECEIVED', 'ASSIGNED', NULL, 'ADMIN'),
    (${p2!.id}, 'ASSIGNED', 'PENDING', 'CUSTOMER_ABSENT', 'TECHNICIAN'),
    (${p2!.id}, 'PENDING', 'ASSIGNED', NULL, 'ADMIN')`;
  await sql`INSERT INTO assignment (order_id, technician_id, role, assign_method, status, accepted_at) VALUES (${p2!.id}, ${techId}, 'MAIN', 'MANUAL', 'ACCEPTED', now())`;
});

test('F-TEC-WRK-08 BR-031 미처리는 사유가 필수이고, 고객부재 2회 연속이면 운영자 확인 필요', async ({ browser }) => {
  const p = await techLogin(browser);
  await p.goto(`/tech/jobs/${pendingNo}`);
  await p.getByRole('link', { name: '미처리 저장 (고객부재·연기 등)' }).click();
  await expect(p.getByRole('heading', { name: '미처리 저장' })).toBeVisible({ timeout: 30_000 });
  await p.getByRole('button', { name: '미처리 저장' }).click();
  await p.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(p.getByText('미처리 사유는 필수 입력값입니다.')).toBeVisible({ timeout: 30_000 });
  expect((await orderOf(pendingNo)).status).toBe('ASSIGNED');

  await p.getByRole('combobox', { name: '미처리 사유' }).selectOption('CUSTOMER_ABSENT');
  await expect(p.getByText(/고객부재 2회째/)).toBeVisible();
  await p.getByRole('textbox', { name: '메모' }).fill('초인종·전화 모두 응답 없음');
  await p.getByRole('button', { name: '미처리 저장' }).click();
  await p.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(p.locator('.ac-toast').filter({ hasText: '운영자 확인이 필요합니다' })).toBeVisible({ timeout: 30_000 });
  await expect(p).toHaveURL(new RegExp(`/tech/jobs/${pendingNo}$`));

  const o = await orderOf(pendingNo);
  expect(o).toMatchObject({ status: 'PENDING', pending_reason: 'CUSTOMER_ABSENT' });
  const [h] = await sql<{ reason_code: string; memo: string; actor_type: string }[]>`
    SELECT reason_code, memo, actor_type FROM order_status_history WHERE order_id = ${o.id} ORDER BY id DESC LIMIT 1`;
  expect(h).toMatchObject({ reason_code: 'CUSTOMER_ABSENT', memo: '초인종·전화 모두 응답 없음', actor_type: 'TECHNICIAN' });
  const [w] = await sql<{ status: string; pending_code: string }[]>`SELECT status, pending_code FROM work_order WHERE order_id = ${o.id}`;
  expect(w).toMatchObject({ status: 'PENDING', pending_code: 'CUSTOMER_ABSENT' });
  expect(await notified(pendingNo, 'PENDING_ABSENT')).toBe(1);
  await p.context().close();
});

test('BR-032 F-SYS-08 장기 미처리는 배지로 강조되고 운영자에게 1회 알린다', async ({ browser, request }) => {
  // 기준 시간을 0으로 낮춰 "48시간 경과"를 재현 (afterAll 에서 48로 되돌림)
  await sql`UPDATE system_setting SET setting_value = '0' WHERE setting_key = 'PENDING_OVERDUE_HOURS'`;
  const p = await techLogin(browser);
  await p.goto('/tech/jobs?tab=PENDING');
  const card = p.locator('.tec-job-card').filter({ hasText: '장기 미처리' });
  await expect(card).toHaveCount(1, { timeout: 30_000 });
  await expect(card.locator('.ac-badge--pending-overdue')).toHaveCount(1);
  await p.context().close();

  expect((await request.get('/api/jobs/pending-overdue')).status()).toBe(401);
  const auth = { headers: { authorization: `Bearer ${E2E_ENV.CRON_SECRET}` } };
  const r1 = await (await request.get('/api/jobs/pending-overdue', auth)).json();
  expect(r1.sent).toBeGreaterThanOrEqual(1);
  expect(await notified(pendingNo, 'PENDING_OVERDUE')).toBe(1);
  await request.get('/api/jobs/pending-overdue', auth);
  expect(await notified(pendingNo, 'PENDING_OVERDUE')).toBe(1);
  await sql`UPDATE system_setting SET setting_value = '48' WHERE setting_key = 'PENDING_OVERDUE_HOURS'`;
});

test('F-TEC-WRK-05 BR-042 기타는 증빙 필수·관리자 승인 대기, 규칙 추가요금은 바로 고객 동의 요청, 응답 전에는 완료 불가', async ({ browser }) => {
  const p = await techLogin(browser);
  await p.goto(`/tech/jobs/${orderNo}/work`);
  await p.getByRole('button', { name: '출발', exact: true }).click();
  await p.getByRole('button', { name: '도착', exact: true }).click();
  await expect(p.getByRole('heading', { name: '안전 체크리스트' })).toBeVisible({ timeout: 30_000 });
  for (const name of ['고소작업 안전(사다리 고정·추락 방지)', '전원 차단·누전 확인', '보호구 착용(장갑·보안경·마스크)', '세척 약품 희석·환기 확인'])
    await p.getByRole('checkbox', { name }).check();
  await p.getByRole('button', { name: '작업 시작' }).click();
  await expect(p.getByRole('heading', { name: '작업 사진' })).toBeVisible({ timeout: 30_000 });

  await p.goto(`/tech/jobs/${orderNo}/work/extra`);
  await expect(p.getByRole('heading', { name: '추가요금' })).toBeVisible({ timeout: 30_000 });
  // 기타: 증빙 없으면 막힘
  await p.getByRole('button', { name: '추가요금 등록' }).click();
  let sheet = p.getByRole('dialog', { name: '추가요금 등록' });
  await sheet.getByRole('combobox', { name: '유형' }).selectOption('ETC');
  await expect(sheet.getByText('관리자 승인 후에 고객에게 동의를 요청합니다.')).toBeVisible();
  await sheet.getByRole('textbox', { name: '항목명' }).fill('배수 호스 교체');
  await sheet.getByRole('spinbutton', { name: '금액(원)' }).fill('15000');
  await sheet.getByRole('textbox', { name: '사유' }).fill('배수 호스가 갈라져 물이 샙니다');
  await sheet.getByRole('button', { name: '등록' }).click();
  await expect(sheet.getByText('증빙 사진은 필수 입력값입니다.')).toBeVisible({ timeout: 30_000 });
  await sheet.locator('input[type="file"][aria-label="추가요금 증빙 촬영"]').setInputFiles({ name: 'hose.png', mimeType: 'image/png', buffer: PNG });
  await expect(sheet.getByRole('img', { name: '추가요금 증빙 사진' })).toBeVisible();
  await sheet.getByRole('button', { name: '등록' }).click();
  await expect(p.locator('.ac-toast').filter({ hasText: '관리자에게 승인을 요청했습니다.' })).toBeVisible({ timeout: 30_000 });
  await expect(p.getByText('관리자 승인 대기')).toBeVisible();

  // 사전공개 규칙: 바로 고객 동의 요청
  await p.getByRole('button', { name: '추가요금 등록' }).click();
  sheet = p.getByRole('dialog', { name: '추가요금 등록' });
  await sheet.getByRole('combobox', { name: '유형' }).selectOption('RULE');
  await sheet.getByRole('combobox', { name: '추가요금 규칙' }).selectOption({ label: '오염 심함 (20,000원)' });
  await sheet.getByRole('textbox', { name: '사유' }).fill('냉각핀 곰팡이가 심합니다');
  await sheet.getByRole('button', { name: '등록' }).click();
  await expect(p.locator('.ac-toast').filter({ hasText: '고객에게 동의를 요청했습니다.' })).toBeVisible({ timeout: 30_000 });

  const xs = await chargesOf(orderNo);
  expect(xs.map((x) => [x.charge_type, x.approval_status, x.amount])).toEqual([
    ['ETC', 'REQUESTED', 15000],
    ['RULE', 'NOT_REQUIRED', 20000],
  ]);
  expect(await notified(orderNo, 'EXTRA_APPROVAL_REQUESTED')).toBe(1);
  expect(await notified(orderNo, 'EXTRA_CHARGE_REQUEST')).toBe(1); // 기타는 아직 고객에게 가지 않음

  // 응답 전에는 완료 불가 (F-TEC-WRK-07 ④)
  await p.goto(`/tech/jobs/${orderNo}/work/complete`);
  await expect(p.getByText('고객 동의를 기다리는 추가요금이 있습니다.')).toBeVisible({ timeout: 30_000 });
  await p.context().close();
});

test('A-PRC-040 BR-042 관리자가 기타 추가요금을 승인하면 고객에게 동의 요청 (반려는 사유 필수)', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/prc/extra-charges');
  await expect(page.locator('a[href="/admin/prc/extra-charges"]').first()).toBeAttached({ timeout: 30_000 }); // 단계 5 메뉴 공개
  await expect(page.getByRole('heading', { name: '추가요금 승인' })).toBeVisible({ timeout: 30_000 });
  const row = page.locator('tr').filter({ hasText: orderNo });
  await expect(row).toContainText('배수 호스 교체');
  await expect(row).toContainText('15,000원');
  const img = (await row.getByRole('link', { name: '사진 보기' }).getAttribute('href'))!;
  expect((await page.request.get(img)).status()).toBe(200);
  await row.getByRole('button', { name: '처리' }).click();
  const d = page.getByRole('dialog', { name: '추가요금 승인' });
  await d.getByRole('button', { name: '반려' }).click();
  await expect(d.getByText('반려 사유는 필수 입력값입니다.')).toBeVisible({ timeout: 30_000 });
  await d.getByRole('button', { name: '승인' }).click();
  await expect(page.locator('.ac-toast').filter({ hasText: '저장에 성공하였습니다.' }).last()).toBeVisible({ timeout: 30_000 });
  expect((await chargesOf(orderNo))[0]!.approval_status).toBe('APPROVED');
  expect(await notified(orderNo, 'EXTRA_CHARGE_REQUEST')).toBe(2);
});

test('C-ORD-040 F-CUS-ORD-04 고객이 앱에서 동의/거절, 거절한 항목은 청구되지 않는다 (BR-040)', async ({ browser }) => {
  await customer.goto(`/orders/${orderNo}`);
  await expect(customer.getByText(/추가요금 동의를 요청했어요\(2건\)/)).toBeVisible({ timeout: 30_000 });
  await customer.getByRole('link', { name: '확인하기' }).click();
  await expect(customer).toHaveURL(new RegExp(`/orders/${orderNo}/extra$`), { timeout: 60_000 }); // 첫 컴파일이 느릴 수 있음
  await expect(customer.getByRole('heading', { name: '추가요금 동의' })).toBeVisible({ timeout: 60_000 });
  const rule = customer.locator('.ac-card').filter({ hasText: '오염 심함' });
  await rule.getByRole('button', { name: '동의' }).click();
  await customer.getByRole('dialog', { name: '추가요금에 동의하시겠습니까?' }).getByRole('button', { name: '동의' }).click();
  await expect(rule.getByText('동의함')).toBeVisible({ timeout: 30_000 });
  const etc = customer.locator('.ac-card').filter({ hasText: '배수 호스 교체' });
  await expect(etc.getByRole('img', { name: '배수 호스 교체 증빙 사진' })).toBeVisible();
  await etc.getByRole('button', { name: '거절' }).click();
  await customer.getByRole('dialog', { name: '추가요금을 거절하시겠습니까?' }).getByRole('button', { name: '거절' }).click();
  await expect(etc.getByText('거절함')).toBeVisible({ timeout: 30_000 });
  await expect(customer.locator('.ac-bottom-bar')).toContainText('20,000원');

  const xs = await chargesOf(orderNo);
  expect(xs.map((x) => [x.charge_type, x.customer_agreed, x.agreed_method])).toEqual([
    ['ETC', false, null],
    ['RULE', true, 'APP_CONFIRM'],
  ]);
  expect(xs.every((x) => x.agreed_at !== null)).toBe(true);
  expect(await notified(orderNo, 'EXTRA_CHARGE_RESULT')).toBe(3); // 관리자 승인 1 + 고객 응답 2

  // 다른 사람은 증빙 사진을 볼 수 없다
  const src = (await etc.getByRole('img').getAttribute('src'))!;
  const anon = await browser.newContext();
  expect((await anon.request.get(src)).status()).toBe(401);
  await anon.close();
});

test('F-TEC-WRK-04 현장 기기 추가를 현장 서명으로 동의받고, 완료 금액 = 작업비 + 동의된 추가요금', async ({ browser }) => {
  const p = await techLogin(browser);
  await p.goto(`/tech/jobs/${orderNo}/work/extra`);
  await p.getByRole('button', { name: '추가요금 등록' }).click();
  const sheet = p.getByRole('dialog', { name: '추가요금 등록' });
  await sheet.getByRole('combobox', { name: '유형' }).selectOption('DEVICE_ADD');
  await sheet.getByRole('combobox', { name: '추가할 기기' }).selectOption({ index: 1 });
  await sheet.getByRole('textbox', { name: '사유' }).fill('작은 방 벽걸이 1대를 추가로 요청하셨습니다');
  await sheet.getByRole('button', { name: '등록' }).click();
  await expect(p.locator('.ac-toast').filter({ hasText: '고객에게 동의를 요청했습니다.' })).toBeVisible({ timeout: 30_000 });
  const item = p.locator('.tec-extra-item').filter({ hasText: '1대 추가' });
  await item.getByRole('button', { name: '현장 서명으로 동의' }).click();
  const signSheet = p.getByRole('dialog', { name: '현장 서명으로 동의 받기' });
  await signSheet.getByRole('button', { name: '동의 저장' }).click();
  await expect(signSheet.getByText('고객 서명을 받아 주세요.')).toBeVisible();
  await sign(p);
  await signSheet.getByRole('button', { name: '동의 저장' }).click();
  await expect(p.locator('.ac-toast').filter({ hasText: '고객 동의를 저장했습니다.' })).toBeVisible({ timeout: 30_000 });
  await expect(item.getByText('고객 동의', { exact: true })).toBeVisible({ timeout: 30_000 });
  const dev = (await chargesOf(orderNo))[2]!;
  expect(dev).toMatchObject({ charge_type: 'DEVICE_ADD', customer_agreed: true, agreed_method: 'SIGNATURE' });
  expect(dev.order_item_id).not.toBeNull();

  // 기기가 2대가 되어 사진·결과 칸이 늘어난다
  await p.goto(`/tech/jobs/${orderNo}/work/photos`);
  for (const label of [WALL, `${WALL}(현장 추가)`])
    for (const slot of ['작업 전', '작업 후']) {
      await p.locator(`input[type="file"][aria-label="${label} ${slot} 촬영"]`).setInputFiles({ name: 'x.png', mimeType: 'image/png', buffer: PNG });
      await expect(p.locator(`.ac-photo-slot img[alt="${label} ${slot} 사진"]`)).toHaveCount(1, { timeout: 30_000 });
    }
  await p.getByRole('link', { name: '다음: 처리 결과' }).click();
  await expect(p.getByRole('heading', { name: '처리 결과' })).toBeVisible({ timeout: 30_000 });
  const groups = p.getByRole('group', { name: /결과$/ });
  await expect(groups).toHaveCount(2);
  for (let i = 0; i < 2; i++) await groups.nth(i).getByRole('button', { name: '완료' }).click();
  await p.getByRole('button', { name: '저장하고 다음' }).click();
  await expect(p.getByRole('heading', { name: '추가요금' })).toBeVisible({ timeout: 30_000 });
  await p.getByRole('link', { name: '다음: 처리 저장' }).click();
  await expect(p.getByRole('heading', { name: '처리 저장' })).toBeVisible({ timeout: 30_000 });
  await p.getByRole('textbox', { name: '처리 내용' }).fill('벽걸이 2대 완전분해 세척, 오염이 심해 추가 세척했습니다.');
  await expect(p.getByText('사진·결과·안전 체크를 모두 마쳤습니다.')).toBeVisible({ timeout: 30_000 });

  const before = await orderOf(orderNo);
  const [base] = await sql<{ unit_price: number }[]>`
    SELECT unit_price FROM order_item WHERE order_id = ${before.id} AND id <> ${dev.order_item_id} AND item_type = 'PRODUCT'`;
  const agreed = 20000 + base!.unit_price;
  await expect(p.locator('.ac-bottom-bar')).toContainText(`${(before.total_amount + agreed).toLocaleString('ko-KR')}원`);
  await p.getByRole('button', { name: '작업 완료' }).click();
  await expect(p).toHaveURL(new RegExp(`/tech/jobs/${orderNo}$`), { timeout: 30_000 });

  const after = await orderOf(orderNo);
  expect(after).toMatchObject({ status: 'WORK_DONE', extra_amount: agreed, total_amount: before.total_amount + agreed });
  const [w] = await sql<{ extra_amount: number; final_amount: number; labor_amount: number }[]>`
    SELECT extra_amount, final_amount, labor_amount FROM work_order WHERE order_id = ${after.id}`;
  expect(w).toMatchObject({ extra_amount: agreed, labor_amount: before.total_amount, final_amount: before.total_amount + agreed });
  await p.context().close();

  // 고객 예약 상세: 동의한 추가요금이 금액에 보인다
  await customer.goto(`/orders/${orderNo}`);
  await expect(customer.getByText('현장 추가: 오염 심함')).toBeVisible({ timeout: 30_000 });
  await expect(customer.locator('.cus-amount-row--total')).toContainText(`${after.total_amount.toLocaleString('ko-KR')}원`);
});
