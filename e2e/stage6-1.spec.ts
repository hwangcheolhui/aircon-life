/**
 * 단계 6-1 완료 기준 (04 §2 단계 6 중 "현장결제"): 앱결제·결제 링크·현장카드·계좌·현금 어느 방식이든 결제되면 주문이 완료(COMPLETED)되고
 * 정산 대상(work_order.is_settlement_target, BR-081)으로 표시된다. 기사가 받은 현금은 수금 기사로 남는다(BR-082). 미수금이 별도 목록에 쌓인다.
 * + 결제 실패 목록·PG 대사(A-PAY-010·020), 환불(A-PAY-030), 현금영수증 발행(T-PAY-020·A-PAY-050, 번호 보기 감사 로그).
 * 기준 데이터는 SQL로 보장하고, 고객 예약 1건을 화면으로 만든 뒤 SQL로 "작업완료(결제 대기)" 주문 4건을 복제한다(현장작업은 단계 5 E2E에서 확인).
 */
import { type Browser, type Page, expect, test } from '@playwright/test';
import postgres from 'postgres';
import { E2E_ENV } from '../playwright.config';

test.describe.configure({ mode: 'serial' });

const sql = postgres(E2E_ENV.DATABASE_URL, { max: 1, onnotice: () => undefined });
// 테스트 전용 가상 번호(실제 개인정보 아님)
const TECH = { code: 'T61-A', name: '결제기사가', phone: '01061610001' };
const CUSTOMER_PHONE = '010-6161-0003';
const DONG_BULGWANG = '1138010400';

let branchId = '';
let baseNo = '';
const NO = { cash: '', app: '', receivable: '', card: '' };
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
    VALUES (${c!.id}, 'AC-WALL-FULL', '벽걸이 완전분해 세척', 'WALL', 'FULL', 90) ON CONFLICT (product_code) DO NOTHING`;
  const [w] = await sql<{ id: string }[]>`SELECT id FROM service_product WHERE product_code = 'AC-WALL-FULL'`;
  await sql`INSERT INTO price_policy (product_id, branch_id, unit_price, valid_from)
    SELECT ${w!.id}, NULL, 90000, '2026-01-01' WHERE NOT EXISTS (SELECT 1 FROM price_policy WHERE product_id = ${w!.id} AND branch_id IS NULL)`;
  for (let d = 1; d <= 3; d++) {
    for (let h = 9; h <= 17; h++) {
      await sql`INSERT INTO time_slot (branch_id, slot_date, slot_hour, slot_kind, capacity)
        VALUES (${branchId}, (now() AT TIME ZONE 'Asia/Seoul')::date + ${d}::int, ${h}, 'NORMAL', 5)
        ON CONFLICT (branch_id, slot_date, slot_hour, slot_kind) DO UPDATE SET capacity = greatest(time_slot.capacity, time_slot.booked_count + 5), is_closed = false`;
    }
  }
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


type OrderRow = { id: string; status: string; payment_status: string; paid_amount: number; total_amount: number };
const orderOf = async (no: string) =>
  (await sql<OrderRow[]>`SELECT id, status, payment_status, paid_amount, total_amount FROM service_order WHERE order_no = ${no}`)[0]!;
const workOf = async (no: string) =>
  (
    await sql<{ is_settlement_target: boolean; received_amount: number }[]>`
      SELECT w.is_settlement_target, w.received_amount FROM work_order w JOIN service_order o ON o.id = w.order_id WHERE o.order_no = ${no}`
  )[0]!;
const paymentsOf = async (no: string) =>
  sql<{ payment_stage: string; method: string; amount: number; status: string; collected_by_tech_id: string | null }[]>`
    SELECT p.payment_stage, p.method, p.amount, p.status, p.collected_by_tech_id FROM payment p JOIN service_order o ON o.id = p.order_id
    WHERE o.order_no = ${no} ORDER BY p.id`;
const notified = async (no: string, code: string) =>
  (
    await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM notification_log l JOIN notification_template t ON t.id = l.template_id
      JOIN service_order o ON o.id = l.related_id AND l.related_type = 'ORDER' WHERE o.order_no = ${no} AND t.template_code = ${code}`
  )[0]!.n;

/** 작업완료(결제 대기) 주문 1건 복제: 작업비 90,000 + 동의한 현장 추가 30,000 = 120,000원 */
async function cloneWorkDone(suffix: string) {
  const no = `${baseNo.slice(0, 10)}${suffix}`;
  const [o] = await sql<{ id: string }[]>`
    INSERT INTO service_order (order_no, customer_id, address_id, branch_id, quote_id, channel, order_type, status, subtotal_amount, extra_amount, total_amount,
      paid_amount, payment_status, promised_at, requested_date, requested_time_from, requested_time_to, completed_at)
    SELECT ${no}, customer_id, address_id, branch_id, quote_id, channel, order_type, 'WORK_DONE', 90000, 30000, 120000, 0, 'UNPAID',
      now(), requested_date, requested_time_from, requested_time_to, now()
    FROM service_order WHERE order_no = ${baseNo} RETURNING id`;
  await sql`INSERT INTO order_status_history (order_id, from_status, to_status, actor_type) VALUES (${o!.id}, 'IN_PROGRESS', 'WORK_DONE', 'TECHNICIAN')`;
  await sql`INSERT INTO assignment (order_id, technician_id, role, assign_method, status, accepted_at) VALUES (${o!.id}, ${techId}, 'MAIN', 'MANUAL', 'ACCEPTED', now())`;
  await sql`INSERT INTO work_order (order_id, main_technician_id, status, finished_at, labor_amount, extra_amount, final_amount)
    VALUES (${o!.id}, ${techId}, 'DONE', now(), 90000, 30000, 120000)`;
  return no;
}

test('준비: 기사 등록 + 고객 예약 1건 → 작업완료(결제 대기) 주문 4건', async ({ page, browser }) => {
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
  await sql`INSERT INTO work_schedule (technician_id, work_date, schedule_type)
    VALUES (${techId}, (now() AT TIME ZONE 'Asia/Seoul')::date, 'WORK') ON CONFLICT (technician_id, work_date) DO UPDATE SET schedule_type = 'WORK'`;

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
  await cu.getByRole('textbox', { name: '이름' }).fill('결제고객');
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
  await cu.getByRole('textbox', { name: '상세주소' }).fill('5동 101호');
  await cu.getByRole('button', { name: '아파트' }).click();
  await cu.getByRole('button', { name: '다음' }).click();
  await cu.getByRole('radio', { name: '현장 결제' }).check();
  await cu.getByRole('checkbox', { name: '취소 규정을 확인했어요 (필수)' }).check();
  await cu.getByRole('button', { name: '예약 확정' }).click();
  const dup = cu.getByRole('dialog', { name: '이미 진행 중인 예약이 있어요' });
  await expect(cu.getByRole('heading', { name: '예약이 접수됐어요' }).or(dup)).toBeVisible({ timeout: 30_000 });
  if (await dup.isVisible()) await dup.getByRole('button', { name: '새로 예약' }).click();
  await expect(cu).toHaveURL(/\/reserve\/done\/\d{10}[A-Z]\d$/, { timeout: 30_000 });
  baseNo = cu.url().split('/').pop()!;

  NO.cash = await cloneWorkDone('Y1');
  NO.app = await cloneWorkDone('Y2');
  NO.receivable = await cloneWorkDone('Y3');
  NO.card = await cloneWorkDone('Y4');
});

test('T-PAY-010 현금: 받은 금액이 다르면 막히고, 맞으면 주문 완료·정산 대상, 수금 기사 기록(BR-081·082) → T-PAY-020 현금영수증', async ({ browser }) => {
  const p = await techLogin(browser);
  await p.goto(`/tech/jobs/${NO.cash}`);
  await p.getByRole('link', { name: '결제 받기 (현장 결제)' }).click();
  await expect(p.getByRole('heading', { name: '현장 결제' })).toBeVisible({ timeout: 30_000 });
  await expect(p.locator('.ac-bottom-bar')).toContainText('120,000원');
  await p.getByRole('button', { name: '현금' }).click();
  const sheet = p.getByRole('dialog', { name: '현금' });
  await sheet.getByRole('textbox', { name: '받은 금액' }).fill('100000');
  await sheet.getByRole('button', { name: '결제 받음' }).click();
  await expect(sheet.getByText('받은 금액이 결제할 금액(120,000원)과 다릅니다.')).toBeVisible();
  await sheet.getByRole('textbox', { name: '받은 금액' }).fill('120000');
  await sheet.getByRole('button', { name: '결제 받음' }).click();
  await expect(p.getByText('결제가 끝나 작업이 완료되었습니다.')).toBeVisible({ timeout: 30_000 });

  expect(await orderOf(NO.cash)).toMatchObject({ status: 'COMPLETED', payment_status: 'PAID', paid_amount: 120000 });
  expect(await workOf(NO.cash)).toMatchObject({ is_settlement_target: true, received_amount: 120000 });
  const pays = await paymentsOf(NO.cash);
  expect(pays).toHaveLength(1);
  expect(pays[0]).toMatchObject({ payment_stage: 'ONSITE', method: 'CASH', amount: 120000, status: 'APPROVED', collected_by_tech_id: techId });
  const [h] = await sql<{ to_status: string; actor_type: string }[]>`
    SELECT h.to_status, h.actor_type FROM order_status_history h JOIN service_order o ON o.id = h.order_id WHERE o.order_no = ${NO.cash} ORDER BY h.id DESC LIMIT 1`;
  expect(h).toMatchObject({ to_status: 'COMPLETED', actor_type: 'SYSTEM' });
  expect(await notified(NO.cash, 'PAYMENT_DONE')).toBe(1);

  // T-PAY-020 현금영수증(소득공제)
  await p.getByRole('button', { name: '현금영수증' }).click();
  const r = p.getByRole('dialog', { name: '현금영수증 발행' });
  await r.getByRole('textbox', { name: '휴대폰 번호' }).fill('1234');
  await r.getByRole('button', { name: '증빙 신청' }).click();
  await expect(r.getByText('휴대폰 번호 형식이 올바르지 않습니다.')).toBeVisible();
  await r.getByRole('textbox', { name: '휴대폰 번호' }).fill('010-6161-5678');
  await r.getByRole('button', { name: '증빙 신청' }).click();
  await expect(p.locator('.tec-pay-item')).toContainText('현금영수증(소득공제) 발행', { timeout: 30_000 });
  const [doc] = await sql<{ issue_status: string; issued_no: string; identity_no: string; supply_amount: number; vat_amount: number }[]>`
    SELECT d.issue_status, d.issued_no, d.identity_no, d.supply_amount, d.vat_amount FROM tax_document d JOIN payment p ON p.id = d.payment_id
    JOIN service_order o ON o.id = p.order_id WHERE o.order_no = ${NO.cash}`;
  expect(doc).toMatchObject({ issue_status: 'ISSUED', supply_amount: 109091, vat_amount: 10909 });
  expect(doc!.issued_no).toMatch(/^MOCK-/);
  expect(doc!.identity_no).not.toContain('01061615678'); // 암호화 저장
  await p.context().close();
});

test('F-TEC-PAY-01 앱 결제 요청 → C-PAY-020 고객 결제(실패 후 재시도 승인) → 완료, A-PAY-020 실패·A-PAY-010 PG 대사', async ({ browser, page }) => {
  const p = await techLogin(browser);
  await p.goto(`/tech/jobs/${NO.app}/pay`);
  await p.getByRole('button', { name: '앱 결제 요청' }).click();
  await expect(p.getByText('고객 앱(알림톡)으로 결제 요청을 보냈습니다.')).toBeVisible({ timeout: 30_000 });
  expect(await notified(NO.app, 'PAYMENT_REQUEST')).toBe(1);
  await p.getByRole('button', { name: '결제 링크 문자' }).click();
  await expect(p.getByText('고객에게 결제 링크 문자를 보냈습니다.')).toBeVisible({ timeout: 30_000 });
  expect(await notified(NO.app, 'PAYMENT_LINK')).toBe(1);

  // 고객: 예약 상세 → 작업 금액 결제하기 → 모의 결제창 실패 → 다시 승인
  await customer.goto(`/orders/${NO.app}`);
  // 링크는 확인하고, 이동은 직접 연다(하이드레이션 전 클릭·첫 컴파일이 느린 CI에서 막히지 않게)
  await expect(customer.getByRole('link', { name: '작업 금액 결제하기' })).toHaveAttribute('href', `/orders/${NO.app}/pay`);
  await customer.goto(`/orders/${NO.app}/pay`);
  await expect(customer.getByRole('heading', { name: '작업 금액을 결제해 주세요' })).toBeVisible({ timeout: 60_000 });
  await expect(customer.locator('.ac-bottom-bar')).toContainText('120,000원');
  await customer.getByRole('button', { name: '결제하기' }).click();
  await customer.getByRole('dialog', { name: '모의 결제창' }).getByRole('button', { name: '결제 실패' }).click();
  await expect(customer.getByText(/결제가 완료되지 않았어요/)).toBeVisible({ timeout: 30_000 });
  expect((await orderOf(NO.app)).status).toBe('WORK_DONE');
  await customer.getByRole('button', { name: '결제하기' }).click();
  await customer.getByRole('dialog', { name: '모의 결제창' }).getByRole('button', { name: '결제 승인' }).click();
  await expect(customer.getByText('결제가 완료되었어요.', { exact: false })).toBeVisible({ timeout: 30_000 });
  expect(await orderOf(NO.app)).toMatchObject({ status: 'COMPLETED', payment_status: 'PAID', paid_amount: 120000 });
  expect((await workOf(NO.app)).is_settlement_target).toBe(true);
  expect((await paymentsOf(NO.app)).map((x) => `${x.payment_stage}:${x.status}`)).toEqual(['POSTPAY:FAILED', 'POSTPAY:APPROVED']);

  // 기사 화면에서도 완료로 보인다
  await p.reload();
  await expect(p.getByText('결제가 끝나 작업이 완료되었습니다.')).toBeVisible({ timeout: 30_000 });
  await p.context().close();

  // 관리자: 결제 실패 목록 · 결제 내역 PG 대사
  await adminLogin(page);
  await page.goto(`/admin/pay/failures?orderNo=${NO.app}`);
  await expect(page.locator('.ac-table tbody tr')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator('.ac-table')).toContainText('모의 결제 실패');
  await page.goto(`/admin/pay/payments?orderNo=${NO.app}&status=APPROVED`);
  const row = page.locator('.ac-table tbody tr').first();
  await row.getByRole('button', { name: '대사' }).click();
  await expect(row).toContainText('일치', { timeout: 30_000 });
});

test('미수로 남기면 정산 제외(BR-081) → A-PAY-040 미수금 목록·[미수금] 메모 → 입금 확인으로 완료', async ({ browser, page }) => {
  const p = await techLogin(browser);
  await p.goto(`/tech/jobs/${NO.receivable}/pay`);
  await p.getByRole('button', { name: /미수로 남기기/ }).click();
  const sheet = p.getByRole('dialog', { name: '미수로 남기기' });
  await sheet.getByRole('button', { name: '미수로 저장' }).click();
  await expect(sheet.getByText('미수 사유는 필수 입력값입니다.')).toBeVisible();
  await sheet.getByRole('textbox', { name: '미수 사유' }).fill('고객이 다음 주에 계좌로 보내기로 함');
  await sheet.getByRole('button', { name: '미수로 저장' }).click();
  await expect(p.getByText('미수로 남긴 작업입니다.', { exact: false })).toBeVisible({ timeout: 30_000 });
  expect(await orderOf(NO.receivable)).toMatchObject({ status: 'WORK_DONE', payment_status: 'RECEIVABLE' });
  expect((await workOf(NO.receivable)).is_settlement_target).toBe(false);
  await p.context().close();

  await adminLogin(page);
  await page.goto('/admin/pay/receivables');
  const row = page.locator('.ac-table tbody tr').filter({ hasText: NO.receivable });
  await expect(row).toContainText('120,000원', { timeout: 30_000 });
  await expect(row).toContainText('고객이 다음 주에 계좌로 보내기로 함');
  await row.getByRole('button', { name: '메모' }).click();
  const memo = page.getByRole('dialog', { name: '[미수금] 메모' });
  await memo.getByRole('textbox', { name: '메모 내용' }).fill('고객 통화: 금요일 입금 약속');
  await memo.getByRole('button', { name: '저장' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(page.locator('.ac-toast').filter({ hasText: '저장에 성공하였습니다.' }).last()).toBeVisible();
  await expect(row).toContainText('고객 통화: 금요일 입금 약속', { timeout: 30_000 });
  const [m] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM memo m JOIN service_order o ON o.id = m.related_order_id
    WHERE o.order_no = ${NO.receivable} AND m.header_code = 'RECEIVABLE'`;
  expect(m!.n).toBe(2);

  await row.getByRole('button', { name: '입금 확인' }).click();
  const dep = page.getByRole('dialog', { name: '입금 확인' });
  await dep.getByRole('button', { name: '저장' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(page.locator('.ac-table tbody tr').filter({ hasText: NO.receivable })).toHaveCount(0, { timeout: 30_000 });
  expect(await orderOf(NO.receivable)).toMatchObject({ status: 'COMPLETED', payment_status: 'PAID' });
  expect((await workOf(NO.receivable)).is_settlement_target).toBe(true);
  const pays = await paymentsOf(NO.receivable);
  expect(pays[0]).toMatchObject({ payment_stage: 'POSTPAY', method: 'BANK_TRANSFER', collected_by_tech_id: null });
});

test('현장카드 결제 → A-PAY-030 부분 환불(현장 결제 기록) → 결제 상태 부분환불, A-PAY-050 증빙 번호 보기 감사 로그', async ({ browser, page }) => {
  const p = await techLogin(browser);
  await p.goto(`/tech/jobs/${NO.card}/pay`);
  await p.getByRole('button', { name: '카드단말' }).click();
  const sheet = p.getByRole('dialog', { name: '현장카드' });
  await expect(sheet.getByRole('textbox', { name: '받은 금액' })).toHaveValue('120000');
  await sheet.getByRole('textbox', { name: '카드 승인번호' }).fill('30012345');
  await sheet.getByRole('button', { name: '결제 받음' }).click();
  await expect(p.getByText('결제가 끝나 작업이 완료되었습니다.')).toBeVisible({ timeout: 30_000 });
  expect((await paymentsOf(NO.card))[0]).toMatchObject({ method: 'ONSITE_CARD', collected_by_tech_id: null });
  await p.context().close();

  await adminLogin(page);
  await page.goto('/admin/pay/refunds');
  await page.getByRole('button', { name: '환불 등록' }).click();
  const d = page.getByRole('dialog', { name: '환불 등록' });
  await d.getByRole('textbox', { name: '접수번호' }).fill(NO.card);
  await d.getByRole('button', { name: '조회' }).click();
  await expect(d.getByText('현장 결제입니다.', { exact: false })).toBeVisible({ timeout: 30_000 });
  await d.getByRole('textbox', { name: '환불 금액' }).fill('130000');
  await d.getByRole('combobox', { name: '환불 사유' }).selectOption('COMPENSATION');
  await d.getByRole('button', { name: '환불', exact: true }).click();
  await expect(d.getByText(/환불 가능 금액\(120,000원\)을 넘습니다/)).toBeVisible();
  await d.getByRole('textbox', { name: '환불 금액' }).fill('30000');
  await d.getByRole('button', { name: '환불', exact: true }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(page.locator('.ac-table tbody tr').filter({ hasText: NO.card })).toContainText('직접 환불(기록)', { timeout: 30_000 });
  expect(await orderOf(NO.card)).toMatchObject({ status: 'COMPLETED', payment_status: 'PARTIAL_REFUND' });

  // A-PAY-050: 현금영수증 번호는 마스킹, [보기]는 감사 로그
  await page.goto('/admin/pay/receipts?status=ISSUED');
  const rr = page.locator('.ac-table tbody tr').filter({ hasText: NO.cash });
  await expect(rr).toContainText('010-****-5678', { timeout: 30_000 });
  const before = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE target_table = 'tax_document'`)[0]!.n;
  await rr.getByRole('button', { name: '보기' }).click();
  await expect(rr).toContainText('01061615678');
  const after = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE target_table = 'tax_document' AND action = 'VIEW_PII'`)[0]!.n;
  expect(after).toBe(before + 1);
});
