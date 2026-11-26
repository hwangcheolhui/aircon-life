/**
 * 단계 7 완료 기준 (04 §2 단계 7 정산): 정산 회차를 계산하면 등급·계약형태별 배분, 2인 작업 분배, 추가요금 배분, 현금 상계, 원천세 3.3%가 맞게 나온다.
 * 기사 확인/이의 → 확정 후에는 수정되지 않고 다음 회차 조정으로만 처리된다(BR-080~084).
 * 기준 데이터는 SQL로 만든다: 지난주에 결제까지 끝난(COMPLETED, 정산 대상) 작업 2건 — ① 120,000원(추가요금 30,000) 앱 결제 ② 90,000원 2인 작업, 주기사 현금 수금.
 * 수수료 정책은 시드 기본 정책(기사 55% · 추가요금 70% · 지원기사 30% · 원천징수 3.3%).
 */
import { type Browser, expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';
import { E2E_ENV } from '../playwright.config';

test.describe.configure({ mode: 'serial' });

const sql = postgres(E2E_ENV.DATABASE_URL, { max: 1, onnotice: () => undefined });
// 테스트 전용 가상 번호(실제 개인정보 아님)
const MAIN = { code: 'T7-MAIN', name: '정산주기사', phone: '01077070001' };
const SUPPORT = { code: 'T7-SUP', name: '정산지원기사' };
const NO = { app: '2611167000S1', cash: '2611167000S2' };

let mainId = '';
let supportId = '';
let periodStart = '';
let batchNo = '';
let batchId = '';

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
  await p.getByRole('textbox', { name: '휴대폰 번호' }).fill(MAIN.phone);
  await p.getByRole('button', { name: '인증번호 받기' }).click();
  const code = ((await p.locator('.tec-mock-box strong').textContent()) ?? '').trim();
  await p.getByRole('textbox', { name: '인증번호' }).fill(code);
  await p.getByRole('button', { name: '로그인' }).click();
  await expect(p).toHaveURL(/\/tech$/, { timeout: 30_000 });
  return p;
}

type StlRow = {
  job_count: number;
  gross_sales: number;
  base_pay: number;
  extra_pay: number;
  incentive: number;
  deduction: number;
  cash_collected: number;
  taxable_amount: number;
  withholding_tax: number;
  net_pay: number;
  status: string;
};
const settlementOf = async (techId: string) =>
  (
    await sql<StlRow[]>`SELECT job_count, gross_sales, base_pay, extra_pay, incentive, deduction, cash_collected, taxable_amount,
      withholding_tax, net_pay, status FROM settlement WHERE batch_id = ${batchId} AND technician_id = ${techId}`
  )[0]!;
const batchStatus = async () => (await sql<{ status: string }[]>`SELECT status FROM settlement_batch WHERE id = ${batchId}`)[0]!.status;

test.afterAll(async () => {
  await sql.end();
});

test('준비: 기사 2명 + 지난주 결제 완료 작업 2건(추가요금·2인 작업·현금 수금)', async ({ page }) => {
  await sql`INSERT INTO branch (branch_code, name, status, phone) VALUES ('ST07', '정산거점', 'ACTIVE', '02-000-0007') ON CONFLICT (branch_code) DO NOTHING`;
  const [b] = await sql<{ id: string }[]>`SELECT id FROM branch WHERE branch_code = 'ST07'`;
  const branchId = b!.id;

  // 주기사는 화면으로 등록(기사 앱 로그인용), 지원기사는 SQL
  await adminLogin(page);
  await page.goto('/admin/tec/technicians');
  await page.getByRole('button', { name: '기사 등록' }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('textbox', { name: '기사 코드', exact: true }).fill(MAIN.code);
  await d.getByRole('textbox', { name: '이름', exact: true }).fill(MAIN.name);
  await d.getByRole('textbox', { name: '연락처', exact: true }).fill(MAIN.phone);
  await d.getByRole('combobox', { name: '소속 거점' }).selectOption({ label: '정산거점' });
  await d.getByRole('button', { name: '저장' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(page.locator('.ac-toast').filter({ hasText: '저장에 성공하였습니다.' }).last()).toBeVisible();
  const [m] = await sql<{ id: string }[]>`SELECT id FROM technician WHERE tech_code = ${MAIN.code}`;
  mainId = m!.id;
  await sql`UPDATE technician SET status = 'ACTIVE', grade = 'REGULAR', contract_type = 'FREELANCER' WHERE id = ${mainId}`;
  const [s] = await sql<{ id: string }[]>`INSERT INTO technician (tech_code, name, phone, branch_id, grade, contract_type, status)
    VALUES (${SUPPORT.code}, ${SUPPORT.name}, 'enc', ${branchId}, 'REGULAR', 'FREELANCER', 'ACTIVE') RETURNING id`;
  supportId = s!.id;

  const [c] = await sql<{ id: string }[]>`INSERT INTO customer (customer_no, customer_type, name, phone1, join_channel, privacy_agree_status, status)
    VALUES ('C2611167001', 'PERSONAL', 'enc', 'enc', 'APP', 'AGREED', 'ACTIVE') RETURNING id`;
  const [a] = await sql<{ id: string }[]>`INSERT INTO customer_address (customer_id, zipcode, road_address, branch_id)
    VALUES (${c!.id}, '00000', '정산로 7', ${branchId}) RETURNING id`;
  // 지난주 월요일(한국 날짜)과 그 주 수요일 10시에 결제 완료
  const [w] = await sql<{ mon: string }[]>`
    SELECT to_char(date_trunc('week', (now() AT TIME ZONE 'Asia/Seoul')::date) - interval '7 days', 'YYYY-MM-DD') AS mon`;
  periodStart = w!.mon;
  const doneAt = `${periodStart} 10:00:00+09`;

  const orders = [
    { no: NO.app, total: 120000, extra: 30000, method: 'CARD', collectedBy: null as string | null, support: false },
    { no: NO.cash, total: 90000, extra: 0, method: 'CASH', collectedBy: mainId, support: true },
  ];
  for (const o of orders) {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO service_order (order_no, customer_id, address_id, branch_id, channel, order_type, status, subtotal_amount, extra_amount, total_amount,
        paid_amount, payment_status, completed_at)
      VALUES (${o.no}, ${c!.id}, ${a!.id}, ${branchId}, 'APP', 'NORMAL', 'COMPLETED', ${o.total - o.extra}, ${o.extra}, ${o.total}, ${o.total}, 'PAID', ${doneAt}::timestamptz)
      RETURNING id`;
    const orderId = row!.id;
    await sql`INSERT INTO order_item (order_id, item_type, quantity, unit_price, amount, item_status) VALUES (${orderId}, 'PRODUCT', 1, ${o.total - o.extra}, ${o.total - o.extra}, 'DONE')`;
    await sql`INSERT INTO order_status_history (order_id, from_status, to_status, actor_type, created_at)
      VALUES (${orderId}, 'WORK_DONE', 'COMPLETED', 'SYSTEM', ${doneAt}::timestamptz)`;
    await sql`INSERT INTO assignment (order_id, technician_id, role, assign_method, status, accepted_at) VALUES (${orderId}, ${mainId}, 'MAIN', 'MANUAL', 'ACCEPTED', now())`;
    if (o.support)
      await sql`INSERT INTO assignment (order_id, technician_id, role, assign_method, status, accepted_at) VALUES (${orderId}, ${supportId}, 'SUPPORT', 'MANUAL', 'ACCEPTED', now())`;
    await sql`INSERT INTO work_order (order_id, main_technician_id, status, finished_at, labor_amount, extra_amount, final_amount, received_amount, is_settlement_target)
      VALUES (${orderId}, ${mainId}, 'DONE', ${doneAt}::timestamptz, ${o.total - o.extra}, ${o.extra}, ${o.total}, ${o.collectedBy ? o.total : 0}, true)`;
    await sql`INSERT INTO payment (payment_no, order_id, customer_id, payment_stage, method, amount, status, approved_at, collected_by_tech_id)
      VALUES (${'P7' + o.no}, ${orderId}, ${c!.id}, 'ONSITE', ${o.method}, ${o.total}, 'APPROVED', ${doneAt}::timestamptz, ${o.collectedBy})`;
  }
});

test('A-STL-010 수수료 정책: 기본 정책이 보이고 메뉴에 정산이 열린다', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/stl/policies');
  await expect(page.getByRole('heading', { name: '수수료 정책' })).toBeVisible();
  const row = page.locator('tbody tr').filter({ hasText: '기본 정책(전체)' });
  await expect(row).toContainText('55%');
  await expect(row).toContainText('3.3%');
});

test('A-STL-020 회차 생성(지난주) → 계산: 배분·2인 분배·추가요금·현금 상계·원천세(BR-080~083)', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/stl/batches');
  await page.getByRole('button', { name: '회차 생성' }).click();
  const d = page.getByRole('dialog', { name: '정산 회차 생성' });
  // 월요일이 아니면 막힌다(BR-080 월~일 집계)
  const [tue] = await sql<{ d: string }[]>`SELECT to_char(${periodStart}::date + 1, 'YYYY-MM-DD') AS d`;
  await d.getByLabel('정산 시작일(월요일)').fill(tue!.d);
  await d.getByRole('button', { name: '생성' }).click();
  await expect(d.getByText('정산 기간은 월요일부터 시작합니다(월~일 집계).')).toBeVisible();
  await d.getByLabel('정산 시작일(월요일)').fill(periodStart);
  await d.getByRole('button', { name: '생성' }).click();
  await expect(page.locator('.ac-toast').filter({ hasText: '회차를 만들었습니다.' }).last()).toBeVisible();
  const [b] = await sql<{ id: string; batch_no: string; status: string }[]>`SELECT id, batch_no, status FROM settlement_batch WHERE period_start = ${periodStart} AND branch_id IS NULL`;
  batchId = b!.id;
  batchNo = b!.batch_no;
  expect(batchNo).toMatch(/^S\d{4}-W\d{2}$/);
  expect(b!.status).toBe('DRAFT');

  const row = page.locator('tbody tr').filter({ hasText: batchNo });
  await row.getByRole('button', { name: '계산' }).click();
  await page.getByRole('dialog', { name: '정산을 계산하시겠습니까?' }).getByRole('button', { name: '계산' }).click();
  await expect(page.locator('.ac-toast').filter({ hasText: '계산했습니다.' }).last()).toBeVisible({ timeout: 30_000 });
  expect(await batchStatus()).toBe('CALCULATED');

  // 주기사: ① 90,000×55% = 49,500 + 추가 30,000×70% = 21,000 / ② 49,500 × (100−30)% = 34,650
  // 과세 105,150 → 원천세 3.3% = 3,469.95 → 10원 미만 절사 3,460 → 현금 상계 90,000 → 실지급 11,690
  expect(await settlementOf(mainId)).toEqual({
    job_count: 2,
    gross_sales: 210000,
    base_pay: 84150,
    extra_pay: 21000,
    incentive: 0,
    deduction: 0,
    cash_collected: 90000,
    taxable_amount: 105150,
    withholding_tax: 3460,
    net_pay: 11690,
    status: 'CALCULATED',
  });
  // 지원기사: 49,500 × 30% = 14,850 → 원천세 490 → 14,360
  expect(await settlementOf(supportId)).toMatchObject({ job_count: 1, base_pay: 14850, withholding_tax: 490, net_pay: 14360 });
  // 같은 작업은 한 번만 정산된다
  const [n] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM settlement_item si JOIN service_order o ON o.id = si.order_id
    WHERE o.order_no IN (${NO.app}, ${NO.cash}) AND si.item_type = 'JOB'`;
  expect(n!.n).toBe(3);
  // 기사에게 정산 확인 요청 알림
  const [req] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM notification_log l JOIN notification_template t ON t.id = l.template_id
    WHERE t.template_code = 'STL_CONFIRM_REQUEST' AND l.receiver_id IN (${mainId}, ${supportId})`;
  expect(req!.n).toBe(2);

  // F-SYS-10 주간 배치: 이미 계산된 지난주 회차는 다시 만들지 않는다
  const r = await page.request.get('/api/jobs/settlement-weekly', { headers: { authorization: `Bearer ${E2E_ENV.CRON_SECRET}` } });
  expect(await r.json()).toMatchObject({ ok: true, batchNo, created: false, calculated: false });
});

test('T-STL-010·020 기사 앱: 정산 카드 → 상세 건별 내역 → 이의 제기(사유 필수)', async ({ browser }) => {
  const p = await techLogin(browser);
  await p.getByRole('link', { name: '정산' }).click();
  await expect(p.getByRole('heading', { name: '정산' })).toBeVisible({ timeout: 30_000 });
  const card = p.locator('.tec-job-card').filter({ hasText: batchNo });
  await expect(card).toContainText('확인 대기');
  await expect(card).toContainText('11,690원');
  await card.click();
  await expect(p.getByRole('heading', { name: '정산 상세' })).toBeVisible({ timeout: 30_000 });
  await expect(p.locator('.tec-kv')).toContainText('−90,000원');
  await expect(p.locator('.tec-kv')).toContainText('−3,460원');
  await expect(p.getByText(NO.app)).toHaveCount(2); // 작업 배분 + 추가요금 배분
  await p.getByRole('button', { name: '이의 제기' }).click();
  const sheet = p.getByRole('dialog', { name: '이의 제기' });
  await sheet.getByRole('button', { name: '이의 보내기' }).click();
  await expect(sheet.getByText('이의 내용은 필수 입력값입니다.')).toBeVisible();
  await sheet.getByRole('textbox', { name: '이의 내용' }).fill('주말 고소작업 수당이 빠졌습니다.');
  await sheet.getByRole('button', { name: '이의 보내기' }).click();
  await expect(p.locator('.ac-toast').filter({ hasText: '이의를 보냈습니다.' }).last()).toBeVisible();
  expect((await settlementOf(mainId)).status).toBe('DISPUTED');
  await expect(p.getByRole('button', { name: '확인', exact: true })).toHaveCount(0);
});

test('A-STL-030 이의가 있으면 확정 불가 → 조정 추가(인센티브) → 이의 처리 → 회차 확정(BR-084)', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/stl/batches');
  const row = page.locator('tbody tr').filter({ hasText: batchNo });
  await row.getByRole('button', { name: '확정' }).click();
  await page.getByRole('dialog', { name: '정산 회차를 확정하시겠습니까?' }).getByRole('button', { name: '확정' }).click();
  await expect(page.getByText('이의 제기된 정산서 1건을 먼저 처리해 주세요.')).toBeVisible();

  await page.goto(`/admin/stl/settlements?batchId=${batchId}`);
  await page.locator('tbody tr').filter({ hasText: MAIN.name }).dblclick();
  await expect(page.getByText('기사 이의 내용: 주말 고소작업 수당이 빠졌습니다.')).toBeVisible();
  await page.getByRole('button', { name: '이 기사 조정 추가' }).click();
  const d = page.getByRole('dialog', { name: '조정 추가' });
  await d.getByRole('combobox', { name: '조정 구분' }).selectOption('INCENTIVE');
  await d.getByRole('textbox', { name: '금액(원)' }).fill('5000');
  await d.getByRole('button', { name: '저장' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(d.getByText('사유은(는) 필수 입력값입니다.').or(d.getByText('사유는 필수 입력값입니다.'))).toBeVisible();
  await d.getByRole('textbox', { name: '사유' }).fill('주말 고소작업 수당');
  await d.getByRole('button', { name: '저장' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(d).toBeHidden();
  // 과세 110,150 → 원천세 3,630 → 실지급 110,150 − 3,630 − 90,000 = 16,520
  expect(await settlementOf(mainId)).toMatchObject({ incentive: 5000, taxable_amount: 110150, withholding_tax: 3630, net_pay: 16520, status: 'DISPUTED' });

  await page.getByRole('button', { name: '이의 처리' }).click();
  const r = page.getByRole('dialog', { name: '이의 처리' });
  await r.getByRole('textbox', { name: '처리 내용' }).fill('인센티브 5,000원 반영');
  await r.getByRole('button', { name: '처리 완료' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(r).toBeHidden();
  await expect.poll(async () => (await settlementOf(mainId)).status).toBe('CONFIRMED');

  await page.goto('/admin/stl/batches');
  await page.locator('tbody tr').filter({ hasText: batchNo }).getByRole('button', { name: '확정' }).click();
  await page.getByRole('dialog', { name: '정산 회차를 확정하시겠습니까?' }).getByRole('button', { name: '확정' }).click();
  await expect(page.locator('.ac-toast').filter({ hasText: '확정 처리했습니다.' }).last()).toBeVisible();
  expect(await batchStatus()).toBe('CONFIRMED');
  expect((await settlementOf(supportId)).status).toBe('CONFIRMED'); // 미응답도 회차 확정 때 함께

  // BR-084 확정 후에는 화면에서 조정할 수 없고, DB도 금액 변경을 막는다
  await page.goto(`/admin/stl/settlements?batchId=${batchId}`);
  await expect(page.getByText('확정된 정산은 수정할 수 없습니다.')).toBeVisible();
  await expect(page.getByRole('button', { name: '조정 추가' })).toHaveCount(0);
  await expect(sql`UPDATE settlement SET net_pay = 0 WHERE batch_id = ${batchId} AND technician_id = ${mainId}`).rejects.toThrow(/BR-084/);
});

test('F-ADM-STL-04 지급 파일(감사 로그) → 지급 완료 → 기사 알림 → 마감', async ({ page }) => {
  await adminLogin(page);
  const file = await page.request.get(`/admin/stl/batches/${batchId}/transfer-file`);
  expect(file.status()).toBe(200);
  expect(file.headers()['content-type']).toContain('text/csv');
  expect(await file.text()).toContain('은행코드');
  const [audit] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE action = 'EXPORT' AND target_table = 'settlement_batch' AND target_id = ${batchId}`;
  expect(audit!.n).toBe(1);

  await page.goto('/admin/stl/batches');
  await page.locator('tbody tr').filter({ hasText: batchNo }).getByRole('button', { name: '지급 완료' }).click();
  const d = page.getByRole('dialog', { name: '지급 완료 처리' });
  await expect(d.getByText('계좌 없음')).toBeVisible(); // 테스트 기사는 계좌가 없다
  await d.getByRole('textbox', { name: '이체 참조번호' }).fill('BULK-0001');
  await d.getByRole('button', { name: '지급 완료' }).click();
  await expect(page.locator('.ac-toast').filter({ hasText: '지급 완료 처리했습니다.' }).last()).toBeVisible();
  expect(await batchStatus()).toBe('PAID');
  expect((await settlementOf(mainId)).status).toBe('PAID');
  const [paid] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM notification_log l JOIN notification_template t ON t.id = l.template_id
    WHERE t.template_code = 'STL_PAID' AND l.receiver_id IN (${mainId}, ${supportId})`;
  expect(paid!.n).toBe(2);
  const hist = await sql<{ to_status: string }[]>`SELECT to_status FROM settlement_status_history WHERE batch_id = ${batchId} AND settlement_id IS NULL ORDER BY id`;
  expect(hist.map((h) => h.to_status)).toEqual(['DRAFT', 'CALCULATED', 'CONFIRMED', 'PAID']);

  await page.locator('tbody tr').filter({ hasText: batchNo }).getByRole('button', { name: '마감' }).click();
  await page.getByRole('dialog', { name: '정산 회차를 마감하시겠습니까?' }).getByRole('button', { name: '마감' }).click();
  await expect(page.locator('.ac-toast').filter({ hasText: '마감 처리했습니다.' }).last()).toBeVisible();
  expect(await batchStatus()).toBe('CLOSED');
});
