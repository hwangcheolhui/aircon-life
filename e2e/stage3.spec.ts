/**
 * 단계 3 완료 기준 (04 §2 단계 3):
 * 신규 등록(주소 4단계) / 동의 팝업 / 기존 고객 선택 / 미완료 Alert / 이중접수 팝업이 모두 동작하고,
 * 기사 미선택 저장 시 "미지정(긴급)"(ASSIGN_WAIT) 상태가 된다. (A-CSL-010, BR-020·022·023·024)
 * + A-CSL-070 상담 이력, A-CUS-010·020 고객 목록·상세, A-CNT-050 상담 스크립트 화면이 열린다.
 * 기준 데이터(거점·지역·상품·가격·슬롯)는 SQL로 보장한다(이 파일만 따로 실행해도 동작).
 */
import { type Page, expect, test } from '@playwright/test';
import postgres from 'postgres';
import { E2E_ENV } from '../playwright.config';

test.describe.configure({ mode: 'serial' });

const sql = postgres(E2E_ENV.DATABASE_URL, { max: 1, onnotice: () => undefined });
// 테스트 전용 가상 번호(실제 개인정보 아님)
const PHONE = `010-0000-${String(Date.now() % 10000).padStart(4, '0')}`;
const NAME = '상담테스트';

const kstDate = (offsetDays: number) => new Date(Date.now() + 9 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

test.beforeAll(async () => {
  await sql`INSERT INTO branch (branch_code, name, status, phone) VALUES ('EP01', '은평거점', 'ACTIVE', '02-000-0000') ON CONFLICT (branch_code) DO NOTHING`;
  await sql`UPDATE branch SET status = 'ACTIVE' WHERE branch_code = 'EP01'`;
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
  // 내일부터 7일 × 09~17시 일반 슬롯
  for (let d = 1; d <= 7; d++) {
    for (let h = 9; h <= 17; h++) {
      await sql`INSERT INTO time_slot (branch_id, slot_date, slot_hour, slot_kind, capacity)
        VALUES (${b!.id}, ${kstDate(d)}, ${h}, 'NORMAL', 5) ON CONFLICT DO NOTHING`;
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

async function lookup(page: Page) {
  const area = page.getByRole('region', { name: '고객' });
  await area.getByLabel('전화1').fill(PHONE);
  await area.getByLabel('전화1').press('Enter');
  return page.getByRole('dialog', { name: '고객정보 조회' });
}

/** Time Table 첫 가능 칸 → 기사 미지정 → (할증 안내가 뜨면 닫기) */
async function pickSlotWithoutTech(page: Page) {
  const tt = page.getByRole('region', { name: 'Time Table' });
  await tt.locator('button.adm-csl-tt-cell:not([disabled])').first().click();
  await page.getByRole('dialog', { name: '출장 가능 기사 스케줄' }).getByRole('button', { name: '기사 미지정으로 선택' }).click();
  for (const title of ['평일 야간 약속 안내', '휴일 약속 안내']) {
    const notice = page.getByRole('dialog', { name: title });
    if (await notice.isVisible().catch(() => false)) await notice.getByRole('button', { name: '확인' }).click();
  }
  return tt;
}

test('A-CSL-012 신규 고객 등록(주소 4단계) → BR-023 동의 팝업 → BR-024 기사 미선택 접수는 ASSIGN_WAIT', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/csl/console');
  const dialog = await lookup(page);
  await expect(dialog.getByRole('tab', { name: '고객목록 (0)' })).toBeVisible();
  await dialog.getByRole('tab', { name: '고객등록' }).click();
  await dialog.getByLabel('고객명').fill(NAME);
  await dialog.getByRole('button', { name: '주소 검색' }).click();
  const addr = page.getByRole('dialog', { name: '주소 검색' });
  await addr.getByRole('textbox').fill('불광동');
  await addr.getByRole('button', { name: '검색' }).click();
  await addr.locator('.adm-address-results button').first().click();
  await dialog.getByLabel('상세주소').fill('101동 101호');
  await dialog.getByRole('button', { name: '주소 정제' }).click();
  await expect(dialog.getByText('정제 완료')).toBeVisible();
  await dialog.getByRole('button', { name: '등록' }).click();
  await confirmSave(page);

  // 전화 등록 고객은 동의 질의 전(NOT_ASKED) → 동의 팝업 자동 호출
  const consent = page.getByRole('dialog', { name: '개인정보 수집 동의' });
  await expect(consent).toBeVisible();
  await consent.getByRole('button', { name: '동의', exact: true }).click();
  await expect(page.locator('.ac-toast').filter({ hasText: '저장에 성공하였습니다.' }).last()).toBeVisible();

  // 출장접수: 증상 → 자동 견적 → 슬롯(기사 미지정) → 저장
  await page.getByLabel('접수 증상').selectOption({ label: '정기 청소' });
  await expect(page.getByText('자동 견적')).toBeVisible({ timeout: 30_000 });
  const tt = await pickSlotWithoutTech(page);
  await tt.getByRole('button', { name: '저장' }).click();
  await confirmSave(page);
  // 저장 후 이력 탭에 접수가 들어오면 서버 처리 완료
  await expect(page.getByRole('tab', { name: '작업이력(1)' })).toBeVisible();

  const rows = await sql<{ status: string; channel: string; histories: string }[]>`
    SELECT o.status, o.channel, (SELECT count(*) FROM order_status_history h WHERE h.order_id = o.id)::text AS histories
    FROM service_order o JOIN customer cu ON cu.id = o.customer_id
    WHERE cu.customer_no = (SELECT customer_no FROM customer ORDER BY id DESC LIMIT 1)`;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ status: 'ASSIGN_WAIT', channel: 'PHONE', histories: '1' });

  // BR-020 같은 주소 재접수 → 이중접수 팝업 → [접수취소]
  await page.getByLabel('접수 증상').selectOption({ label: '냄새' });
  await expect(page.getByText('자동 견적')).toBeVisible({ timeout: 30_000 });
  await pickSlotWithoutTech(page);
  await tt.getByRole('button', { name: '저장' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  const dup = page.getByRole('dialog', { name: '이중접수 고객 리스트' });
  await expect(dup).toBeVisible();
  await dup.getByRole('button', { name: '접수취소' }).click();
  const [{ n }] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM service_order WHERE customer_id = (SELECT id FROM customer ORDER BY id DESC LIMIT 1)`;
  expect(n).toBe('1');

  // 클레임 저장 → 미완료로 남는다
  await page.getByRole('tab', { name: '문의·클레임' }).click();
  await page.getByRole('button', { name: '클레임' }).click();
  await page.getByLabel('세부 유형').selectOption({ label: '품질/세척불량' });
  await page.getByLabel('상담 내용').fill('세척 후 냄새가 남아 있다는 불만');
  await page.getByRole('region', { name: '상담 유형' }).getByRole('button', { name: '저장' }).click();
  await confirmSave(page);
  await expect(page.getByRole('tab', { name: 'VOC이력(1)' })).toBeVisible();
});

test('BR-022 기존 고객 선택 시 미완료 클레임 Alert, 이력 탭에 접수·클레임이 보인다', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/csl/console');
  const dialog = await lookup(page);
  await expect(dialog.getByRole('tab', { name: '고객목록 (1)' })).toBeVisible();
  await dialog.locator('tbody tr').first().dblclick();
  const alert = page.getByRole('dialog', { name: '확인이 필요합니다' });
  await expect(alert).toContainText('클레임');
  // 동의 완료 고객이므로 동의 팝업은 뜨지 않는다
  await expect(page.getByRole('dialog', { name: '개인정보 수집 동의' })).toHaveCount(0);
  while (await alert.isVisible().catch(() => false)) await alert.getByRole('button', { name: '확인' }).click();
  const history = page.getByRole('region', { name: '고객 이력' });
  await expect(history.getByRole('tab', { name: '작업이력(1)' })).toBeVisible();
  await expect(history.getByRole('tab', { name: 'VOC이력(1)' })).toBeVisible();
});

test('A-CSL-070 상담 이력 · A-CUS-010/020 고객 · A-CNT-050 스크립트 화면', async ({ page }) => {
  await adminLogin(page);
  await page.goto('/admin/csl/history?type=CLAIM');
  await expect(page.getByRole('heading', { name: '상담 이력 조회' })).toBeVisible();
  await expect(page.locator('tbody tr')).not.toHaveCount(0);

  await page.goto(`/admin/cus/customers?phone=${PHONE}`);
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.locator('tbody tr').first().dblclick();
  await expect(page).toHaveURL(/\/admin\/cus\/customers\/\d+$/);
  await page.getByRole('tab', { name: '동의이력' }).click();
  await expect(page.locator('tbody tr')).not.toHaveCount(0);

  await page.goto('/admin/cnt/scripts');
  await expect(page.getByRole('heading', { name: '상담 스크립트' })).toBeVisible();
  await expect(page.getByText('PRIVACY_CONSENT')).toBeVisible();
});
