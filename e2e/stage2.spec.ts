/**
 * 단계 2 완료 기준 (04 §2 단계 2):
 * 근무표로 슬롯이 자동 생성되고, 예약하면 잔여가 줄며 초과 예약이 막힌다. 예약·취소가 관리자 주문 목록에 바로 보이고, 접수 알림톡이 발송된다.
 * + F-CUS-AUTH-01·02 휴대폰 인증 가입, F-CUS-PAY-01 모의 결제, F-CUS-ORD-03 고객 취소(슬롯 반환), F-SYS-01·03 배치.
 * 기준 데이터(거점·지역·상품·가격)는 단계 1과 같은 값을 SQL로 보장한다(이 파일만 따로 실행해도 동작).
 */
import { type Page, expect, test } from '@playwright/test';
import postgres from 'postgres';
import { E2E_ENV } from '../playwright.config';

test.describe.configure({ mode: 'serial' });

const sql = postgres(E2E_ENV.DATABASE_URL, { max: 1, onnotice: () => undefined });
const TECH = { code: 'T-E2E1', name: '김기사' };

test.beforeAll(async () => {
  await sql`INSERT INTO branch (branch_code, name, status, phone) VALUES ('EP01', '은평거점', 'ACTIVE', '02-000-0000') ON CONFLICT (branch_code) DO NOTHING`;
  await sql`UPDATE branch SET status = 'ACTIVE', phone = coalesce(phone, '02-000-0000') WHERE branch_code = 'EP01'`;
  const [b] = await sql<{ id: string }[]>`SELECT id FROM branch WHERE branch_code = 'EP01'`;
  await sql`INSERT INTO service_area (branch_id, sido, sigungu, eupmyeondong, legal_dong_code, is_serviceable)
    VALUES (${b!.id}, '서울특별시', '은평구', '불광동', '1138010400', true) ON CONFLICT (legal_dong_code) DO NOTHING`;
  await sql`INSERT INTO service_category (code, name) VALUES ('AIRCON_CLEAN', '에어컨 청소') ON CONFLICT (code) DO NOTHING`;
  const [c] = await sql<{ id: string }[]>`SELECT id FROM service_category WHERE code = 'AIRCON_CLEAN'`;
  await sql`INSERT INTO service_product (category_id, product_code, name, device_type, clean_level, base_duration_min)
    VALUES (${c!.id}, 'AC-WALL-FULL', '벽걸이 완전분해 세척', 'WALL', 'FULL', 90) ON CONFLICT (product_code) DO NOTHING`;
  const [w] = await sql<{ id: string }[]>`SELECT id FROM service_product WHERE product_code = 'AC-WALL-FULL'`;
  await sql`INSERT INTO price_policy (product_id, branch_id, unit_price, valid_from)
    SELECT ${w!.id}, NULL, 90000, '2026-01-01' WHERE NOT EXISTS (SELECT 1 FROM price_policy WHERE product_id = ${w!.id} AND branch_id IS NULL)`;
  await sql`INSERT INTO surcharge_rule (rule_code, name, apply_type, condition_json, amount_type, amount) VALUES
    ('NIGHT', '야간 방문 할증', 'AUTO_QUOTE', '{"weekday":true,"after":"18:00"}', 'FIXED', 30000),
    ('HOLIDAY', '휴일 방문 할증', 'AUTO_QUOTE', '{"weekend":true,"holiday":true}', 'FIXED', 30000)
    ON CONFLICT (rule_code) DO NOTHING`;
});

test.afterAll(async () => {
  await sql.end();
});

async function adminLogin(page: Page) {
  await page.goto('/admin/login');
  await page.getByRole('textbox', { name: 'ID' }).fill('superadmin');
  await page.getByLabel('비밀번호').fill('E2e-super-1');
  await page.getByRole('button', { name: '로그인' }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'));
}

async function confirmSave(page: Page) {
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(page.locator('.ac-toast').filter({ hasText: '저장에 성공하였습니다.' }).last()).toBeVisible();
}

/** 불광동 벽걸이 1대 견적 → 결과 화면 [예약하기] */
async function quoteAndReserve(page: Page) {
  await page.goto('/quote');
  await page.getByRole('button', { name: '주소 검색' }).click();
  const dialog = page.getByRole('dialog', { name: '주소 검색' });
  await dialog.getByRole('textbox').fill('불광동');
  await dialog.getByRole('button', { name: '검색' }).click();
  await dialog.locator('.cus-address-results button').first().click();
  await expect(page.getByText('서비스 가능한 지역입니다.')).toBeVisible();
  await page.getByRole('button', { name: '다음' }).click();
  await page.getByRole('button', { name: '벽걸이' }).click();
  await page.getByRole('button', { name: '다음' }).click();
  await expect(page).toHaveURL(/\/quote\/count/);
  await page.getByRole('button', { name: '견적 보기' }).click();
  await expect(page).toHaveURL(/\/quote\/result\/Q\d{10}$/, { timeout: 30_000 });
  await page.getByRole('link', { name: '예약하기' }).click();
}

/** C-RSV-010 첫 날짜의 첫 시간 선택 → 고른 날짜·시각 */
async function pickFirstSlot(page: Page) {
  await expect(page.getByRole('heading', { name: '방문 날짜와 시간을 골라 주세요' })).toBeVisible({ timeout: 30_000 });
  const date = (await page.getByRole('group', { name: '방문 날짜' }).locator('[aria-pressed="true"]').textContent()) ?? '';
  const btn = page.getByRole('group', { name: '방문 시간' }).getByRole('button').first();
  const time = ((await btn.locator('.ac-num').textContent()) ?? '').trim();
  await btn.click();
  const notice = page.getByRole('dialog', { name: '할증 시간대예요' });
  if (await notice.isVisible().catch(() => false)) await notice.getByRole('button', { name: '확인' }).click();
  await page.getByRole('button', { name: '다음' }).click();
  return { date, time };
}

async function fillVisit(page: Page) {
  await expect(page.getByRole('heading', { name: '방문할 곳을 알려 주세요' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('textbox', { name: '방문 주소' })).toHaveValue(/불광/);
  await page.getByRole('textbox', { name: '상세주소' }).fill('101동 202호');
  await page.getByRole('button', { name: '아파트' }).click();
  await page.getByRole('button', { name: '다음' }).click();
  await expect(page.getByRole('heading', { name: '예약 내용을 확인해 주세요' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.ac-bottom-bar')).not.toContainText('–', { timeout: 15_000 });
}

const slotOf = async (orderNo: string) =>
  (
    await sql<{ booked: number; capacity: number }[]>`
      SELECT t.booked_count AS booked, t.capacity FROM service_order o
      JOIN time_slot t ON t.branch_id = o.branch_id AND t.slot_date = o.requested_date
        AND t.slot_hour = extract(hour FROM o.requested_time_from)::int AND t.slot_kind = 'NORMAL'
      WHERE o.order_no = ${orderNo}`
  )[0]!;

let firstOrderNo = '';

test('A-TEC-010·A-DSP-040 기사 등록 + 근무표 → 슬롯이 자동 생성된다 (F-ADM-DSP-05·06, F-SYS-01)', async ({ page, request }) => {
  await adminLogin(page);
  await page.goto('/admin/tec/technicians');
  await page.getByRole('button', { name: '기사 등록' }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('textbox', { name: '기사 코드', exact: true }).fill(TECH.code);
  await d.getByRole('textbox', { name: '이름', exact: true }).fill(TECH.name);
  await d.getByRole('textbox', { name: '연락처', exact: true }).fill('01011112222');
  await d.getByRole('combobox', { name: '소속 거점' }).selectOption({ label: '은평거점' });
  await d.getByRole('button', { name: '저장' }).click();
  await confirmSave(page);
  await expect(page.locator('tbody')).toContainText(TECH.code);
  await expect(page.locator('tbody')).toContainText('010-****-2222'); // 목록 마스킹 (BR-100)

  // 오늘부터 15일, 모든 요일 근무(시간 비움 = 기본 09:00~18:00) → 저장 시 슬롯 재계산
  const [{ today, end }] = await sql<{ today: string; end: string }[]>`
    SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD') AS today,
           to_char((now() AT TIME ZONE 'Asia/Seoul')::date + 15, 'YYYY-MM-DD') AS end`;
  await page.goto('/admin/dsp/schedules');
  await page.getByRole('button', { name: '일정 일괄 등록' }).click();
  const s = page.getByRole('dialog', { name: '근무 일정 일괄 등록' });
  await s.getByRole('checkbox', { name: `${TECH.name}(${TECH.code})` }).check();
  await s.getByLabel('시작일').fill(today!);
  await s.getByLabel('종료일').fill(end!);
  for (const w of ['일', '토']) await s.getByRole('checkbox', { name: w, exact: true }).check();
  await s.getByRole('button', { name: '저장' }).click();
  await confirmSave(page);
  await expect(page.locator('tbody')).toContainText('근무');

  const [slot] = await sql<{ n: number; cap: number }[]>`
    SELECT count(*)::int AS n, max(t.capacity)::int AS cap FROM time_slot t JOIN branch b ON b.id = t.branch_id
    WHERE b.branch_code = 'EP01' AND t.slot_date = (now() AT TIME ZONE 'Asia/Seoul')::date + 1`;
  expect(slot).toMatchObject({ n: 9, cap: 1 }); // 09~17시, 기사 1명 × 시간당 1건

  // F-SYS-01 배치: 인증 없으면 거부, 있으면 성공(이미 있는 칸은 그대로)
  expect((await request.get('/api/jobs/slot-generate')).status()).toBe(401);
  const res = await request.get('/api/jobs/slot-generate', { headers: { authorization: `Bearer ${E2E_ENV.CRON_SECRET}` } });
  expect(res.status()).toBe(200);

  await page.goto('/admin/dsp/slots');
  await expect(page.locator('tbody')).toContainText('은평거점');
});

test('C-AUTH·C-RSV 휴대폰 인증 가입 후 현장 결제 예약 → 잔여 차감·접수 알림·관리자 목록 (BR-021, F-SYS-03)', async ({ page }) => {
  await quoteAndReserve(page);
  // 비회원 → C-AUTH-030 휴대폰 인증 → C-AUTH-020 약관 → 예약으로 복귀 (F-CUS-AUTH-02)
  await expect(page).toHaveURL(/\/login\?next=/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: '로그인하고 예약을 이어가세요' })).toBeVisible();
  await page.getByRole('link', { name: '휴대폰 번호로 계속하기' }).click();
  await page.getByRole('textbox', { name: '이름' }).fill('홍길동');
  await page.getByRole('textbox', { name: '휴대폰 번호' }).fill('010-3333-4444');
  await page.getByRole('button', { name: '인증번호 받기' }).click();
  const code = ((await page.locator('.cus-mock-box strong').textContent()) ?? '').trim();
  await page.getByRole('textbox', { name: '인증번호' }).fill(code);
  await page.getByRole('button', { name: '확인' }).click();
  await expect(page).toHaveURL(/\/login\/terms/, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: '동의하고 가입하기' })).toBeDisabled();
  await page.getByRole('checkbox', { name: '전체 동의' }).check();
  await page.getByRole('button', { name: '동의하고 가입하기' }).click();

  await pickFirstSlot(page);
  await fillVisit(page);
  await expect(page.locator('.cus-kv')).toContainText('101동 202호');
  await page.getByRole('radio', { name: '현장 결제' }).check();
  await expect(page.getByRole('button', { name: '예약 확정' })).toBeDisabled(); // 취소 규정 동의 필수
  await page.getByRole('checkbox', { name: '취소 규정을 확인했어요 (필수)' }).check();
  await page.getByRole('button', { name: '예약 확정' }).click();

  await expect(page).toHaveURL(/\/reserve\/done\/\d{10}[A-Z]\d$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: '예약이 접수됐어요' })).toBeVisible();
  firstOrderNo = page.url().split('/').pop()!;

  // DB: 주문 RECEIVED + 상태 이력 1행, 슬롯 잔여 차감, 가입 동의 이력, 접수 알림 발송 이력
  const [o] = await sql<{ status: string; hist: number; payment_status: string; customer_id: string }[]>`
    SELECT o.status, o.payment_status, o.customer_id,
      (SELECT count(*)::int FROM order_status_history h WHERE h.order_id = o.id AND h.to_status = 'RECEIVED') AS hist
    FROM service_order o WHERE order_no = ${firstOrderNo}`;
  expect(o).toMatchObject({ status: 'RECEIVED', hist: 1, payment_status: 'UNPAID' });
  expect(await slotOf(firstOrderNo)).toEqual({ booked: 1, capacity: 1 });
  const [consent] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM consent_history WHERE customer_id = ${o!.customer_id} AND action = 'AGREE'`;
  expect(consent!.n).toBeGreaterThanOrEqual(2);
  const [log] = await sql<{ status: string; channel: string; phone: string }[]>`
    SELECT l.status, l.channel, l.receiver_phone_masked AS phone FROM notification_log l
    JOIN notification_template t ON t.id = l.template_id JOIN service_order o ON o.id = l.related_id
    WHERE t.template_code = 'ORDER_CONFIRMED' AND o.order_no = ${firstOrderNo}`;
  expect(log).toMatchObject({ status: 'FALLBACK_SMS', channel: 'SMS', phone: '010-****-4444' }); // 카카오 템플릿 ID 미등록 → 문자 대체

  // 고객 내 예약
  await page.getByRole('link', { name: '예약 상세 보기' }).click();
  await expect(page.locator('main')).toContainText(firstOrderNo);
  await expect(page.locator('main')).toContainText('101동 202호');

  // 관리자 주문 목록에 바로 보인다 (마스킹)
  await adminLogin(page);
  await page.goto('/admin/ord/orders');
  const row = page.locator('tbody tr').filter({ hasText: firstOrderNo });
  await expect(row).toBeVisible();
  await expect(row).toContainText('홍*동');
  await expect(row).toContainText('010-****-4444');
});

test('BR-021 마감된 시간은 다시 고를 수 없고, 선결제 모의 결제가 승인된다 (F-CUS-PAY-01)', async ({ page }) => {
  // 고객 세션 유지(앞 테스트와 별개 브라우저라 다시 로그인)
  await quoteAndReserve(page);
  await page.getByRole('link', { name: '휴대폰 번호로 계속하기' }).click();
  await page.getByRole('textbox', { name: '이름' }).fill('홍길동');
  await page.getByRole('textbox', { name: '휴대폰 번호' }).fill('01033334444');
  await page.getByRole('button', { name: '인증번호 받기' }).click();
  const code = ((await page.locator('.cus-mock-box strong').textContent()) ?? '').trim();
  await page.getByRole('textbox', { name: '인증번호' }).fill(code);
  await page.getByRole('button', { name: '확인' }).click(); // 기존 고객 → 바로 로그인

  // 첫 주문이 차지한 시각은 같은 날짜에서 보이지 않는다(잔여 0)
  const [first] = await sql<{ d: string; h: number }[]>`
    SELECT to_char(requested_date, 'YYYY-MM-DD') AS d, extract(hour FROM requested_time_from)::int AS h FROM service_order WHERE order_no = ${firstOrderNo}`;
  await expect(page.getByRole('heading', { name: '방문 날짜와 시간을 골라 주세요' })).toBeVisible({ timeout: 30_000 });
  const label = first!.h < 12 ? `오전 ${first!.h === 0 ? 12 : first!.h}:00` : `오후 ${first!.h % 12 === 0 ? 12 : first!.h % 12}:00`;
  await expect(page.getByRole('group', { name: '방문 시간' }).getByRole('button', { name: label, exact: true })).toHaveCount(0);

  await pickFirstSlot(page);
  await fillVisit(page);
  await page.getByRole('checkbox', { name: '취소 규정을 확인했어요 (필수)' }).check();
  await page.getByRole('button', { name: '예약 확정' }).click();
  // 같은 연락처로 진행 중인 예약 → 이중예약 경고 (BR-020)
  const dup = page.getByRole('dialog', { name: '이미 진행 중인 예약이 있어요' });
  await expect(dup).toContainText(firstOrderNo);
  await dup.getByRole('button', { name: '새로 예약' }).click();

  await expect(page).toHaveURL(/\/reserve\/pay\//, { timeout: 30_000 });
  await page.getByRole('button', { name: '결제하기' }).click();
  await page.getByRole('dialog', { name: '모의 결제창' }).getByRole('button', { name: '결제 실패' }).click();
  await expect(page.getByText('결제가 완료되지 않았어요.')).toBeVisible();
  await page.getByRole('button', { name: '결제하기' }).click();
  await page.getByRole('dialog', { name: '모의 결제창' }).getByRole('button', { name: '결제 승인' }).click();
  await expect(page).toHaveURL(/\/reserve\/done\//, { timeout: 30_000 });
  await expect(page.locator('.cus-kv')).toContainText('결제 완료');
  const orderNo = page.url().split('/').pop()!;
  const pays = await sql<{ status: string }[]>`
    SELECT p.status FROM payment p JOIN service_order o ON o.id = p.order_id WHERE o.order_no = ${orderNo} ORDER BY p.id`;
  expect(pays.map((p) => p.status)).toEqual(['FAILED', 'APPROVED']);
  const [o] = await sql<{ payment_status: string; paid: number; total: number }[]>`
    SELECT payment_status, paid_amount AS paid, total_amount AS total FROM service_order WHERE order_no = ${orderNo}`;
  expect(o!.payment_status).toBe('PREPAID');
  expect(o!.paid).toBe(o!.total);

  // F-CUS-ORD-03 첫 예약 고객 취소 → 슬롯 반환, 관리자 목록에 취소로 보인다
  await page.goto(`/orders/${firstOrderNo}/change`);
  await page.getByRole('button', { name: '예약 취소' }).first().click();
  await expect(page.getByText('결제 전 예약이라 수수료 없이 취소돼요.')).toBeVisible();
  await page.locator('main').getByRole('button', { name: '예약 취소' }).last().click();
  await page.getByRole('dialog', { name: '예약을 취소하시겠습니까?' }).getByRole('button', { name: '예약 취소' }).click();
  await expect(page).toHaveURL(new RegExp(`/orders/${firstOrderNo}$`), { timeout: 30_000 });
  expect(await slotOf(firstOrderNo)).toEqual({ booked: 0, capacity: 1 });
  const [c] = await sql<{ status: string; reqs: number }[]>`
    SELECT o.status, (SELECT count(*)::int FROM order_change_request r WHERE r.order_id = o.id AND r.request_type = 'CANCEL') AS reqs
    FROM service_order o WHERE order_no = ${firstOrderNo}`;
  expect(c).toEqual({ status: 'CANCELED', reqs: 1 });

  await adminLogin(page);
  await page.goto(`/admin/ord/orders?status=CANCELED`);
  await expect(page.locator('tbody tr').filter({ hasText: firstOrderNo })).toBeVisible();
});

test('F-SYS-03 방문 전날 알림 배치', async ({ request }) => {
  expect((await request.get('/api/jobs/visit-remind')).status()).toBe(401);
  const res = await request.get('/api/jobs/visit-remind', { headers: { authorization: `Bearer ${E2E_ENV.CRON_SECRET}` } });
  expect(res.status()).toBe(200);
  expect(typeof (await res.json()).sent).toBe('number');
});
