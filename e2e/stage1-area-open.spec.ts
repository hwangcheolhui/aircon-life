/**
 * 단계 1 보강 — 서비스 지역 오픈 알림 신청 (04 단계 1 구현 메모):
 * 비서비스 지역 고객이 휴대폰 번호로 오픈 알림을 신청하고(C-QUO-011, F-CUS-QUO-08),
 * 관리자가 그 법정동을 서비스 가능으로 저장하면 안내가 나간다(A-DSP-050, F-ADM-DSP-11). 실패분·만료는 F-SYS-19.
 * 알림은 Mock 발송(NOTIFY_DRIVER 기본 mock). 단계 1 시나리오가 쓰는 불광동·대조동은 건드리지 않는다.
 */
import { type Page, expect, test } from '@playwright/test';
import postgres from 'postgres';
import { E2E_ENV } from '../playwright.config';

test.describe.configure({ mode: 'serial' });

const sql = postgres(E2E_ENV.DATABASE_URL, { max: 1, onnotice: () => undefined });
const HAEUNDAE = '2635010500'; // 예시 주소: 부산 해운대구 해운대로 1 (관할 지역 등록·서비스 불가)
const BUPYEONG = '2823710100'; // 예시 주소: 인천 부평구 부평대로 1 (관할 지역 미등록)
const PHONE = '010-0000-1234'; // 테스트용 가상 번호

test.beforeAll(async () => {
  await sql`DELETE FROM area_open_request`;
  await sql`INSERT INTO branch (branch_code, name, status) VALUES ('BS01', '해운대거점', 'ACTIVE') ON CONFLICT (branch_code) DO NOTHING`;
  const [b] = await sql<{ id: string }[]>`SELECT id FROM branch WHERE branch_code = 'BS01'`;
  await sql`DELETE FROM service_area WHERE legal_dong_code IN (${HAEUNDAE}, ${BUPYEONG})`;
  await sql`INSERT INTO service_area (branch_id, sido, sigungu, eupmyeondong, legal_dong_code, is_serviceable)
    VALUES (${b!.id}, '부산', '해운대구', '우동', ${HAEUNDAE}, false)`;
});

test.afterAll(async () => {
  await sql.end();
});

async function searchAddress(page: Page, q: string) {
  const dialog = page.getByRole('dialog', { name: '주소 검색' });
  await dialog.getByRole('textbox').fill(q);
  await dialog.getByRole('button', { name: '검색' }).click();
  await dialog.locator('.cus-address-results button').first().click();
}

async function requestOpen(page: Page, q: string) {
  await page.goto('/quote');
  await page.getByRole('button', { name: '주소 검색' }).click();
  await searchAddress(page, q);
  const dialog = page.getByRole('dialog', { name: '아직 서비스하지 않는 지역이에요' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('C-QUO-011 비서비스 지역 고객이 오픈 알림을 신청한다 (F-CUS-QUO-08, BR-003)', async ({ page }) => {
  const dialog = await requestOpen(page, '해운대');
  // 필수 누락
  await dialog.getByRole('button', { name: '알림 신청' }).click();
  await expect(dialog.getByText('휴대폰 번호는 필수 입력값입니다.')).toBeVisible();
  await expect(dialog.getByText('개인정보 수집·이용 동의는 필수 입력값입니다.')).toBeVisible();
  // 휴대폰이 아닌 번호
  await dialog.getByRole('textbox', { name: '휴대폰 번호' }).fill('02-123-4567');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: '알림 신청' }).click();
  await expect(dialog.getByText('휴대폰 번호를 정확히 입력해 주세요. (예: 010-1234-5678)')).toBeVisible();
  // 정상 신청
  await dialog.getByRole('textbox', { name: '휴대폰 번호' }).fill(PHONE);
  await dialog.getByRole('button', { name: '알림 신청' }).click();
  await expect(page.getByText('신청이 완료되었습니다.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '확인' }).click();

  // 같은 번호로 다시 신청해도 대기 1건 (BR-003)
  const again = await requestOpen(page, '해운대');
  await again.getByRole('textbox', { name: '휴대폰 번호' }).fill('01000001234');
  await again.getByRole('checkbox').check();
  await again.getByRole('button', { name: '알림 신청' }).click();
  await expect(page.getByText('신청이 완료되었습니다.', { exact: false })).toBeVisible();

  // 관할 지역 미등록 지역도 신청 가능
  const other = await requestOpen(page, '부평');
  await other.getByRole('textbox', { name: '휴대폰 번호' }).fill(PHONE);
  await other.getByRole('checkbox').check();
  await other.getByRole('button', { name: '알림 신청' }).click();
  await expect(page.getByText('신청이 완료되었습니다.', { exact: false })).toBeVisible();

  const rows = await sql<{ legal_dong_code: string; status: string; phone: string; phone_hash: string }[]>`
    SELECT legal_dong_code, status, phone, phone_hash FROM area_open_request ORDER BY id`;
  expect(rows.map((r) => [r.legal_dong_code, r.status])).toEqual([
    [HAEUNDAE, 'WAITING'],
    [BUPYEONG, 'WAITING'],
  ]);
  // 연락처는 암호문으로만 저장 (01 §6)
  for (const r of rows) {
    expect(r.phone.startsWith('v1:')).toBe(true);
    expect(r.phone).not.toContain('1234');
    expect(r.phone_hash).toHaveLength(64);
  }
});

test('A-DSP-050 서비스 가능으로 저장하면 신청자에게 오픈 알림이 나간다 (F-ADM-DSP-11, BR-003)', async ({ page }) => {
  await page.goto('/admin/login');
  await page.getByRole('textbox', { name: 'ID' }).fill('superadmin');
  await page.getByLabel('비밀번호').fill(E2E_ENV.SEED_SUPER_ADMIN_PASSWORD);
  await page.getByRole('button', { name: '로그인' }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'));
  await page.goto('/admin/dsp/areas');

  // 미등록 지역 신청 현황(번호 비표시)과 등록 지역 대기 건수
  const demand = page.locator('section', { has: page.getByRole('heading', { name: '미등록 지역 오픈 알림 신청' }) });
  await expect(demand.locator('tr', { hasText: BUPYEONG })).toContainText('1건');
  await expect(page.getByText(PHONE)).toHaveCount(0);
  const row = page.locator('tr', { hasText: HAEUNDAE });
  await expect(row).toContainText('1건');

  await row.dblclick();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: '서비스 가능', exact: true }).check();
  await dialog.getByRole('button', { name: '저장' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(page.locator('.ac-toast').last()).toContainText('저장에 성공하였습니다. 오픈 알림 1건을 보냈습니다.');

  const [r] = await sql<{ status: string; phone: string | null; phone_hash: string | null; notify_channel: string; branch_id: string }[]>`
    SELECT status, phone, phone_hash, notify_channel, branch_id FROM area_open_request WHERE legal_dong_code = ${HAEUNDAE}`;
  expect(r).toMatchObject({ status: 'NOTIFIED', phone: null, phone_hash: null, notify_channel: 'ALIMTALK' });
  expect(r!.branch_id).not.toBeNull();

  // 다시 저장해도 이미 안내한 신청에는 다시 보내지 않는다
  await page.locator('tr', { hasText: HAEUNDAE }).dblclick();
  await page.getByRole('dialog').getByRole('button', { name: '저장' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(page.locator('.ac-toast').last()).toHaveText('저장에 성공하였습니다.');
});

test('F-SYS-19 배치: 남은 대기 신청을 보내고 보관일이 지난 신청은 만료한다 (BR-003)', async ({ request }) => {
  expect((await request.get('/api/jobs/area-open-notify')).status()).toBe(401);
  // 부평이 관할 지역으로 직접(SQL) 열린 경우 → 배치가 안내
  const [b] = await sql<{ id: string }[]>`SELECT id FROM branch WHERE branch_code = 'BS01'`;
  await sql`INSERT INTO service_area (branch_id, sido, sigungu, eupmyeondong, legal_dong_code, is_serviceable)
    VALUES (${b!.id}, '인천', '부평구', '부평동', ${BUPYEONG}, true)`;
  // 보관일(365일) 지난 대기 신청
  await sql`INSERT INTO area_open_request (legal_dong_code, sido, sigungu, eupmyeondong, phone, phone_hash, privacy_agreed_at, status, created_at)
    VALUES ('1100000000', '서울', '예시구', '예시동', 'v1:a:b:c', ${'c'.repeat(64)}, now() - interval '400 days', 'WAITING', now() - interval '400 days')`;
  const res = await request.get('/api/jobs/area-open-notify', {
    headers: { authorization: `Bearer ${E2E_ENV.CRON_SECRET}` },
  });
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, sent: 1, failed: 0, expired: 1 });
  const rows = await sql<{ legal_dong_code: string; status: string; phone: string | null }[]>`
    SELECT legal_dong_code, status, phone FROM area_open_request WHERE legal_dong_code IN (${BUPYEONG}, '1100000000') ORDER BY id`;
  expect(rows).toEqual([
    { legal_dong_code: BUPYEONG, status: 'NOTIFIED', phone: null },
    { legal_dong_code: '1100000000', status: 'EXPIRED', phone: null },
  ]);
});
