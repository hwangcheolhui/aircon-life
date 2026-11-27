/**
 * 단계 10 완료 기준 (04 §2 단계 10 기사 업무지원·교육):
 * 기사 홈에 D-day~D+2 메모·자재·약속이 보이고(T-HOM-010), 캘린더가 근무/메모로 전환된다(T-CAL-010).
 * 지원자(A-TEC-030) → 합격(기사 계정 생성, 교육중) → 교육 과정(A-TEC-040) → 수강·수료(A-TEC-041, 기사 활동 전환)가 이어지고,
 * 6개월 정착률이 집계된다(A-TEC-050).
 * 함께 확인: 지정 메모 발송(A-CNT-040) → 기사 홈 팝업(T-MEMO-020) 확인, 메모 등록(T-MEMO-010), 자재 요청·수령(T-MAT-020 → T-MAT-010),
 * 퀵메뉴(T-MY-020), 주간 일정(T-RTE-030), 기술자료(A-CNT-030 → T-EDU-010), 내 교육·등급(T-EDU-020), 월 수입(T-STL-010).
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
const TECH = { code: 'T10-MAIN', phone: '01010100001', name: '지원기사' };
const APPLICANT = { phone: '01010100002', name: '신입지원', code: 'T10-NEW' };
const kstDate = (plusDays = 0) => new Date(Date.now() + 9 * 3600_000 + plusDays * 86_400_000).toISOString().slice(0, 10);

let branchId = '';
let techId = '';

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

/** 앞 단계 E2E가 남긴 팝업 공지가 있으면 닫는다 */
async function closeNoticePopup(p: Page) {
  const btn = p.getByRole('button', { name: '확인했습니다' });
  if (await btn.isVisible().catch(() => false)) await btn.click();
}

/** 홈 주간 할일 표에서 한 행(메모·자재·약속)의 D-day~D+2 숫자 */
async function weeklyRow(p: Page, name: string) {
  return p.locator('table.tec-weekly tbody tr', { has: p.getByRole('rowheader', { name }) }).locator('td').allTextContents();
}

test('준비: 거점·자재·기사(근무표)·오늘과 내일 약속·오늘 필요한 자재 요청', async () => {
  await sql`INSERT INTO branch (branch_code, name, status, phone) VALUES ('TS10', '지원거점', 'ACTIVE', '02-000-0010') ON CONFLICT (branch_code) DO NOTHING`;
  const [b] = await sql<{ id: string }[]>`SELECT id FROM branch WHERE branch_code = 'TS10'`;
  branchId = b!.id;
  await sql`INSERT INTO material (material_code, name, unit, safety_stock) VALUES ('M10-GAS', '에어컨 세정제', 'EA', 5) ON CONFLICT (material_code) DO NOTHING`;
  const [t] = await sql<{ id: string }[]>`INSERT INTO technician (tech_code, login_id, name, phone, branch_id, grade, contract_type, status, joined_at)
    VALUES (${TECH.code}, ${hash(TECH.phone)}, ${TECH.name}, ${enc(TECH.phone)}, ${branchId}, 'REGULAR', 'FREELANCER', 'ACTIVE', '2026-01-05') RETURNING id`;
  techId = t!.id;
  await sql`INSERT INTO work_schedule (technician_id, work_date, schedule_type)
    SELECT ${techId}, d::date, 'WORK' FROM generate_series((now() AT TIME ZONE 'Asia/Seoul')::date - 7, (now() AT TIME ZONE 'Asia/Seoul')::date + 14, '1 day') d
    ON CONFLICT (technician_id, work_date) DO UPDATE SET schedule_type = 'WORK'`;
  const [c] = await sql<{ id: string }[]>`INSERT INTO customer (customer_no, customer_type, name, phone1, join_channel, privacy_agree_status, status)
    VALUES ('C2611271001', 'PERSONAL', ${enc('업무고객')}, ${enc('01010100009')}, 'APP', 'AGREED', 'ACTIVE') RETURNING id`;
  const [a] = await sql<{ id: string }[]>`INSERT INTO customer_address (customer_id, zipcode, road_address, branch_id)
    VALUES (${c!.id}, '00000', '지원로 10', ${branchId}) RETURNING id`;
  const order = async (no: string, day: number) => {
    const [o] = await sql<{ id: string }[]>`
      INSERT INTO service_order (order_no, customer_id, address_id, branch_id, channel, order_type, status, subtotal_amount, total_amount, paid_amount, payment_status, promised_at, requested_date)
      VALUES (${no}, ${c!.id}, ${a!.id}, ${branchId}, 'APP', 'NORMAL', 'ASSIGNED', 90000, 90000, 0, 'UNPAID', ${`${kstDate(day)}T10:00:00+09:00`}::timestamptz, ${kstDate(day)}::date)
      RETURNING id`;
    await sql`INSERT INTO assignment (order_id, technician_id, role, assign_method, status, accepted_at) VALUES (${o!.id}, ${techId}, 'MAIN', 'MANUAL', 'ACCEPTED', now())`;
  };
  await order('2611271000A1', 0);
  await order('2611271000A2', 1);
  await sql`INSERT INTO material_request (technician_id, material_id, quantity, needed_date, status)
    SELECT ${techId}, id, 2, ${kstDate(0)}::date, 'REQUESTED' FROM material WHERE material_code = 'M10-GAS'`;
});

test('A-CNT-040 지정 메모(팝업) 발송 → 기사 홈 T-MEMO-020 팝업 [확인] → 발송 목록 확인 1/1 (F-ADM-CNT-04)', async ({ browser, page }) => {
  await adminLogin(page);
  await page.goto('/admin/cnt/memos');
  await page.getByRole('button', { name: '지정 메모 발송' }).click();
  const dlg = page.getByRole('dialog', { name: '지정 메모 발송' });
  await dlg.getByRole('textbox', { name: '내용' }).fill('내일 오전 거점에서 세정제 받아 가세요.');
  await dlg.getByRole('textbox', { name: '기사 이름 검색' }).fill(TECH.name);
  await dlg.getByRole('checkbox', { name: new RegExp(`^${TECH.name}`) }).check();
  await dlg.getByRole('button', { name: '발송' }).click();
  await page.getByRole('dialog', { name: '메모를 발송하시겠습니까?' }).getByRole('button', { name: '발송' }).click();
  await expect(page.getByText('발송했습니다. (1명)')).toBeVisible();
  const row = page.locator('tbody tr', { hasText: '내일 오전 거점에서' });
  await expect(row).toContainText('0 / 1');

  const tp = await techLogin(browser);
  const popup = tp.getByRole('dialog', { name: '오늘의 메모' });
  await expect(popup).toBeVisible();
  await expect(popup.getByText('내일 오전 거점에서 세정제 받아 가세요.')).toBeVisible();
  await popup.getByRole('button', { name: '확인', exact: true }).click();
  await expect(popup.getByText('확인함')).toBeVisible();
  await tp.context().close();

  await page.reload();
  await expect(page.locator('tbody tr', { hasText: '내일 오전 거점에서' })).toContainText('1 / 1');
});

test('완료 기준: T-MEMO-010 내일 메모 등록 → 홈 주간 할일 D-day~D+2 메모·자재·약속 → T-CAL-010 근무/메모 전환 (F-TEC-HOM-02·03, F-TEC-CAL-01·02)', async ({ browser }) => {
  const tp = await techLogin(browser);
  await closeNoticePopup(tp);
  await tp.goto(`/tech/memos/new?date=${kstDate(1)}`);
  await tp.getByRole('textbox', { name: '내용' }).fill('고객 재방문 전화 드리기');
  await tp.getByRole('button', { name: '저장' }).click();
  await tp.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(tp).toHaveURL(/\/tech\/calendar\?.*mode=memo/);
  await expect(tp.getByText('고객 재방문 전화 드리기')).toBeVisible();

  await tp.goto('/tech');
  await closeNoticePopup(tp);
  // 오늘: 지정 메모 1 · 자재 1(오늘 필요) · 약속 1 / 내일: 내 메모 1 · 약속 1 / 모레: 없음
  await expect.poll(() => weeklyRow(tp, '메모')).toEqual(['1', '1', '0']);
  expect(await weeklyRow(tp, '자재')).toEqual(['1', '0', '0']);
  expect(await weeklyRow(tp, '약속')).toEqual(['1', '1', '0']);
  await expect(tp.getByRole('button', { name: /오늘의 메모/ })).toContainText('1/1');
  await expect(tp.getByRole('link', { name: /오늘의 자재/ })).toContainText('1');
  await expect(tp.getByLabel(/월 내 지표/)).toContainText('VOC');

  await expect(tp.getByRole('navigation', { name: '주 메뉴' }).getByRole('link', { name: '캘린더' })).toHaveAttribute('href', '/tech/calendar');
  await tp.goto('/tech/calendar');
  const today = tp.getByRole('link', { name: new RegExp(`^${Number(kstDate(0).slice(5, 7))}월 ${Number(kstDate(0).slice(8))}일`) });
  await expect(today).toContainText('1/0');
  await tp.getByRole('link', { name: '메모', exact: true }).click();
  await expect(tp).toHaveURL(/mode=memo/);
  await expect(today).toContainText('메모 1');
  await tp.getByRole('link', { name: '근무', exact: true }).click();
  await expect(tp.getByText('2611271000A1')).toBeVisible();

  await tp.goto('/tech/route/week');
  await expect(tp.getByRole('heading', { name: /~/ })).toBeVisible();
  await expect(tp.getByText(/이번 주 빈 시간/)).toBeVisible();
  await tp.context().close();
});

test('T-MAT-020 자재 요청·수령 확인 → T-MAT-010 보유 수량 증가, 퀵메뉴 ★ → 홈 슬라이드 (F-TEC-MAT-01·02, F-TEC-HOM-04)', async ({ browser }) => {
  const tp = await techLogin(browser);
  await tp.goto('/tech/materials/requests');
  const card = tp.locator('.tec-job-card', { hasText: '에어컨 세정제' }).first();
  await card.getByRole('button', { name: '수령 확인' }).click();
  await tp.getByRole('dialog', { name: /자재를 받으셨습니까/ }).getByRole('button', { name: '수령 확인' }).click();
  await expect(tp.getByText('수령을 확인했습니다.')).toBeVisible();
  await tp.goto('/tech/materials');
  const item = tp.locator('.ac-list-item', { hasText: '에어컨 세정제' });
  await expect(item).toContainText('2EA');
  await expect(item).toContainText('부족');

  await tp.goto('/tech/materials/requests');
  await tp.getByRole('combobox', { name: '자재' }).selectOption({ label: '에어컨 세정제' });
  await tp.getByRole('spinbutton', { name: /수량/ }).fill('3');
  await tp.getByRole('button', { name: '요청', exact: true }).click();
  await tp.getByRole('dialog', { name: '자재를 요청하시겠습니까?' }).getByRole('button', { name: '요청' }).click();
  await expect(tp.locator('.tec-job-card', { hasText: '3EA' })).toContainText('요청');

  await tp.goto('/tech/more');
  await tp.getByRole('button', { name: '보유 자재 퀵메뉴 추가' }).click();
  await expect(tp.getByRole('button', { name: '보유 자재 퀵메뉴 해제' })).toBeVisible();
  await tp.goto('/tech');
  await expect(tp.getByRole('navigation', { name: '퀵메뉴' }).getByRole('link', { name: '보유 자재' })).toBeVisible();
  await tp.goto('/tech/settlements');
  await expect(tp.getByRole('list', { name: '최근 6개월 실지급' }).locator('li')).toHaveCount(6);
  await tp.context().close();
});

test('완료 기준: 지원자 등록(A-TEC-030) → 합격 = 기사 계정(교육중) → 기본과정(A-TEC-040) 수강·판정(A-TEC-041) → 수료증·활동 전환 (F-ADM-TEC-04~06)', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/tec/applicants');
  await page.getByRole('button', { name: '지원서 등록' }).click();
  const form = page.getByRole('dialog', { name: '지원서 등록' });
  await form.getByRole('combobox', { name: '지원 거점' }).selectOption({ label: '지원거점' });
  await form.getByRole('textbox', { name: '이름' }).fill(APPLICANT.name);
  await form.getByRole('textbox', { name: '연락처' }).fill(APPLICANT.phone);
  await form.getByRole('textbox', { name: '경력(년)' }).fill('2');
  await form.getByRole('button', { name: '저장' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  const row = page.locator('tbody tr', { hasText: '010-****-0002' });
  await expect(row).toContainText('지원');
  await expect(row).not.toContainText(APPLICANT.name); // 목록은 마스킹(BR-100)

  await row.getByRole('button', { name: '면접' }).click();
  await page.getByRole('dialog', { name: '면접으로 변경' }).getByRole('button', { name: '면접으로 변경' }).click();
  await expect(row).toContainText('면접');
  await row.getByRole('button', { name: '합격 처리' }).click();
  const acc = page.getByRole('dialog', { name: /합격 처리/ });
  await acc.getByRole('textbox', { name: '기사 코드' }).fill(APPLICANT.code);
  await acc.getByRole('button', { name: '합격 처리' }).click();
  await page.getByRole('dialog', { name: '합격 처리하시겠습니까?' }).getByRole('button', { name: '합격 처리' }).click();
  await expect(row).toContainText(APPLICANT.code);
  const [nt] = await sql<{ id: string; status: string; grade: string }[]>`SELECT id, status, grade FROM technician WHERE tech_code = ${APPLICANT.code}`;
  expect([nt!.status, nt!.grade]).toEqual(['TRAINING', 'TRAINEE']);
  const [noti] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM notification_log l JOIN notification_template t ON t.id = l.template_id
    WHERE t.template_code = 'APPLICANT_ACCEPTED' AND l.related_type = 'APPLICATION'`;
  expect(noti!.n).toBeGreaterThan(0);

  await page.goto('/admin/tec/courses');
  await page.getByRole('button', { name: '과정 등록' }).click();
  const cf = page.getByRole('dialog', { name: '과정 등록' });
  await cf.getByRole('textbox', { name: '과정 코드' }).fill('BASIC10');
  await cf.getByRole('textbox', { name: '과정명' }).fill('기본과정 10기');
  await cf.getByRole('textbox', { name: '정원' }).fill('10');
  await cf.getByRole('button', { name: '저장' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  const course = page.locator('tbody tr', { hasText: '기본과정 10기' });
  await expect(course).toContainText('모집중');
  await course.getByRole('link', { name: '수강·수료 관리' }).click();

  await expect(page).toHaveURL(/\/admin\/tec\/enrollments\?courseId=/);
  await page.getByRole('combobox', { name: '기사' }).selectOption({ label: `${APPLICANT.name} (${APPLICANT.code})` });
  await page.getByRole('button', { name: '수강 등록' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '등록' }).click();
  const er = page.locator('tbody tr', { hasText: APPLICANT.code });
  await expect(er).toContainText('수강중');
  await er.getByRole('textbox', { name: `${APPLICANT.name} 출석률` }).fill('95');
  await er.getByRole('textbox', { name: `${APPLICANT.name} 실습 점수` }).fill('88');
  await er.getByRole('button', { name: '판정' }).click();
  await page.getByRole('dialog', { name: '수료 여부를 판정하시겠습니까?' }).getByRole('button', { name: '판정' }).click();
  await expect(page.getByText(/수료 처리했습니다\. 수료증 BASIC10-\d{4}-001/)).toBeVisible();
  await expect(er).toContainText('수료');
  const [after] = await sql<{ status: string; joined_at: string | null }[]>`SELECT status, joined_at FROM technician WHERE id = ${nt!.id}`;
  expect(after!.status).toBe('ACTIVE');
  expect(after!.joined_at).not.toBeNull();
});

test('완료 기준: A-TEC-050 6개월 정착률 집계 + 이탈 처리 (F-ADM-TEC-07, 01 §5)', async ({ page }) => {
  // 8개월 전 같은 달 입사 2명: 1명 재직, 1명 이탈 → 그 코호트 정착률 50%
  const cohort = new Date(Date.now() + 9 * 3600_000);
  cohort.setUTCMonth(cohort.getUTCMonth() - 8, 1);
  const joined = cohort.toISOString().slice(0, 10);
  await sql`INSERT INTO technician (tech_code, name, phone, branch_id, grade, contract_type, status, joined_at)
    VALUES ('T10-STAY', '정착기사', ${enc('01010100003')}, ${branchId}, 'REGULAR', 'FREELANCER', 'ACTIVE', ${joined})`;
  await sql`INSERT INTO technician (tech_code, name, phone, branch_id, grade, contract_type, status, joined_at, left_at, leave_reason)
    VALUES ('T10-GONE', '이탈기사', ${enc('01010100004')}, ${branchId}, 'REGULAR', 'FREELANCER', 'LEFT', ${joined}, ${kstDate(-100)}, 'INCOME')`;

  await adminLogin(page);
  await page.goto('/admin/tec/retention');
  const cohorts = page.getByRole('region', { name: '입사 월 코호트' });
  const row = cohorts.locator('tbody tr', { hasText: joined.slice(0, 7) });
  await expect(row.locator('td').last()).toHaveText('50%');
  await expect(page.getByRole('region', { name: '이탈 사유' }).locator('tbody tr', { hasText: '수입 부족' })).toBeVisible();

  await page.getByRole('combobox', { name: '기사' }).selectOption({ label: '정착기사 (T10-STAY) · 지원거점' });
  await page.getByRole('combobox', { name: '이탈 사유' }).selectOption({ label: '업무 강도' });
  await page.getByRole('button', { name: '이탈 처리' }).click();
  await page.getByRole('dialog', { name: '이탈 처리하시겠습니까?' }).getByRole('button', { name: '이탈 처리' }).click();
  await expect(page.getByText('이탈 처리했습니다.')).toBeVisible();
  const after = cohorts.locator('tbody tr', { hasText: joined.slice(0, 7) });
  await expect(after).not.toContainText('50%');
  await expect(after.locator('td').last()).toHaveText('0%');
});

test('A-CNT-030 기술자료(필독·첨부) 등록 → 기사 T-EDU-010 목록·상세·첨부 열기, T-EDU-020 내 교육·등급 (F-ADM-CNT-03, F-TEC-EDU-01·02)', async ({ browser, page }) => {
  await adminLogin(page);
  await page.goto('/admin/cnt/docs');
  await page.getByRole('button', { name: '자료 등록' }).click();
  const dlg = page.getByRole('dialog', { name: '자료 등록' });
  await dlg.getByRole('combobox', { name: '유형' }).selectOption({ label: '안전 매뉴얼' });
  await dlg.getByRole('textbox', { name: '제목' }).fill('실외기 고소 작업 안전 SOP');
  await dlg.getByRole('textbox', { name: '내용' }).fill('안전대를 먼저 걸고 작업합니다.');
  await dlg.getByRole('checkbox', { name: '필독' }).check();
  await dlg.getByLabel('첨부 추가').setInputFiles({ name: 'sop.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  await dlg.getByRole('button', { name: '저장' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(page.getByText(/저장에 성공하였습니다\. \(버전 1\)/)).toBeVisible();
  await expect(page.locator('tbody tr', { hasText: '실외기 고소 작업 안전 SOP' })).toContainText('필독');

  const tp = await techLogin(browser);
  await tp.goto('/tech/docs');
  await tp.getByRole('link', { name: /실외기 고소 작업 안전 SOP/ }).click();
  await expect(tp.getByText('안전대를 먼저 걸고 작업합니다.')).toBeVisible();
  const href = await tp.getByRole('link', { name: 'sop.pdf' }).getAttribute('href');
  const file = await tp.request.get(href!);
  expect(file.ok()).toBeTruthy();
  await tp.goto('/tech/education');
  await expect(tp.getByText('동행 실습')).toBeVisible();
  await tp.context().close();
});
