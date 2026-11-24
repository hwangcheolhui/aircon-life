/**
 * 단계 5-1 완료 기준 (04 §2 단계 5 중 "출발~사진~완료"):
 * 기사가 출발(고객에게 도착 예정 안내) → 도착 → 안전 체크리스트(BR-043) → 작업 전·후 사진(BR-041) → 기기별 결과 → 처리 저장(완료)까지
 * 앱으로 처리하고, 필수 사진·결과·안전 체크가 없으면 완료가 막힌다. 완료하면 고객이 작업 리포트(C-ORD-050)를 받는다.
 * + 활동내역(T-WRK-070), 진행 중 작업 고정 배너, 상태 이력(order_status_history), 사진 파일 권한(/api/files).
 * 기준 데이터는 SQL로 보장하고, 주문은 고객 화면으로 1건 만든 뒤 SQL로 오늘·배정완료로 바꾼다(이 파일만 따로 실행해도 동작).
 */
import { type Browser, type Page, expect, test } from '@playwright/test';
import postgres from 'postgres';
import { E2E_ENV } from '../playwright.config';

test.describe.configure({ mode: 'serial' });

const sql = postgres(E2E_ENV.DATABASE_URL, { max: 1, onnotice: () => undefined });
// 테스트 전용 가상 번호(실제 개인정보 아님)
const TECH = { code: 'T51-A', name: '현장기사가', phone: '01051510001' };
const CUSTOMER_PHONE = '010-5151-0003';
const DONG_BULGWANG = '1138010400';
// 1×1 PNG (테스트용 사진)
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let branchId = '';
let orderNo = '';
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

const orderRow = async () =>
  (
    await sql<{ id: string; status: string; total_amount: number; completed_at: Date | null }[]>`
      SELECT id, status, total_amount, completed_at FROM service_order WHERE order_no = ${orderNo}`
  )[0]!;
const workRow = async () =>
  (
    await sql<{ status: string; safety_checklist_done: boolean; high_place_work: boolean; final_amount: number | null; result_code: string | null; work_minutes: number | null; customer_signature_file_id: string | null }[]>`
      SELECT w.status, w.safety_checklist_done, w.high_place_work, w.final_amount, w.result_code, w.work_minutes, w.customer_signature_file_id
      FROM work_order w JOIN service_order o ON o.id = w.order_id WHERE o.order_no = ${orderNo}`
  )[0];
const notified = async (code: string) =>
  (
    await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM notification_log l JOIN notification_template t ON t.id = l.template_id
      JOIN service_order o ON o.id = l.related_id AND l.related_type = 'ORDER' WHERE o.order_no = ${orderNo} AND t.template_code = ${code}`
  )[0]!.n;

const photoInput = (p: Page, slot: string) => p.locator(`input[type="file"][aria-label$="${slot} 촬영"]`);

test('준비: 기사 등록 + 고객 예약 1건 → 오늘 배정완료', async ({ page, browser }) => {
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
  await cu.getByRole('textbox', { name: '이름' }).fill('현장고객');
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
  orderNo = cu.url().split('/').pop()!;

  // 오늘 지금 약속 + 이 기사에게 확정 배정 (운영자 배정은 단계 4-1 E2E에서 확인)
  const o = await orderRow();
  await sql`UPDATE service_order SET promised_at = now(), status = 'ASSIGNED' WHERE id = ${o.id}`;
  await sql`INSERT INTO order_status_history (order_id, from_status, to_status, actor_type) VALUES (${o.id}, 'RECEIVED', 'ASSIGNED', 'ADMIN')`;
  await sql`INSERT INTO assignment (order_id, technician_id, role, assign_method, status, accepted_at) VALUES (${o.id}, ${techId}, 'MAIN', 'MANUAL', 'ACCEPTED', now())`;
});

test('T-WRK-010 출발 → 고객 "기사 출발" 알림·도착 예정, 진행 중 작업 배너 → 도착', async ({ browser }) => {
  const p = await techLogin(browser);
  await p.goto(`/tech/jobs/${orderNo}`);
  await p.getByRole('link', { name: '작업 시작 (출발)' }).click();
  await expect(p.getByRole('heading', { name: '출발·도착' })).toBeVisible({ timeout: 30_000 });
  await p.getByRole('button', { name: '출발', exact: true }).click();
  await expect(p.getByRole('button', { name: '도착', exact: true })).toBeVisible({ timeout: 30_000 });

  expect((await orderRow()).status).toBe('ON_THE_WAY');
  expect((await workRow())?.status).toBe('ON_THE_WAY');
  expect(await notified('ON_THE_WAY')).toBe(1);

  // 고객: 도착 예정시각만(좌표 없음, BR-115)
  await customer.goto(`/orders/${orderNo}`);
  await expect(customer.getByText(/기사님이 출발했어요\. 도착 예정/)).toBeVisible({ timeout: 30_000 });

  // 진행 중 작업 고정 배너 (다른 화면에서도)
  await p.goto('/tech');
  await expect(p.locator('.ac-live-banner')).toContainText(orderNo);
  await p.locator('.ac-live-banner').getByRole('link', { name: '이어서' }).click();
  await p.getByRole('button', { name: '도착', exact: true }).click();
  await expect(p.getByRole('heading', { name: '안전 체크리스트' })).toBeVisible({ timeout: 30_000 });
  expect((await orderRow()).status).toBe('IN_PROGRESS');
  await p.context().close();
});

test('BR-043 안전 체크리스트를 모두 확인해야 작업을 시작하고, 고소작업 혼자면 2인 권장 경고', async ({ browser }) => {
  const p = await techLogin(browser);
  await p.goto(`/tech/jobs/${orderNo}/work/safety`);
  const start = p.getByRole('button', { name: '작업 시작' });
  await expect(start).toBeDisabled();
  for (const name of ['전원 차단·누전 확인', '보호구 착용(장갑·보안경·마스크)', '세척 약품 희석·환기 확인'])
    await p.getByRole('checkbox', { name }).check();
  await expect(start).toBeDisabled();
  await p.getByRole('checkbox', { name: '고소작업 안전(사다리 고정·추락 방지)' }).check();
  await p.getByRole('checkbox', { name: /고소작업이 있습니다/ }).check();
  await expect(p.locator('.ac-alert--warning')).toContainText('2인 이상');
  await expect(start).toBeEnabled();
  await start.click();
  await expect(p.getByRole('heading', { name: '작업 사진' })).toBeVisible({ timeout: 30_000 });
  const w = await workRow();
  expect(w).toMatchObject({ status: 'IN_PROGRESS', safety_checklist_done: true, high_place_work: true });
  await p.context().close();
});

test('BR-041 작업 후 사진이 없으면 완료가 막히고, 사진·결과·처리 내용을 갖추면 완료(WORK_DONE)된다', async ({ browser }) => {
  const p = await techLogin(browser);
  await p.goto(`/tech/jobs/${orderNo}/work/photos`);
  const next = p.getByRole('button', { name: '다음: 처리 결과' });
  await expect(next).toBeDisabled();
  // 작업 전 사진만
  await photoInput(p, '작업 전').first().setInputFiles({ name: 'before.png', mimeType: 'image/png', buffer: PNG });
  await expect(p.locator('.ac-photo-slot img[alt$="작업 전 사진"]')).toHaveCount(1, { timeout: 30_000 });
  await expect(next).toBeDisabled();

  // 결과 입력 후 완료 화면: 작업 후 사진 누락으로 막힘
  await p.getByRole('link', { name: '작업하지 못한 기기가 있으면 결과부터 입력' }).click();
  await expect(p.getByRole('heading', { name: '처리 결과' })).toBeVisible({ timeout: 30_000 });
  await p.getByRole('group', { name: /결과$/ }).first().getByRole('button', { name: '완료' }).click();
  await p.getByRole('textbox', { name: '기기 상태' }).first().fill('냉각핀 곰팡이 제거');
  await p.getByRole('combobox', { name: '오염도' }).selectOption('HIGH');
  await p.getByRole('button', { name: '저장하고 다음' }).click();
  // 단계 5-2: 결과 다음은 추가요금(T-WRK-040) → 처리 저장
  await expect(p.getByRole('heading', { name: '추가요금' })).toBeVisible({ timeout: 30_000 });
  await p.getByRole('link', { name: '다음: 처리 저장' }).click();
  await expect(p.getByRole('heading', { name: '처리 저장' })).toBeVisible({ timeout: 30_000 });
  await expect(p.getByText(/작업 후 사진이 없습니다/)).toBeVisible();
  await p.getByRole('textbox', { name: '처리 내용' }).fill('벽걸이 에어컨 완전분해 세척을 마쳤습니다. 냉각핀과 송풍팬 곰팡이를 제거했습니다.');
  await expect(p.getByRole('button', { name: '작업 완료' })).toBeDisabled();

  // 작업 후 사진 → 다음 버튼이 켜진다
  await p.goto(`/tech/jobs/${orderNo}/work/photos`);
  await photoInput(p, '작업 후').first().setInputFiles({ name: 'after.png', mimeType: 'image/png', buffer: PNG });
  await expect(p.locator('.ac-photo-slot img[alt$="작업 후 사진"]')).toHaveCount(1, { timeout: 30_000 });
  await expect(p.getByRole('link', { name: '다음: 처리 결과' })).toBeVisible();

  // 완료: 처리 내용이 짧으면 막힘 → 충분하면 완료
  await p.goto(`/tech/jobs/${orderNo}/work/complete`);
  await expect(p.getByText('사진·결과·안전 체크를 모두 마쳤습니다.')).toBeVisible({ timeout: 30_000 });
  const note = p.getByRole('textbox', { name: '처리 내용' });
  await note.fill('세척 완료');
  await expect(p.getByRole('button', { name: '작업 완료' })).toBeDisabled();
  await note.fill('벽걸이 에어컨 완전분해 세척을 마쳤습니다. 냉각핀과 송풍팬 곰팡이를 제거했습니다.');
  // 고객 서명
  const pad = p.getByRole('img', { name: '고객 서명 칸' });
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await p.mouse.move(box.x + 20, box.y + 40);
  await p.mouse.down();
  await p.mouse.move(box.x + 120, box.y + 90, { steps: 5 });
  await p.mouse.move(box.x + 220, box.y + 50, { steps: 5 });
  await p.mouse.up();
  await p.getByRole('button', { name: '작업 완료' }).click();
  await expect(p).toHaveURL(new RegExp(`/tech/jobs/${orderNo}$`), { timeout: 30_000 });

  const o = await orderRow();
  expect(o.status).toBe('WORK_DONE');
  expect(o.completed_at).not.toBeNull();
  const w = await workRow();
  expect(w).toMatchObject({ status: 'DONE', result_code: 'DONE_NORMAL', final_amount: o.total_amount });
  expect(w?.work_minutes).not.toBeNull();
  expect(w?.customer_signature_file_id).not.toBeNull();
  const hist = await sql<{ to_status: string; actor_type: string }[]>`
    SELECT h.to_status, h.actor_type FROM order_status_history h JOIN service_order o ON o.id = h.order_id WHERE o.order_no = ${orderNo} ORDER BY h.id`;
  expect(hist.map((h) => h.to_status)).toEqual(['RECEIVED', 'ASSIGNED', 'ON_THE_WAY', 'IN_PROGRESS', 'WORK_DONE']);
  expect(hist.slice(2).every((h) => h.actor_type === 'TECHNICIAN')).toBe(true);
  const [item] = await sql<{ item_status: string }[]>`
    SELECT i.item_status FROM order_item i JOIN service_order o ON o.id = i.order_id WHERE o.order_no = ${orderNo} AND i.item_type = 'PRODUCT'`;
  expect(item!.item_status).toBe('DONE');
  expect(await notified('WORK_DONE')).toBe(1);
  await expect(p.locator('.ac-live-banner')).toHaveCount(0);

  // T-WRK-070 활동내역
  await p.getByRole('button', { name: '활동내역 등록' }).click();
  const sheet = p.getByRole('dialog', { name: '활동내역 등록' });
  await sheet.getByRole('button', { name: '저장' }).click();
  await expect(sheet.getByText('유형은 필수 입력값입니다.')).toBeVisible();
  await sheet.getByRole('combobox', { name: '유형' }).selectOption('CALL');
  await sheet.getByRole('textbox', { name: '내용' }).fill('완료 후 고객에게 사용법 안내 통화');
  await sheet.getByRole('button', { name: '저장' }).click();
  await expect(p.getByText('완료 후 고객에게 사용법 안내 통화')).toBeVisible({ timeout: 30_000 });
  await p.context().close();
});

test('C-ORD-050 고객 작업 리포트: 전·후 사진·처리 내용·차기 권장, 사진은 본인만', async ({ browser }) => {
  await customer.goto(`/orders/${orderNo}`);
  await customer.getByRole('link', { name: '작업 리포트 보기 (전·후 사진)' }).click();
  await expect(customer.getByRole('heading', { name: '작업 리포트' })).toBeVisible({ timeout: 30_000 });
  await expect(customer.getByText('냉각핀과 송풍팬 곰팡이를 제거했습니다.', { exact: false })).toBeVisible();
  await expect(customer.getByText('다음 청소 권장')).toBeVisible();
  const imgs = customer.locator('.ac-photo-slot img');
  await expect(imgs).toHaveCount(2);
  const src = (await imgs.first().getAttribute('src'))!;
  expect((await customer.request.get(src)).status()).toBe(200);
  // 로그인하지 않은 사람·다른 사람은 받을 수 없다
  const anon = await browser.newContext();
  expect((await anon.request.get(src)).status()).toBe(401);
  await anon.close();
});
