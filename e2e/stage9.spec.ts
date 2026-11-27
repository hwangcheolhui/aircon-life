/**
 * 단계 9 완료 기준 (04 §2 단계 9 품질·편의 확장):
 * 내 기기(C-DEV-010)에서 원클릭 재예약이 되고, 저평점 후기(C-REV-010)가 VOC로 자동 생성된다(BR-090). 배정 보드(A-DSP-010)에 추천 기사 Top 3가 뜬다(F-ADM-DSP-02).
 * 함께 확인: 쿠폰 등록(A-CRM-030) → 고객 쿠폰함 코드 등록(C-MY-020), 후기 관리(A-VOC-040)·작업 결과 검수(A-PRC-030)·통계(A-STA-020~040)·코스 모니터링(A-DSP-070) 화면, 배치(후기 요청·휴면·PG 대사).
 * 연락처는 모두 테스트 전용 가상 번호다(실제 개인정보 아님).
 */
import { type Browser, expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';
import { encryptPii, hashPhone } from '../packages/domain/src/pii/crypto';
import { E2E_ENV } from '../playwright.config';

test.describe.configure({ mode: 'serial' });

const sql = postgres(E2E_ENV.DATABASE_URL, { max: 1, onnotice: () => undefined });
const enc = (v: string) => encryptPii(v, E2E_ENV.PII_ENCRYPTION_KEY);
const hash = (p: string) => hashPhone(p, E2E_ENV.PII_HASH_PEPPER);
const CUSTOMER_PHONE = '01099090001';
const TECH = { code: 'T9-MAIN', phone: '01099090002', name: '추천기사' };
const NO = { done: '2611169000Z1', waiting: '2611169000Z2' };
const DONG = '1138010400';
const kstDate = (plusDays = 0) => new Date(Date.now() + 9 * 3600_000 + plusDays * 86_400_000).toISOString().slice(0, 10);

let branchId = '';
let customerId = '';

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

async function customerPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  return ctx.newPage();
}

async function customerLogin(cu: Page, next: string) {
  await cu.goto(`/login?next=${encodeURIComponent(next)}`);
  await cu.getByRole('link', { name: '휴대폰 번호로 계속하기' }).click();
  await cu.getByRole('textbox', { name: '이름' }).fill('품질고객');
  await cu.getByRole('textbox', { name: '휴대폰 번호' }).fill(CUSTOMER_PHONE);
  await cu.getByRole('button', { name: '인증번호 받기' }).click();
  const code = ((await cu.locator('.cus-mock-box strong').textContent()) ?? '').trim();
  await cu.getByRole('textbox', { name: '인증번호' }).fill(code);
  await cu.getByRole('button', { name: '확인' }).click();
  await cu.waitForURL((u) => !u.pathname.startsWith('/login/phone'), { timeout: 30_000 });
  if (cu.url().includes('/login/terms')) {
    await cu.getByRole('checkbox', { name: '전체 동의' }).check();
    await cu.getByRole('button', { name: '동의하고 가입하기' }).click();
  }
  await cu.waitForURL((u) => u.pathname === next, { timeout: 30_000 });
}

const job = async (page: Page, path: string) => {
  const r = await page.request.get(`/api/jobs/${path}`, { headers: { authorization: `Bearer ${E2E_ENV.CRON_SECRET}` } });
  expect(r.ok()).toBeTruthy();
  return (await r.json()) as Record<string, unknown>;
};

test('준비: 서비스 지역·상품·가격, 고객 가입 + 등록 기기, 기사(근무·숙련·관할), 완료 주문·배정 대기 주문', async ({ browser }) => {
  await sql`INSERT INTO branch (branch_code, name, status) VALUES ('EP01', '은평거점', 'ACTIVE') ON CONFLICT (branch_code) DO NOTHING`;
  const [b] = await sql<{ id: string }[]>`SELECT id FROM branch WHERE branch_code = 'EP01'`;
  branchId = b!.id;
  await sql`INSERT INTO service_area (branch_id, sido, sigungu, eupmyeondong, legal_dong_code, is_serviceable)
    VALUES (${branchId}, '서울특별시', '은평구', '불광동', ${DONG}, true) ON CONFLICT (legal_dong_code) DO NOTHING`;
  await sql`INSERT INTO service_category (code, name) VALUES ('AIRCON_CLEAN', '에어컨 청소') ON CONFLICT (code) DO NOTHING`;
  const [cat] = await sql<{ id: string }[]>`SELECT id FROM service_category WHERE code = 'AIRCON_CLEAN'`;
  await sql`INSERT INTO service_product (category_id, product_code, name, device_type, clean_level, base_duration_min)
    VALUES (${cat!.id}, 'AC-WALL-FULL', '벽걸이 완전분해 세척', 'WALL', 'FULL', 90) ON CONFLICT (product_code) DO NOTHING`;
  const [p] = await sql<{ id: string }[]>`SELECT id FROM service_product WHERE product_code = 'AC-WALL-FULL'`;
  // 앞 단계 E2E가 만든 벽걸이 FULL 상품(가격 없음)도 견적 엔진이 고를 수 있으므로 공통 단가를 채워 둔다
  await sql`INSERT INTO price_policy (product_id, branch_id, unit_price, valid_from)
    SELECT sp.id, NULL, 90000, '2026-01-01' FROM service_product sp
    WHERE sp.device_type = 'WALL' AND sp.clean_level = 'FULL' AND NOT EXISTS (SELECT 1 FROM price_policy pp WHERE pp.product_id = sp.id AND pp.branch_id IS NULL)`;

  const cu = await customerPage(browser);
  await customerLogin(cu, '/my/devices');
  const [c] = await sql<{ id: string }[]>`SELECT id FROM customer WHERE phone1_hash = ${hash(CUSTOMER_PHONE)}`;
  customerId = c!.id;
  await cu.context().close();

  const [a] = await sql<{ id: string }[]>`INSERT INTO customer_address (customer_id, zipcode, road_address, legal_dong_code, branch_id, is_default)
    VALUES (${customerId}, '00000', '서울 은평구 불광로 9', ${DONG}, ${branchId}, true) RETURNING id`;
  await sql`INSERT INTO customer_device (customer_id, address_id, device_type, location_in_house, last_cleaned_at, recommend_months)
    VALUES (${customerId}, ${a!.id}, 'WALL', '거실', (now() - interval '13 months')::date, 12)`;

  const [t] = await sql<{ id: string }[]>`INSERT INTO technician (tech_code, login_id, name, phone, branch_id, grade, contract_type, status)
    VALUES (${TECH.code}, ${hash(TECH.phone)}, ${TECH.name}, ${enc(TECH.phone)}, ${branchId}, 'REGULAR', 'FREELANCER', 'ACTIVE') RETURNING id`;
  await sql`INSERT INTO work_schedule (technician_id, work_date, schedule_type)
    SELECT ${t!.id}, d::date, 'WORK' FROM generate_series((now() AT TIME ZONE 'Asia/Seoul')::date, (now() AT TIME ZONE 'Asia/Seoul')::date + 5, '1 day') d
    ON CONFLICT (technician_id, work_date) DO UPDATE SET schedule_type = 'WORK'`;
  await sql`INSERT INTO technician_skill (technician_id, device_type, skill_level) VALUES (${t!.id}, 'WALL', 'CAN_SOLO') ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO technician_area (technician_id, legal_dong_code, priority) VALUES (${t!.id}, ${DONG}, 1) ON CONFLICT DO NOTHING`;

  const order = async (no: string, status: string, extra: { completed?: string; promised?: string }) => {
    const [o] = await sql<{ id: string }[]>`
      INSERT INTO service_order (order_no, customer_id, address_id, branch_id, channel, order_type, status, subtotal_amount, total_amount, paid_amount,
        payment_status, completed_at, promised_at, requested_date)
      VALUES (${no}, ${customerId}, ${a!.id}, ${branchId}, 'APP', 'NORMAL', ${status}, 90000, 90000, ${status === 'COMPLETED' ? 90000 : 0},
        ${status === 'COMPLETED' ? 'PAID' : 'UNPAID'}, ${extra.completed ?? null}::timestamptz, ${extra.promised ?? null}::timestamptz,
        ${extra.promised ? extra.promised.slice(0, 10) : null}::date)
      RETURNING id`;
    await sql`INSERT INTO order_item (order_id, item_type, product_id, quantity, unit_price, amount, item_status)
      VALUES (${o!.id}, 'PRODUCT', ${p!.id}, 1, 90000, 90000, ${status === 'COMPLETED' ? 'DONE' : 'READY'})`;
    return o!.id;
  };
  const done = await order(NO.done, 'COMPLETED', { completed: new Date(Date.now() - 86_400_000).toISOString() });
  await sql`INSERT INTO assignment (order_id, technician_id, role, assign_method, status, accepted_at) VALUES (${done}, ${t!.id}, 'MAIN', 'MANUAL', 'ACCEPTED', now())`;
  await sql`INSERT INTO work_order (order_id, main_technician_id, status, started_at, finished_at, work_minutes, final_amount)
    VALUES (${done}, ${t!.id}, 'DONE', now() - interval '26 hours', now() - interval '25 hours', 60, 90000)`;
  await order(NO.waiting, 'ASSIGN_WAIT', { promised: `${kstDate(1)}T10:00:00+09:00` });
});

test('C-DEV-010 내 기기에서 원클릭 재예약 → 같은 기기로 견적이 만들어지고 예약 단계로 간다 (F-CUS-DEV-02)', async ({ browser }) => {
  const cu = await customerPage(browser);
  await customerLogin(cu, '/my/devices');
  await expect(cu.getByRole('heading', { name: '내 기기' })).toBeVisible();
  await expect(cu.getByText('청소할 때예요')).toBeVisible();
  await cu.getByRole('checkbox', { name: '벽걸이 · 거실 다시 예약에 담기' }).check();
  await cu.getByRole('button', { name: '1대 다시 예약' }).click();
  await expect(cu).toHaveURL(/\/reserve\/Q\d{10}$/, { timeout: 30_000 });
  const quoteNo = cu.url().split('/').pop()!;
  const [q] = await sql<{ customer_id: string; linked: number }[]>`
    SELECT q.customer_id, (SELECT count(*)::int FROM quote_item i WHERE i.quote_id = q.id AND i.customer_device_id IS NOT NULL) AS linked
    FROM quote q WHERE q.quote_no = ${quoteNo}`;
  expect(q?.customer_id).toBe(customerId);
  expect(q?.linked).toBe(1);
  await cu.context().close();
});

test('BR-090 저평점 후기(C-REV-010) → VOC 자동 생성 → 후기 관리(A-VOC-040)에서 VOC로 이어진다', async ({ browser, page }) => {
  const cu = await customerPage(browser);
  await customerLogin(cu, `/orders/${NO.done}/review`);
  await cu.getByRole('group', { name: '별점' }).getByRole('button', { name: '1점' }).click();
  await cu.getByRole('textbox', { name: '내용' }).fill('약속 시간보다 많이 늦었어요.');
  await cu.getByRole('button', { name: '후기 남기기' }).click();
  await cu.getByRole('dialog', { name: '후기를 등록하시겠습니까?' }).getByRole('button', { name: '등록' }).click();
  await expect(cu.getByText('소중한 후기 고마워요')).toBeVisible({ timeout: 30_000 });
  await cu.context().close();

  const [v] = await sql<{ channel: string; voc_type: string; severity: string | null; linked: boolean }[]>`
    SELECT v.channel, v.voc_type, v.severity, r.voc_id = v.id AS linked
    FROM review r JOIN service_order o ON o.id = r.order_id JOIN voc v ON v.id = r.voc_id WHERE o.order_no = ${NO.done}`;
  expect([v?.channel, v?.voc_type, v?.linked]).toEqual(['REVIEW', 'COMPLAINT', true]);
  const [tr] = await sql<{ rating: string }[]>`SELECT rating_avg::text AS rating FROM technician WHERE tech_code = ${TECH.code}`;
  expect(Number(tr?.rating)).toBe(1);

  await adminLogin(page);
  await page.goto('/admin/voc/reviews?maxRating=2');
  const row = page.locator('tbody tr', { hasText: NO.done });
  await expect(row).toContainText('VOC');
  await row.dblclick();
  const d = page.getByRole('dialog', { name: '후기 답글·숨김' });
  await d.getByRole('textbox', { name: '답글' }).fill('불편을 드려 죄송합니다. 담당자가 연락드릴게요.');
  await d.getByRole('button', { name: '저장' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(page.locator('.ac-toast').filter({ hasText: '저장에 성공하였습니다.' }).last()).toBeVisible();
  await expect(page.locator('tbody tr', { hasText: NO.done })).toContainText('답글');
});

test('F-ADM-DSP-02 배정 보드 배정 창에 추천 기사 Top 3가 뜨고 [주기사로]로 고른다', async ({ page }) => {
  await adminLogin(page);
  await page.goto(`/admin/dsp/board?branchId=${branchId}&date=${kstDate(1)}`);
  const card = page.getByRole('article', { name: `${NO.waiting} 배정 대기` });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button', { name: '배정' }).click();
  const dlg = page.getByRole('dialog', { name: '기사 배정' });
  const rec = dlg.getByRole('region', { name: '추천 기사' });
  await expect(rec.getByText('추천 기사 Top 3')).toBeVisible();
  const item = rec.locator('li', { hasText: TECH.name });
  await expect(item).toContainText('주 관할');
  await expect(item).toContainText('숙련 100%');
  await item.getByRole('button', { name: '주기사로' }).click();
  await expect(item.getByRole('button', { name: '선택됨' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dlg.getByLabel('주기사')).not.toHaveValue('');
});

test('A-CRM-030 쿠폰 등록 → C-MY-020 쿠폰함에 코드로 받는다 (F-CUS-CPN-01, 고객당 1장)', async ({ browser, page }) => {
  await adminLogin(page);
  await page.goto('/admin/crm/coupons');
  await page.getByRole('button', { name: '쿠폰 등록' }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('textbox', { name: '쿠폰 코드' }).fill('WELCOME9');
  await d.getByRole('textbox', { name: '쿠폰명' }).fill('재방문 5천원');
  await d.getByRole('textbox', { name: '할인 값' }).fill('5000');
  await d.getByLabel('사용 종료일').fill(kstDate(60));
  await d.getByRole('button', { name: '저장' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(page.locator('tbody')).toContainText('WELCOME9');

  const cu = await customerPage(browser);
  await customerLogin(cu, '/my/coupons');
  await cu.getByRole('textbox', { name: '쿠폰 코드' }).fill('welcome9');
  await cu.getByRole('button', { name: '등록' }).click();
  await expect(cu.getByText('재방문 5천원', { exact: true })).toBeVisible({ timeout: 30_000 });
  await cu.getByRole('textbox', { name: '쿠폰 코드' }).fill('WELCOME9');
  await cu.getByRole('button', { name: '등록' }).click();
  await expect(cu.locator('.ac-alert')).toContainText('이미');
  await cu.context().close();
});

test('A-PRC-030 검수 반려 → 사유 필수·기사 알림 / 통계·모니터링 화면이 열린다', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/prc/inspections');
  const row = page.locator('tbody tr', { hasText: NO.done });
  await expect(row).toContainText('검수 대기');
  await row.dblclick();
  const d = page.getByRole('dialog', { name: '작업 결과 검수' });
  await d.getByRole('button', { name: '반려(재작업)' }).click();
  await expect(d.locator('.ac-alert')).toContainText('사유');
  await d.getByRole('textbox', { name: '검수 메모' }).fill('작업 후 사진이 부족합니다.');
  await d.getByRole('button', { name: '반려(재작업)' }).click();
  await expect(page.locator('.ac-toast').filter({ hasText: '저장에 성공하였습니다.' }).last()).toBeVisible();
  const [w] = await sql<{ s: string; n: number }[]>`
    SELECT w.inspection_status AS s,
      (SELECT count(*)::int FROM notification_log l JOIN notification_template t ON t.id = l.template_id WHERE t.template_code = 'INSPECTION_REJECTED' AND l.receiver_type = 'TECHNICIAN') AS n
    FROM work_order w JOIN service_order o ON o.id = w.order_id WHERE o.order_no = ${NO.done}`;
  expect([w?.s, w?.n]).toEqual(['REJECTED', 1]);

  for (const [path, heading] of [
    ['/admin/sta/operations', '운영 통계'],
    ['/admin/sta/technicians', '기사 성과'],
    ['/admin/sta/customers', '고객·CRM 통계'],
    ['/admin/dsp/monitor', '코스 모니터링'],
    ['/admin/crm/campaigns', '캠페인 관리'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible({ timeout: 30_000 });
  }
  await expect(page.locator('tbody')).toHaveCount(0); // 캠페인 없음
});

test('배치: 후기 요청·휴면(기본 사용 안 함)·PG 대사·예약 캠페인이 돈다', async ({ page }) => {
  const r = await job(page, 'review-request');
  expect(r.ok).toBe(true);
  expect(await job(page, 'dormant')).toMatchObject({ ok: true, enabled: false });
  expect(await job(page, 'pg-reconcile')).toMatchObject({ ok: true, mismatches: 0 });
  expect(await job(page, 'campaign-send')).toMatchObject({ ok: true, campaigns: 0 });
});
