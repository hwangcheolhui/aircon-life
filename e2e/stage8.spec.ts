/**
 * 단계 8 완료 기준 (04 §2 단계 8 사후관리·운영 마감):
 * 보증기간 내 AS 요청 → 무상 재방문 주문이 배정 보드에 올라가고, 언론·인터넷이 선택된 안전사고는 재확인 후 경영진에게 통보된다.
 * 11개월 지난 고객이 매일 추출되고, KPI 대시보드가 ERD §5 지표를 보여 주며, 개인정보 파기 배치가 돈다.
 * 함께 확인: 1:1 문의 답변(C-CS-020 ↔ A-CSL-080), 독촉·전달 → 기사 회신(A-CSL-030 → T-NTF-020 → A-PRC-060), VOC 카드 완료 조건, 공지 팝업·읽음.
 * 연락처는 모두 테스트 전용 가상 번호다(실제 개인정보 아님).
 */
import { type Browser, expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { encryptPii, hashPhone } from '../packages/domain/src/pii/crypto';
import { E2E_ENV } from '../playwright.config';

test.describe.configure({ mode: 'serial' });

const sql = postgres(E2E_ENV.DATABASE_URL, { max: 1, onnotice: () => undefined });
const enc = (v: string) => encryptPii(v, E2E_ENV.PII_ENCRYPTION_KEY);
const hash = (p: string) => hashPhone(p, E2E_ENV.PII_HASH_PEPPER);
const CUSTOMER_PHONE = '01088080001';
const TECH = { code: 'T8-MAIN', phone: '01088080002' };
const NO = { done: '2611168000Z1', active: '2611168000Z2', old: '2611168000Z3' };
const kstDate = (plusDays = 0) => new Date(Date.now() + 9 * 3600_000 + plusDays * 86_400_000).toISOString().slice(0, 10);

let branchId = '';
let customerId = '';
let activeOrderId = '';
let revisitCustomerNo = '';
let purgeCustomerId = '';

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

async function confirmSave(page: Page, toast = '저장에 성공하였습니다.') {
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(page.locator('.ac-toast').filter({ hasText: toast }).last()).toBeVisible();
}

async function customerPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  return ctx.newPage();
}

async function customerLogin(cu: Page, next: string) {
  await cu.goto(`/login?next=${encodeURIComponent(next)}`);
  await cu.getByRole('link', { name: '휴대폰 번호로 계속하기' }).click();
  await cu.getByRole('textbox', { name: '이름' }).fill('사후고객');
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

/** 상담 콘솔에서 고객 확정 (동의 팝업·확인 Alert 은 닫는다) */
async function openConsole(page: Page) {
  await page.goto('/admin/csl/console');
  const area = page.getByRole('region', { name: '고객', exact: true });
  await area.getByLabel('전화1').fill(CUSTOMER_PHONE);
  await area.getByLabel('전화1').press('Enter');
  const dialog = page.getByRole('dialog', { name: '고객정보 조회' });
  await dialog.locator('tbody tr').first().dblclick();
  await expect(area).toContainText('고객님');
  const consent = page.getByRole('dialog', { name: '개인정보 수집 동의' });
  if (await consent.isVisible().catch(() => false)) await consent.getByRole('button', { name: '동의', exact: true }).click();
  const alert = page.getByRole('dialog', { name: '확인이 필요합니다' });
  while (await alert.isVisible().catch(() => false)) await alert.getByRole('button', { name: '확인' }).click();
}

const job = async (page: Page, path: string) => {
  const r = await page.request.get(`/api/jobs/${path}`, { headers: { authorization: `Bearer ${E2E_ENV.CRON_SECRET}` } });
  expect(r.ok()).toBeTruthy();
  return (await r.json()) as Record<string, unknown>;
};

test('준비: 고객 앱 가입 + 거점·기사·완료 주문(보증 30일)·진행 중 주문·슬롯', async ({ browser }) => {
  await sql`INSERT INTO branch (branch_code, name, status, phone) VALUES ('AS08', '사후거점', 'ACTIVE', '02-000-0008') ON CONFLICT (branch_code) DO NOTHING`;
  const [b] = await sql<{ id: string }[]>`SELECT id FROM branch WHERE branch_code = 'AS08'`;
  branchId = b!.id;
  const [role] = await sql<{ id: string }[]>`SELECT id FROM role WHERE role_code = 'ADM_BRANCH'`;
  await sql`INSERT INTO admin_user (auth_user_id, login_id, name, email, role_id, branch_id, status)
    VALUES (${randomUUID()}, 'as08mgr', '사후거점장', 'as08@example.invalid', ${role!.id}, ${branchId}, 'ACTIVE') ON CONFLICT (login_id) DO NOTHING`;

  const cu = await customerPage(browser);
  await customerLogin(cu, '/cs/inquiries');
  const [c] = await sql<{ id: string }[]>`SELECT id FROM customer WHERE phone1_hash = ${hash(CUSTOMER_PHONE)}`;
  customerId = c!.id;
  await cu.context().close();

  const [a] = await sql<{ id: string }[]>`INSERT INTO customer_address (customer_id, zipcode, road_address, branch_id, is_default)
    VALUES (${customerId}, '00000', '사후로 8', ${branchId}, true) RETURNING id`;
  await sql`INSERT INTO service_category (code, name) VALUES ('AIRCON_CLEAN', '에어컨 청소') ON CONFLICT (code) DO NOTHING`;
  const [cat] = await sql<{ id: string }[]>`SELECT id FROM service_category WHERE code = 'AIRCON_CLEAN'`;
  await sql`INSERT INTO service_product (category_id, product_code, name, device_type, clean_level, base_duration_min, warranty_days)
    VALUES (${cat!.id}, 'AC-WALL-AS8', '벽걸이 세척(AS 시험)', 'WALL', 'FULL', 60, 30) ON CONFLICT (product_code) DO NOTHING`;
  const [p] = await sql<{ id: string }[]>`SELECT id FROM service_product WHERE product_code = 'AC-WALL-AS8'`;
  const [t] = await sql<{ id: string }[]>`INSERT INTO technician (tech_code, login_id, name, phone, branch_id, grade, contract_type, status)
    VALUES (${TECH.code}, ${hash(TECH.phone)}, '사후기사', ${enc(TECH.phone)}, ${branchId}, 'REGULAR', 'FREELANCER', 'ACTIVE') RETURNING id`;

  const order = async (no: string, status: string, extra: { completed?: string; promised?: string }) => {
    const [o] = await sql<{ id: string }[]>`
      INSERT INTO service_order (order_no, customer_id, address_id, branch_id, channel, order_type, status, subtotal_amount, total_amount, paid_amount,
        payment_status, completed_at, promised_at)
      VALUES (${no}, ${customerId}, ${a!.id}, ${branchId}, 'APP', 'NORMAL', ${status}, 90000, 90000, ${status === 'COMPLETED' ? 90000 : 0},
        ${status === 'COMPLETED' ? 'PAID' : 'UNPAID'}, ${extra.completed ?? null}::timestamptz, ${extra.promised ?? null}::timestamptz)
      RETURNING id`;
    await sql`INSERT INTO order_item (order_id, item_type, product_id, quantity, unit_price, amount, item_status)
      VALUES (${o!.id}, 'PRODUCT', ${p!.id}, 1, 90000, 90000, ${status === 'COMPLETED' ? 'DONE' : 'READY'})`;
    await sql`INSERT INTO assignment (order_id, technician_id, role, assign_method, status, accepted_at) VALUES (${o!.id}, ${t!.id}, 'MAIN', 'MANUAL', 'ACCEPTED', now())`;
    return o!.id;
  };
  await order(NO.done, 'COMPLETED', { completed: new Date(Date.now() - 5 * 86_400_000).toISOString() });
  activeOrderId = await order(NO.active, 'ASSIGNED', { promised: `${kstDate(2)}T14:00:00+09:00` });
  for (let d = 1; d <= 3; d++) {
    for (let h = 9; h <= 17; h++) {
      await sql`INSERT INTO time_slot (branch_id, slot_date, slot_hour, slot_kind, capacity) VALUES (${branchId}, ${kstDate(d)}, ${h}, 'NORMAL', 5) ON CONFLICT DO NOTHING`;
    }
  }
});

test('C-CS-020 1:1 문의 → A-CSL-080 답변 → 고객 화면에 답변이 보인다 (F-CUS-CS-02)', async ({ browser, page }) => {
  const cu = await customerPage(browser);
  await customerLogin(cu, '/cs/inquiries');
  await cu.getByRole('combobox', { name: '문의 유형' }).selectOption({ label: '가격 문의' });
  await cu.getByRole('textbox', { name: '문의 내용' }).fill('벽걸이 두 대면 할인되나요?');
  await cu.getByRole('button', { name: '보내기' }).click();
  await expect(cu.getByText('벽걸이 두 대면 할인되나요?')).toBeVisible();
  await expect(cu.getByText('답변 대기')).toBeVisible();

  await adminLogin(page);
  await page.goto('/admin/csl/inquiries');
  await page.locator('tbody tr', { hasText: '벽걸이 두 대면' }).dblclick();
  const d = page.getByRole('dialog', { name: /^문의 / });
  await d.getByRole('textbox', { name: '답변' }).fill('두 대부터 대당 5천 원 할인돼요.');
  await d.getByRole('button', { name: '답변 등록' }).click();
  await confirmSave(page);

  await cu.reload();
  await expect(cu.getByText('두 대부터 대당 5천 원 할인돼요.')).toBeVisible();
  await expect(cu.getByText('답변 완료')).toBeVisible();
  await cu.context().close();
});

test('BR-050 보증기간 내 AS 요청(C-AS-010) → 승인 → 무상 재방문 주문이 배정 보드에 올라간다 (A-VOC-030)', async ({ browser, page }) => {
  const cu = await customerPage(browser);
  await customerLogin(cu, `/orders/${NO.done}`);
  await cu.getByRole('link', { name: 'AS 요청' }).click();
  await expect(cu.getByText('무상으로 다시 봐 드려요')).toBeVisible();
  await cu.getByRole('button', { name: '물이 샘' }).click();
  await cu.getByRole('textbox', { name: '내용' }).fill('청소 후 실내기에서 물이 떨어져요.');
  await cu.getByRole('button', { name: 'AS 요청하기' }).click();
  await cu.getByRole('dialog', { name: 'AS를 요청하시겠습니까?' }).getByRole('button', { name: '요청' }).click();
  await expect(cu.getByText('AS 요청을 접수했어요')).toBeVisible({ timeout: 30_000 });
  // BR-051 진행 중 AS 가 있으면 다시 요청할 수 없다
  await expect(cu.getByRole('button', { name: 'AS 요청하기' })).toHaveCount(0);
  await cu.context().close();

  await adminLogin(page);
  await page.goto('/admin/voc/as');
  const row = page.locator('tbody tr', { hasText: NO.done });
  await expect(row).toContainText('무상');
  await row.dblclick();
  let d = page.getByRole('dialog', { name: /^AS A/ });
  await expect(d.getByRole('checkbox', { name: /무상 AS로 승인/ })).toBeChecked();
  await d.getByRole('button', { name: '승인' }).click();
  await confirmSave(page);
  await page.locator('tbody tr', { hasText: NO.done }).dblclick();
  d = page.getByRole('dialog', { name: /^AS A/ });
  await d.getByRole('button', { name: '재방문 주문 생성' }).click();
  await page.getByRole('dialog', { name: '재방문 주문을 만드시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(page.locator('.ac-toast').filter({ hasText: '재방문 주문' }).last()).toBeVisible();

  const [n] = await sql<{ order_no: string; total_amount: number; status: string; order_type: string }[]>`
    SELECT o.order_no, o.total_amount, o.status, o.order_type FROM service_order o JOIN service_order p ON p.id = o.parent_order_id WHERE p.order_no = ${NO.done}`;
  expect([n!.total_amount, n!.status, n!.order_type]).toEqual([0, 'RECEIVED', 'AS']);
  const [a] = await sql<{ status: string }[]>`SELECT a.status FROM as_request a JOIN service_order o ON o.id = a.original_order_id WHERE o.order_no = ${NO.done}`;
  expect(a!.status).toBe('SCHEDULED');
  await page.goto(`/admin/dsp/board?branchId=${branchId}&date=${kstDate(1)}`);
  await expect(page.getByText(n!.order_no).first()).toBeVisible();
});

test('A-CSL-030 출장 독촉 → 기사 앱 T-NTF-020 확인·회신 → A-PRC-060 회신 확인 (F-ADM-CSL-11·F-TEC-NTF-02·F-ADM-PRC-08)', async ({ browser, page }) => {
  await adminLogin(page);
  await openConsole(page);
  await page.getByRole('tab', { name: '독촉/전달' }).click();
  await page.getByRole('button', { name: '출장 독촉' }).click();
  await page.getByRole('combobox', { name: '대상 주문' }).selectOption(String(activeOrderId));
  await page.getByRole('textbox', { name: '전달 내용' }).fill('고객님이 도착 시간을 다시 알려 달라고 하십니다.');
  await page.getByRole('button', { name: '보내기' }).click();
  await page.getByRole('dialog', { name: '보내시겠습니까?' }).getByRole('button', { name: '보내기' }).click();
  await expect(page.locator('.ac-toast').filter({ hasText: '저장에 성공하였습니다.' }).last()).toBeVisible();

  const tp = await techLogin(browser);
  await expect(tp.getByText(/회신할 독촉·전달이/)).toBeVisible();
  await tp.goto('/tech/notifications');
  await tp.getByRole('link', { name: /도착 시간을 다시/ }).click();
  await tp.getByRole('textbox', { name: '회신' }).fill('14시 10분 도착 예정입니다.');
  await tp.getByRole('button', { name: '회신 보내기' }).click();
  await expect(tp.getByText('14시 10분 도착 예정입니다.')).toBeVisible();
  await tp.context().close();

  const [f] = await sql<{ status: string; read_at: Date | null; followup_count: number }[]>`SELECT status, read_at, followup_count FROM followup_request WHERE target_order_id = ${activeOrderId}`;
  expect([f!.status, f!.read_at !== null, f!.followup_count]).toEqual(['REPLIED', true, 1]);
  await page.goto('/admin/prc/followups');
  const row = page.locator('tbody tr', { hasText: '도착 시간을 다시' });
  await expect(row).toContainText('회신');
  await row.dblclick();
  await expect(page.getByRole('dialog')).toContainText('14시 10분 도착 예정입니다.');
});

test('BR-060·061 안전사고에 언론 선택 → 재확인 후 접수 → 거점장 + 경영진 통보 (A-CSL-040 → A-VOC-020)', async ({ page }) => {
  await adminLogin(page);
  await openConsole(page);
  await page.getByRole('tab', { name: '안전사고' }).click();
  await page.getByRole('combobox', { name: '피해 유형' }).selectOption({ label: '누수' });
  await page.getByRole('textbox', { name: '발생 경위' }).fill('세척 후 배수 호스가 빠져 거실 바닥이 젖음');
  await page.getByRole('textbox', { name: '피해 내용' }).fill('마루 일부 들뜸');
  await page.getByRole('checkbox', { name: '언론' }).check();
  await expect(page.getByText('경영진에게도 바로 통보됩니다')).toBeVisible();
  await page.getByRole('button', { name: '접수' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  const esc = page.getByRole('dialog', { name: '경영진에게 통보됩니다. 계속하시겠습니까?' });
  await expect(esc).toContainText('언론');
  await esc.getByRole('button', { name: '통보하고 접수' }).click();
  await expect(page.locator('.ac-toast').filter({ hasText: '사고번호' }).last()).toBeVisible();

  const [i] = await sql<{ id: string; is_escalated: boolean; branch_id: string }[]>`SELECT id, is_escalated, branch_id FROM safety_incident WHERE customer_id = ${customerId}`;
  expect(i!.is_escalated).toBe(true);
  expect(String(i!.branch_id)).toBe(String(branchId));
  const types = await sql<{ recipient_type: string; notify_result: string }[]>`SELECT recipient_type, notify_result FROM incident_recipient WHERE incident_id = ${i!.id} ORDER BY recipient_type`;
  expect(types.map((r) => r.recipient_type)).toEqual(expect.arrayContaining(['BRANCH_MANAGER', 'EXECUTIVE']));
  expect(types.every((r) => r.notify_result === 'SENT')).toBe(true);

  await page.goto('/admin/voc/incidents');
  const row = page.locator('tbody tr').filter({ hasText: '경영진 통보' }).first();
  await expect(row).toContainText('누수');
  await row.dblclick();
  await expect(page.getByRole('dialog')).toContainText('사후거점장');
});

test('A-VOC-010/011 VOC 등록 → 불만 VOC 완료는 원인·고객 조치가 있어야 하고 처리 이력이 남는다 (F-ADM-VOC-01)', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/voc/vocs');
  await page.getByRole('button', { name: 'VOC 등록' }).click();
  const d = page.getByRole('dialog', { name: 'VOC 등록' });
  await d.getByRole('textbox', { name: '접수번호' }).fill(NO.done);
  await d.getByRole('textbox', { name: '제목' }).fill('기사 응대 불만');
  await d.getByRole('textbox', { name: '내용' }).fill('설명 없이 작업을 마쳤다고 하심');
  await d.getByRole('button', { name: '저장' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(page).toHaveURL(/\/admin\/voc\/vocs\/\d+$/, { timeout: 30_000 });
  await page.getByRole('combobox', { name: '진행 상태' }).selectOption({ label: '완료' });
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.locator('.ac-alert')).toContainText('원인은 필수 입력값입니다.');
  await page.getByRole('textbox', { name: '원인' }).fill('작업 후 설명 누락');
  await page.getByRole('textbox', { name: '고객 조치' }).fill('사과 전화 + 재교육');
  await page.getByRole('button', { name: '저장' }).click();
  await confirmSave(page);
  await expect(page.getByText('저장에 성공하였습니다.')).toBeVisible();
  await expect.poll(async () => {
    const [h] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM voc_history h JOIN voc v ON v.id = h.voc_id WHERE v.title = '기사 응대 불만'`;
    return h!.n;
  }).toBe(2);
});

test('BR-091 F-SYS-11 집계 → A-CRM-010 대상 미리보기 → F-SYS-06 재방문 안내 발송', async ({ page }) => {
  // 12개월 전 작업한 마케팅 동의 고객(가상 번호)
  const [c] = await sql<{ id: string; customer_no: string }[]>`
    INSERT INTO customer (customer_no, customer_type, name, phone1, phone1_hash, join_channel, privacy_agree_status, marketing_agree, status)
    VALUES ('C2611168002', 'PERSONAL', ${enc('재방문고객')}, ${enc('01088080003')}, ${hash('01088080003')}, 'APP', 'AGREED', true, 'ACTIVE') RETURNING id, customer_no`;
  revisitCustomerNo = c!.customer_no;
  const [a] = await sql<{ id: string }[]>`INSERT INTO customer_address (customer_id, zipcode, road_address, branch_id, is_default) VALUES (${c!.id}, '00000', '재방문로 1', ${branchId}, true) RETURNING id`;
  await sql`INSERT INTO service_order (order_no, customer_id, address_id, branch_id, channel, order_type, status, subtotal_amount, total_amount, paid_amount, payment_status, completed_at)
    VALUES (${NO.old}, ${c!.id}, ${a!.id}, ${branchId}, 'APP', 'NORMAL', 'COMPLETED', 90000, 90000, 90000, 'PAID', now() - interval '12 months')`;
  await job(page, 'daily-aggregate');
  const [agg] = await sql<{ last_service_date: string | null; purge_due_date: string | null }[]>`SELECT last_service_date::text, purge_due_date::text FROM customer WHERE id = ${c!.id}`;
  expect(agg!.last_service_date).not.toBeNull();
  expect(agg!.purge_due_date).not.toBeNull();

  await adminLogin(page);
  await page.goto('/admin/crm/revisit');
  await expect(page.getByText(revisitCustomerNo)).toBeVisible();
  await page.getByRole('checkbox', { name: '자동 발송 실행' }).check();
  await page.getByRole('button', { name: '저장' }).click();
  await confirmSave(page);

  const r = await job(page, 'revisit-campaign');
  expect(r.skipped).toBe(false);
  expect(Number(r.sent)).toBeGreaterThanOrEqual(1);
  const [t] = await sql<{ status: string }[]>`SELECT status FROM campaign_target WHERE customer_id = ${c!.id}`;
  expect(t!.status).toBe('SENT');
  // 같은 작업 주기에는 다시 보내지 않는다
  await job(page, 'revisit-campaign');
  const [n] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM campaign_target WHERE customer_id = ${c!.id}`;
  expect(n!.n).toBe(1);
});

test('F-SYS-12 파기 배치(승인 방식) → A-CUS-030 일괄 승인 → 비식별화 + A-SYS-060 감사 로그', async ({ page }) => {
  const [c] = await sql<{ id: string }[]>`
    INSERT INTO customer (customer_no, customer_type, name, phone1, phone1_hash, join_channel, privacy_agree_status, status, withdrawn_at)
    VALUES ('C2611168003', 'PERSONAL', ${enc('탈퇴고객')}, ${enc('01088080004')}, ${hash('01088080004')}, 'APP', 'WITHDRAWN', 'WITHDRAWN', now() - interval '6 years') RETURNING id`;
  purgeCustomerId = c!.id;
  await job(page, 'daily-aggregate');
  const r = await job(page, 'pii-purge');
  expect(r.mode).toBe('APPROVAL');
  expect(Number(r.due)).toBeGreaterThanOrEqual(1);

  await adminLogin(page);
  await page.goto('/admin/cus/purge');
  await page.getByRole('checkbox', { name: 'C2611168003 선택' }).check();
  await page.getByRole('button', { name: '일괄 파기 승인' }).click();
  await page.getByRole('dialog', { name: /개인정보를 파기하시겠습니까/ }).getByRole('button', { name: '파기' }).click();
  await expect(page.locator('.ac-toast').filter({ hasText: '파기했습니다' }).last()).toBeVisible();
  const [p] = await sql<{ status: string; phone1_hash: string | null }[]>`SELECT status, phone1_hash FROM customer WHERE id = ${purgeCustomerId}`;
  expect([p!.status, p!.phone1_hash]).toEqual(['PURGED', null]);

  await page.goto('/admin/sys/audit-logs?action=DELETE');
  await expect(page.locator('tbody tr', { hasText: `customer #${purgeCustomerId}` })).toBeVisible();
});

test('A-DSH-010 운영 현황 · A-DSH-020 KPI(ERD §5) · A-STA-010 매출 CSV 다운로드(감사 로그)', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/dsh/operations');
  await expect(page.getByRole('heading', { name: '운영 현황' })).toBeVisible();
  await expect(page.getByText('배정 대기')).toBeVisible();
  await page.goto('/admin/dsh/kpi');
  for (const label of ['월 처리 건수', '건당 객단가', '마진율', '재방문율', '기사 6개월 정착률', '비수기/성수기 매출 비', 'AS·불만율', '고객 획득비(CAC)', 'NPS']) {
    await expect(page.getByRole('region', { name: label })).toBeVisible();
  }
  await page.goto(`/admin/sta/sales?from=${kstDate(-30)}&to=${kstDate()}`);
  await expect(page.getByRole('heading', { name: '매출 통계' })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'CSV 다운로드' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^sales-/);
  const [log] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE action = 'EXPORT' AND detail_json->>'screen' = 'A-STA-010'`;
  expect(log!.n).toBeGreaterThanOrEqual(1);
});

test('A-CNT-010 안전 공지(팝업) → 기사 홈 팝업 확인 → 읽음 현황 1명 · A-CNT-020 기본 FAQ', async ({ browser, page }) => {
  await adminLogin(page);
  await page.goto('/admin/cnt/notices');
  await page.getByRole('button', { name: '공지 등록' }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('combobox', { name: '유형' }).selectOption({ label: '안전' });
  await d.getByRole('checkbox', { name: '팝업(필독)' }).check();
  await d.getByRole('textbox', { name: '제목' }).fill('여름철 실외기 작업 안전 수칙');
  await d.getByRole('textbox', { name: '내용' }).fill('2층 이상 실외기 작업은 반드시 안전고리를 걸어 주세요.');
  await d.getByRole('button', { name: '저장' }).click();
  await confirmSave(page);

  const tp = await techLogin(browser);
  const popup = tp.getByRole('dialog', { name: '여름철 실외기 작업 안전 수칙' });
  await expect(popup).toBeVisible();
  await popup.getByRole('button', { name: '확인했습니다' }).click();
  await expect(popup).toHaveCount(0);
  await expect(tp.getByRole('link', { name: /여름철 실외기 작업 안전 수칙/ })).toBeVisible();
  await tp.context().close();

  await page.reload();
  const row = page.locator('tbody tr', { hasText: '여름철 실외기 작업 안전 수칙' });
  await expect(row).toContainText(/1 \/ \d+/);

  await page.goto('/admin/cnt/faqs');
  await expect(page.getByText('추가요금이 생길 수 있나요?')).toBeVisible();
});
