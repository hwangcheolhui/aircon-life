/**
 * 단계 6-2 완료 기준 (04 §2 단계 6 중 "처리 콘솔"): 관리자는 처리 콘솔(A-PRC-010)에서 기사별 접수 목록을 보고 기사 대신 처리·미처리를 저장한다(A-PRC-020).
 * 미처리 대기열(A-PRC-050)에서 재약속하면 배정 보드로 돌아간다(PENDING → ASSIGNED). BR-031 고객부재 2회 연속이면 운영자 확인 후에만 재약속.
 * + 대리 처리도 기사와 같은 완료 검증(BR-041 전·후 사진), 안전관리·서비스 파일(종류마다 2개), 활동내역, 장기 미처리 강조(BR-032), 미처리 취소.
 * 기준 데이터는 SQL로 보장하고, 고객 예약 1건을 화면으로 만든 뒤 SQL로 배정완료·미처리 주문을 복제한다.
 */
import { type Page, expect, test } from '@playwright/test';
import postgres from 'postgres';
import { E2E_ENV } from '../playwright.config';

test.describe.configure({ mode: 'serial' });

const sql = postgres(E2E_ENV.DATABASE_URL, { max: 1, onnotice: () => undefined });
// 테스트 전용 가상 번호(실제 개인정보 아님)
const TECH = { code: 'T62-A', name: '처리기사가', phone: '01062620001' };
const CUSTOMER_PHONE = '010-6262-0003';
const DONG_BULGWANG = '1138010400';

let branchId = '';
let baseNo = '';
const NO = { proxy: '', pending: '', absent: '' };
let techId = '';

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




const orderOf = async (no: string) =>
  (await sql<{ id: string; status: string; promised_at: Date; pending_reason: string | null }[]>`
    SELECT id, status, promised_at, pending_reason FROM service_order WHERE order_no = ${no}`)[0]!;
const workStatusOf = async (no: string) =>
  (await sql<{ status: string }[]>`SELECT w.status FROM work_order w JOIN service_order o ON o.id = w.order_id WHERE o.order_no = ${no}`)[0]?.status;
const historyOf = async (no: string) =>
  sql<{ to_status: string; actor_type: string; memo: string | null }[]>`
    SELECT h.to_status, h.actor_type, h.memo FROM order_status_history h JOIN service_order o ON o.id = h.order_id WHERE o.order_no = ${no} ORDER BY h.id`;
const kstDay = async (offset: number) =>
  (await sql<{ d: string }[]>`SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date + ${offset}::int, 'YYYY-MM-DD') AS d`)[0]!.d;
const png = (name: string) => ({ name, mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });

/** 예약 1건을 복제: 오늘 2시간 전 약속, 주문 항목·주기사 배정 포함. status = ASSIGNED | PENDING(고객부재 2회 연속, 3일 전) */
async function cloneOrder(suffix: string, status: 'ASSIGNED' | 'PENDING') {
  const no = `${baseNo.slice(0, 10)}${suffix}`;
  const [o] = await sql<{ id: string }[]>`
    INSERT INTO service_order (order_no, customer_id, address_id, branch_id, quote_id, channel, order_type, status, subtotal_amount, extra_amount, total_amount,
      paid_amount, payment_status, promised_at, requested_date, requested_time_from, requested_time_to, pending_reason)
    SELECT ${no}, customer_id, address_id, branch_id, quote_id, channel, order_type, ${status}, subtotal_amount, 0, total_amount, 0, 'UNPAID',
      now() - interval '2 hours', (now() AT TIME ZONE 'Asia/Seoul')::date, requested_time_from, requested_time_to,
      ${status === 'PENDING' ? 'CUSTOMER_ABSENT' : null}
    FROM service_order WHERE order_no = ${baseNo} RETURNING id`;
  await sql`INSERT INTO order_item (order_id, item_type, product_id, option_id, surcharge_rule_id, quantity, unit_price, amount)
    SELECT ${o!.id}, item_type, product_id, option_id, surcharge_rule_id, quantity, unit_price, amount
    FROM order_item WHERE order_id = (SELECT id FROM service_order WHERE order_no = ${baseNo})`;
  await sql`INSERT INTO assignment (order_id, technician_id, role, assign_method, status, accepted_at) VALUES (${o!.id}, ${techId}, 'MAIN', 'MANUAL', 'ACCEPTED', now())`;
  await sql`INSERT INTO order_status_history (order_id, from_status, to_status, actor_type, created_at) VALUES (${o!.id}, 'RECEIVED', 'ASSIGNED', 'ADMIN', now() - interval '5 days')`;
  if (status === 'PENDING') {
    await sql`INSERT INTO order_status_history (order_id, from_status, to_status, actor_type, reason_code, created_at)
      VALUES (${o!.id}, 'ASSIGNED', 'PENDING', 'TECHNICIAN', 'CUSTOMER_ABSENT', now() - interval '4 days'),
             (${o!.id}, 'PENDING', 'ASSIGNED', 'ADMIN', NULL, now() - interval '4 days' + interval '1 hour'),
             (${o!.id}, 'ASSIGNED', 'PENDING', 'TECHNICIAN', 'CUSTOMER_ABSENT', now() - interval '3 days')`;
    await sql`INSERT INTO work_order (order_id, main_technician_id, status, pending_code) VALUES (${o!.id}, ${techId}, 'PENDING', 'CUSTOMER_ABSENT')`;
  }
  return no;
}

test('준비: 기사 등록 + 고객 예약 1건 → 배정완료 2건·미처리(고객부재 2회) 1건', async ({ page, browser }) => {
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

  const cu = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
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
  await cu.getByRole('textbox', { name: '이름' }).fill('처리고객');
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

  NO.proxy = await cloneOrder('Z1', 'ASSIGNED');
  NO.pending = await cloneOrder('Z2', 'ASSIGNED');
  NO.absent = await cloneOrder('Z3', 'PENDING');
});

test('A-PRC-010 기사명 조회 → 대리 처리 저장: 전·후 사진이 없으면 막히고(BR-041), 저장하면 작업완료 + 상태 이력 "관리자 대리 입력"', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/prc/console');
  await expect(page.getByRole('heading', { name: '처리 콘솔' })).toBeVisible();
  const search = page.getByRole('search');
  await search.getByRole('textbox', { name: '기사명' }).fill(TECH.name);
  await search.getByRole('textbox', { name: '기사명' }).press('Enter');
  await expect(page).toHaveURL(/tech=\d+/);
  const list = page.getByRole('region', { name: '기사 접수 목록' });
  await expect(list.getByRole('button', { name: NO.proxy })).toBeVisible();
  await expect(list.getByRole('button', { name: NO.absent })).toBeVisible();
  // 미처리가 진행 건보다 위 (이관 → 미처리 → 진행 → 처리)
  const order = await list.locator('tbody tr td:nth-child(2)').allTextContents();
  expect(order.indexOf(NO.absent)).toBeLessThan(order.indexOf(NO.proxy));

  await list.getByRole('button', { name: NO.proxy }).click();
  const detail = page.getByRole('region', { name: '처리 정보' });
  await expect(detail.getByRole('heading', { name: NO.proxy })).toBeVisible();
  // 처리 결과를 고르기 전에는 [미처리 저장], 고르면 [처리 저장]
  await expect(detail.getByRole('button', { name: '미처리 저장' })).toBeVisible();
  await detail.getByRole('combobox', { name: /처리 결과$/ }).first().selectOption({ label: '완료' });
  await expect(detail.getByRole('button', { name: '처리 저장' })).toBeVisible();
  await detail.getByRole('checkbox', { name: '안전 체크 확인(기사 확인)' }).check();
  await detail.getByRole('textbox', { name: '처리 내용' }).fill('기사 전화 보고로 대리 입력: 필터·열교환기 세척 완료');
  await detail.getByRole('button', { name: '처리 저장' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(detail.getByText(/작업 전 사진이 없습니다/)).toBeVisible();
  expect((await orderOf(NO.proxy)).status).toBe('ASSIGNED');

  await detail.getByLabel(/작업 전 사진$/).first().setInputFiles(png('before.png'));
  await expect(detail.locator('.adm-prc-thumb')).toHaveCount(1);
  await detail.getByLabel(/작업 후 사진$/).first().setInputFiles(png('after.png'));
  await expect(detail.locator('.adm-prc-thumb')).toHaveCount(2);
  // 새로고침 후에도 입력 유지가 안 되므로 다시 입력
  await detail.getByRole('combobox', { name: /처리 결과$/ }).first().selectOption({ label: '완료' });
  await detail.getByRole('checkbox', { name: '안전 체크 확인(기사 확인)' }).check();
  await detail.getByRole('textbox', { name: '처리 내용' }).fill('기사 전화 보고로 대리 입력: 필터·열교환기 세척 완료');
  await detail.getByRole('button', { name: '처리 저장' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(page.locator('.ac-toast').filter({ hasText: '저장에 성공하였습니다.' }).last()).toBeVisible();
  await expect(detail.getByText('작업완료').first()).toBeVisible();

  expect((await orderOf(NO.proxy)).status).toBe('WORK_DONE');
  expect(await workStatusOf(NO.proxy)).toBe('DONE');
  const h = await historyOf(NO.proxy);
  expect(h.map((x) => x.to_status).slice(-3)).toEqual(['ON_THE_WAY', 'IN_PROGRESS', 'WORK_DONE']);
  for (const x of h.slice(-3)) {
    expect(x.actor_type).toBe('ADMIN');
    expect(x.memo).toBe('관리자 대리 입력');
  }
  // 하단 탭: 상태이력·작업 사진
  await page.getByRole('tab', { name: /상태이력/ }).click();
  await expect(page.getByRole('region', { name: '처리 이력' }).getByText('관리자 대리 입력').first()).toBeVisible();
});

test('A-PRC-020 대리 미처리 저장 · 안전관리 파일(종류마다 2개) · 활동내역 등록', async ({ page }) => {
  await adminLogin(page);
  await page.goto(`/admin/prc/console?no=${NO.pending}`);
  const detail = page.getByRole('region', { name: '처리 정보' });
  await expect(detail.getByRole('heading', { name: NO.pending })).toBeVisible();

  // F-ADM-PRC-06 안전관리 파일: 2개까지, 3개째는 막힘
  const safety = detail.getByLabel('안전관리 파일 첨부');
  await safety.setInputFiles(png('safety-1.png'));
  await expect(detail.getByText('(1/2)')).toBeVisible();
  await safety.setInputFiles(png('safety-2.png'));
  await expect(detail.getByText('(2/2)')).toBeVisible();
  await safety.setInputFiles(png('safety-3.png'));
  await expect(detail.getByText(/종류마다 2개까지/)).toBeVisible();

  // F-ADM-PRC-07 활동내역
  await detail.getByRole('button', { name: '활동내역 등록' }).click();
  const act = page.getByRole('dialog', { name: '활동내역 등록' });
  await act.getByRole('textbox', { name: '내용' }).fill('고객 통화 연결 안 됨, 문자 남김');
  await act.getByRole('button', { name: '저장' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await page.getByRole('tab', { name: /활동내역/ }).click();
  await expect(page.getByRole('region', { name: '처리 이력' }).getByText('고객 통화 연결 안 됨, 문자 남김')).toBeVisible();

  // 대리 미처리 저장 (BR-031 사유 필수)
  await detail.getByRole('button', { name: '미처리 저장' }).click();
  const pend = page.getByRole('dialog', { name: '미처리 저장' });
  await pend.getByRole('button', { name: '저장' }).click();
  await expect(pend.getByText('미처리 사유은(는) 필수 입력값입니다.').or(pend.getByText(/미처리 사유[은는] 필수 입력값입니다/))).toBeVisible();
  await pend.getByRole('combobox', { name: '미처리 사유' }).selectOption({ label: '고객부재' });
  await pend.getByRole('button', { name: '저장' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(pend).toBeHidden();
  await expect.poll(async () => (await orderOf(NO.pending)).status).toBe('PENDING');
  const o = await orderOf(NO.pending);
  expect(o.status).toBe('PENDING');
  expect(o.pending_reason).toBe('CUSTOMER_ABSENT');
  expect(await workStatusOf(NO.pending)).toBe('PENDING');
  expect((await historyOf(NO.pending)).at(-1)!.memo).toContain('관리자 대리 입력');
});

test('A-PRC-050 미처리 대기열: 장기 미처리 강조(BR-032), 고객부재 2회 연속은 운영자 확인 후 재약속(BR-031) → 배정 보드로 돌아감', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/prc/pending');
  await expect(page.getByRole('heading', { name: '미처리 대기열' })).toBeVisible();
  await page.getByRole('tab', { name: /^고객부재/ }).click();
  await expect(page).toHaveURL(/reason=CUSTOMER_ABSENT/);
  const row = page.locator('tbody tr').filter({ hasText: NO.absent });
  await expect(row.getByText('장기 미처리')).toBeVisible();
  await expect(row.getByText(/고객부재 2회 · 운영자 확인/)).toBeVisible();

  const date = await kstDay(2);
  await sql`INSERT INTO work_schedule (technician_id, work_date, schedule_type) VALUES (${techId}, ${date}::date, 'WORK')
    ON CONFLICT (technician_id, work_date) DO UPDATE SET schedule_type = 'WORK'`;
  await row.getByRole('button', { name: '재약속' }).click();
  const d = page.getByRole('dialog', { name: '재약속' });
  await d.getByLabel('재약속 날짜').fill(date);
  await d.getByRole('combobox', { name: '방문 시각' }).selectOption('10');
  await d.getByRole('button', { name: '저장' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(d.getByText(/운영자 확인이 필요합니다/).first()).toBeVisible();
  expect((await orderOf(NO.absent)).status).toBe('PENDING');

  await d.getByRole('checkbox', { name: '고객과 통화해 방문 가능을 확인했습니다' }).check();
  await d.getByRole('textbox', { name: '확인 내용' }).fill('고객 통화, 모레 오전 10시 재방문 약속');
  await d.getByRole('button', { name: '저장' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(page.locator('.ac-toast').filter({ hasText: '재약속했습니다' }).last()).toBeVisible();
  await expect(page.locator('tbody tr').filter({ hasText: NO.absent })).toHaveCount(0);

  const o = await orderOf(NO.absent);
  expect(o.status).toBe('ASSIGNED');
  expect(o.pending_reason).toBeNull();
  expect(await workStatusOf(NO.absent)).toBe('READY');
  expect((await historyOf(NO.absent)).at(-1)!.memo).toContain('운영자 확인: 고객 통화');
  const [a] = await sql<{ d: string }[]>`SELECT to_char(a.scheduled_start AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24') AS d
    FROM assignment a JOIN service_order o ON o.id = a.order_id WHERE o.order_no = ${NO.absent} AND a.role = 'MAIN'`;
  expect(a!.d).toBe(`${date} 10`);

  // 배정 보드의 새 날짜 타임라인에 다시 올라온다
  await page.goto(`/admin/dsp/board?branchId=${branchId}&date=${date}`);
  await expect(page.locator(`.adm-gantt-job[title^="${NO.absent} "]`)).toBeVisible();
});

test('A-PRC-050 미처리 취소 → 주문 취소(CANCELED)', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/prc/pending');
  const row = page.locator('tbody tr').filter({ hasText: NO.pending });
  await row.getByRole('button', { name: '취소' }).click();
  const d = page.getByRole('dialog', { name: '미처리 주문 취소' });
  await d.getByRole('combobox', { name: '취소 사유' }).selectOption('CUSTOMER_REQUEST');
  await d.getByRole('button', { name: '취소 처리' }).click();
  await page.getByRole('dialog', { name: '주문을 취소하시겠습니까?' }).getByRole('button', { name: '취소 처리' }).click();
  await expect(page.locator('.ac-toast').filter({ hasText: '주문을 취소했습니다.' }).last()).toBeVisible();
  expect((await orderOf(NO.pending)).status).toBe('CANCELED');
  expect(await workStatusOf(NO.pending)).toBe('CANCELED');
});
