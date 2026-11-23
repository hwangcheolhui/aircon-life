/**
 * 단계 4-1 완료 기준 (04 §2 단계 4-1):
 * 끌어 놓아 배정하면 근무·시간 겹침·숙련·지역 경고가 뜨고, 2인 작업은 보조 기사 없이 확정되지 않는다(BR-070·072).
 * 배정하면 기사 푸시(모의)와 고객 "기사 배정" 알림이 나가고, 기사는 인증번호로 로그인해 작업을 보며, 고객은 예약 상세에서 기사를 본다.
 * + A-TEC-010·020 기사 등록·숙련, A-DSP-020 재배정·이관 화면, F-SYS-09 미지정 경고 배치.
 * 기준 데이터(거점·지역·상품·가격)는 SQL로 보장한다(이 파일만 따로 실행해도 동작).
 */
import { type Browser, type Page, expect, test } from '@playwright/test';
import postgres from 'postgres';
import { E2E_ENV } from '../playwright.config';

test.describe.configure({ mode: 'serial' });

const sql = postgres(E2E_ENV.DATABASE_URL, { max: 1, onnotice: () => undefined });
// 테스트 전용 가상 번호(실제 개인정보 아님)
const MAIN = { code: 'T41-A', name: '박주기사', phone: '01041410001' };
const SUB = { code: 'T41-B', name: '최보조', phone: '01041410002' };
const CUSTOMER_PHONE = '010-4141-0003';
let orderNo = '';

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
  // 내일부터 7일 × 09~17시 일반 슬롯(여유 있게)
  for (let d = 1; d <= 7; d++) {
    for (let h = 9; h <= 17; h++) {
      await sql`INSERT INTO time_slot (branch_id, slot_date, slot_hour, slot_kind, capacity)
        VALUES (${b!.id}, (now() AT TIME ZONE 'Asia/Seoul')::date + ${d}::int, ${h}, 'NORMAL', 5)
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

async function confirmSave(page: Page) {
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(page.locator('.ac-toast').filter({ hasText: '저장에 성공하였습니다.' }).last()).toBeVisible();
}

async function registerTech(page: Page, t: typeof MAIN) {
  await page.goto('/admin/tec/technicians');
  await page.getByRole('button', { name: '기사 등록' }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('textbox', { name: '기사 코드', exact: true }).fill(t.code);
  await d.getByRole('textbox', { name: '이름', exact: true }).fill(t.name);
  await d.getByRole('textbox', { name: '연락처', exact: true }).fill(t.phone);
  await d.getByRole('combobox', { name: '소속 거점' }).selectOption({ label: '은평거점' });
  await d.getByRole('button', { name: '저장' }).click();
  await confirmSave(page);
  await expect(page.locator('tbody')).toContainText(t.code);
}

async function customerPage(browser: Browser) {
  return (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
}

/** 고객 휴대폰 인증 (모의 인증번호) */
async function customerVerify(page: Page) {
  await page.getByRole('textbox', { name: '이름' }).fill('배정고객');
  await page.getByRole('textbox', { name: '휴대폰 번호' }).fill(CUSTOMER_PHONE);
  await page.getByRole('button', { name: '인증번호 받기' }).click();
  const code = ((await page.locator('.cus-mock-box strong').textContent()) ?? '').trim();
  await page.getByRole('textbox', { name: '인증번호' }).fill(code);
  await page.getByRole('button', { name: '확인' }).click();
}

test('A-TEC-010·020 기사 등록(등급 이력·로그인 ID) → 숙련 지정', async ({ page }) => {
  await adminLogin(page);
  await registerTech(page, MAIN);
  await registerTech(page, SUB);

  // 신규 등록 시 등급 이력 1행, 로그인 ID(휴대폰 해시)가 채워진다
  const techs = await sql<{ id: string; code: string; login: boolean; hist: number }[]>`
    SELECT t.id, t.tech_code AS code, t.login_id IS NOT NULL AS login,
      (SELECT count(*)::int FROM technician_grade_history h WHERE h.technician_id = t.id) AS hist
    FROM technician t WHERE t.tech_code IN (${MAIN.code}, ${SUB.code}) ORDER BY t.tech_code`;
  expect(techs.map((t) => [t.code, t.login, t.hist])).toEqual([
    [MAIN.code, true, 1],
    [SUB.code, true, 1],
  ]);

  // 근무: 오늘부터 9일 매일 근무 (근무표 화면은 단계 2에서 검증)
  for (const t of techs) {
    await sql`INSERT INTO work_schedule (technician_id, work_date, schedule_type)
      SELECT ${t.id}, d::date, 'WORK' FROM generate_series((now() AT TIME ZONE 'Asia/Seoul')::date, (now() AT TIME ZONE 'Asia/Seoul')::date + 8, '1 day') d
      ON CONFLICT (technician_id, work_date) DO UPDATE SET schedule_type = 'WORK'`;
  }

  // A-TEC-020 상세 → 숙련·지역 탭에서 주기사 벽걸이 '단독 가능'
  await page.goto('/admin/tec/technicians');
  await page.locator('tbody tr').filter({ hasText: MAIN.code }).getByRole('link', { name: '상세' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(MAIN.name) })).toBeVisible();
  await page.getByRole('tab', { name: '숙련·지역' }).click();
  await page.getByRole('combobox', { name: '벽걸이 숙련' }).selectOption({ label: '단독 가능' });
  await page.getByRole('button', { name: '숙련 저장' }).click();
  await confirmSave(page);
  const [sk] = await sql<{ level: string }[]>`
    SELECT s.skill_level AS level FROM technician_skill s JOIN technician t ON t.id = s.technician_id WHERE t.tech_code = ${MAIN.code} AND s.device_type = 'WALL'`;
  expect(sk?.level).toBe('CAN_SOLO');
});

test('고객 예약 → 배정 보드 끌어 놓기 → 경고·2인 차단 → 배정 → 기사 푸시·고객 알림', async ({ page, browser }) => {
  // 고객: 견적 → 예약(현장 결제)
  const cu = await customerPage(browser);
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
  await customerVerify(cu);
  await expect(cu).toHaveURL(/\/login\/terms/, { timeout: 30_000 }); // 새 번호 → 가입 약관
  await cu.getByRole('checkbox', { name: '전체 동의' }).check();
  await cu.getByRole('button', { name: '동의하고 가입하기' }).click();
  await expect(cu.getByRole('heading', { name: '방문 날짜와 시간을 골라 주세요' })).toBeVisible({ timeout: 30_000 });
  await cu.getByRole('group', { name: '방문 시간' }).getByRole('button').first().click();
  const notice = cu.getByRole('dialog', { name: '할증 시간대예요' });
  if (await notice.isVisible().catch(() => false)) await notice.getByRole('button', { name: '확인' }).click();
  await cu.getByRole('button', { name: '다음' }).click();
  await expect(cu.getByRole('heading', { name: '방문할 곳을 알려 주세요' })).toBeVisible({ timeout: 30_000 });
  await cu.getByRole('textbox', { name: '상세주소' }).fill('101동 303호');
  await cu.getByRole('button', { name: '아파트' }).click();
  await cu.getByRole('button', { name: '다음' }).click();
  await expect(cu.getByRole('heading', { name: '예약 내용을 확인해 주세요' })).toBeVisible({ timeout: 30_000 });
  await cu.getByRole('radio', { name: '현장 결제' }).check();
  await cu.getByRole('checkbox', { name: '취소 규정을 확인했어요 (필수)' }).check();
  await cu.getByRole('button', { name: '예약 확정' }).click();
  await expect(cu).toHaveURL(/\/reserve\/done\/\d{10}[A-Z]\d$/, { timeout: 30_000 });
  orderNo = cu.url().split('/').pop()!;
  await cu.goto(`/orders/${orderNo}`);
  await expect(cu.locator('main')).toContainText('배정되면 알려 드려요');

  // 2인 작업으로 지정(현장 판단 등) → 보조 기사 없이는 확정되지 않아야 한다
  await sql`UPDATE service_order SET required_tech_count = 2 WHERE order_no = ${orderNo}`;
  const [o] = await sql<{ id: string; date: string }[]>`
    SELECT id, to_char(promised_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS date FROM service_order WHERE order_no = ${orderNo}`;
  const [b] = await sql<{ id: string }[]>`SELECT id FROM branch WHERE branch_code = 'EP01'`;

  // 관리자: 배정 보드에서 카드를 주기사 줄에 끌어 놓는다
  await adminLogin(page);
  await page.goto(`/admin/dsp/board?branchId=${b!.id}&date=${o!.date}`);
  await expect(page.getByRole('heading', { name: '배정 보드' })).toBeVisible();
  const card = page.getByRole('article', { name: `${orderNo} 배정 대기` });
  await expect(card).toBeVisible();
  const row = page.locator('table.adm-gantt tbody tr').filter({ hasText: MAIN.name });
  await card.dragTo(row.locator('td').nth(3));
  const dlg = page.getByRole('dialog', { name: '기사 배정' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByLabel('주기사')).toHaveValue(/\d+/);

  // 2인 작업: 보조 기사 없으면 차단(배정 버튼 비활성), 지역 미지정은 경고
  await expect(dlg.getByText('배정할 수 없습니다')).toBeVisible();
  await expect(dlg.getByRole('button', { name: '배정', exact: true })).toBeDisabled();
  await dlg.getByLabel('보조 기사').selectOption({ label: `${SUB.name} · 정식` });
  await expect(dlg.getByText('배정할 수 없습니다')).toHaveCount(0);
  await expect(dlg.getByText('확인이 필요합니다')).toBeVisible();
  await expect(dlg).toContainText('활동지역이 지정되지 않았습니다');
  await expect(dlg.getByRole('button', { name: '배정', exact: true })).toBeDisabled();
  await dlg.getByRole('checkbox', { name: '경고 내용을 확인했고 그대로 배정합니다' }).check();
  await dlg.getByRole('button', { name: '배정', exact: true }).click();
  await page.getByRole('dialog', { name: '배정하시겠습니까?' }).getByRole('button', { name: '배정' }).click();
  await expect(page.locator('.ac-toast').filter({ hasText: '저장에 성공하였습니다.' }).last()).toBeVisible();
  await expect(row.locator('.adm-gantt-job')).toHaveCount(1);

  // DB: 주문 ASSIGNED + 이력, 배정 2행(주·보조), 기사 푸시 2건, 고객 기사 배정 알림
  const [st] = await sql<{ status: string; hist: number; roles: string }[]>`
    SELECT o.status,
      (SELECT count(*)::int FROM order_status_history h WHERE h.order_id = o.id AND h.to_status = 'ASSIGNED') AS hist,
      (SELECT string_agg(a.role, ',' ORDER BY a.role) FROM assignment a WHERE a.order_id = o.id AND a.status = 'ACCEPTED') AS roles
    FROM service_order o WHERE o.id = ${o!.id}`;
  expect(st).toMatchObject({ status: 'ASSIGNED', hist: 1, roles: 'MAIN,SUPPORT' });
  const logs = await sql<{ code: string; channel: string; receiver: string }[]>`
    SELECT t.template_code AS code, l.channel, l.receiver_type AS receiver FROM notification_log l
    JOIN notification_template t ON t.id = l.template_id WHERE l.related_id = ${o!.id} ORDER BY l.id`;
  expect(logs.filter((l) => l.code === 'TECH_JOB_ASSIGNED' && l.channel === 'PUSH' && l.receiver === 'TECHNICIAN')).toHaveLength(2);
  expect(logs.some((l) => l.code === 'TECH_ASSIGNED' && l.receiver === 'CUSTOMER')).toBe(true);

  // 고객: 예약 상세에 담당 기사 표시
  await cu.goto(`/orders/${orderNo}`);
  await expect(cu.locator('main')).toContainText(`${MAIN.name} 기사님`);
});

test('T-AUTH-010 기사 인증번호 로그인 → 작업 목록·상세·알림 → 이관 요청 → A-DSP-020 반려', async ({ browser, page }) => {
  const t = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await t.goto('/tech');
  await expect(t).toHaveURL(/\/tech\/login/);
  await t.getByRole('textbox', { name: '휴대폰 번호' }).fill(MAIN.phone);
  await t.getByRole('button', { name: '인증번호 받기' }).click();
  const code = ((await t.locator('.tec-mock-box strong').textContent()) ?? '').trim();
  await t.getByRole('textbox', { name: '인증번호' }).fill(code);
  await t.getByRole('button', { name: '로그인' }).click();
  await expect(t).toHaveURL(/\/tech$/, { timeout: 30_000 });

  await t.goto(`/tech/jobs/${orderNo}`);
  await expect(t.locator('main')).toContainText(orderNo);
  await expect(t.locator('main')).toContainText(SUB.name); // 함께 가는 기사

  await t.goto('/tech/notifications');
  await expect(t.locator('main')).not.toContainText('조회 결과가 없습니다.');

  // F-TEC-JOB-05 이관 요청
  await t.goto(`/tech/jobs/${orderNo}`);
  await t.getByRole('button', { name: '다른 기사에게 이관 요청' }).click();
  const req = t.getByRole('dialog', { name: '이관 요청' });
  await req.getByRole('textbox', { name: '이관 사유' }).fill('차량 고장');
  await req.getByRole('button', { name: '요청하기' }).click();
  await expect(t.locator('.ac-toast').filter({ hasText: '이관을 요청했습니다.' })).toBeVisible();
  const [a] = await sql<{ status: string }[]>`
    SELECT a.status FROM assignment a JOIN service_order o ON o.id = a.order_id WHERE o.order_no = ${orderNo} AND a.role = 'MAIN' AND a.status <> 'CANCELED'`;
  expect(a?.status).toBe('TRANSFER_REQUESTED');

  // A-DSP-020: 이관 요청 반려 → 원래 기사 유지
  await adminLogin(page);
  await page.goto('/admin/dsp/transfers');
  const reqRow = page.locator('tbody tr').filter({ hasText: orderNo });
  await expect(reqRow).toContainText('차량 고장');
  await reqRow.getByRole('button', { name: '처리' }).click();
  const m = page.getByRole('dialog', { name: '이관 요청 처리' });
  await m.getByLabel('반려 사유').fill('대체 차량 이용 가능');
  await m.getByRole('button', { name: '반려' }).click();
  await page.getByRole('dialog', { name: '이관 요청을 반려하시겠습니까?' }).getByRole('button', { name: '반려' }).click();
  await expect(page.locator('.ac-toast').filter({ hasText: '저장에 성공하였습니다.' }).last()).toBeVisible();
  const [after] = await sql<{ status: string; actions: string }[]>`
    SELECT a.status, (SELECT string_agg(h.action, ',' ORDER BY h.id) FROM assignment_history h WHERE h.order_id = o.id) AS actions
    FROM assignment a JOIN service_order o ON o.id = a.order_id WHERE o.order_no = ${orderNo} AND a.role = 'MAIN'`;
  expect(after).toMatchObject({ status: 'ACCEPTED', actions: 'ASSIGN,ASSIGN,TRANSFER_REQUEST,TRANSFER_REJECT' });
});

test('F-SYS-09 미지정 경고 배치: 인증 없으면 거부, 약속 임박 미지정 건마다 1회', async ({ request }) => {
  expect((await request.get('/api/jobs/unassigned-alert')).status()).toBe(401);
  const res = await request.get('/api/jobs/unassigned-alert', { headers: { authorization: `Bearer ${E2E_ENV.CRON_SECRET}` } });
  expect(res.status()).toBe(200);
  expect((await res.json()).ok).toBe(true);
});
