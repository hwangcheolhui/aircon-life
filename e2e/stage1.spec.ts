/**
 * 단계 1 완료 기준 (04 §2 단계 1):
 * 서비스 지역 주소는 견적이 나오고, 비서비스 지역은 안내가 뜬다. 관리자 견적 시뮬레이터와 고객 견적 금액이 일치한다.
 * + BR-013 야간·휴일 동시 해당, F-SYS-02 견적 만료 배치.
 * 기준 데이터는 단계 0 시나리오와 같은 값을 SQL로 보장한다(이 파일만 따로 실행해도 동작).
 */
import { type Page, expect, test } from '@playwright/test';
import postgres from 'postgres';
import { E2E_ENV } from '../playwright.config';

test.describe.configure({ mode: 'serial' });

const sql = postgres(E2E_ENV.DATABASE_URL, { max: 1, onnotice: () => undefined });

test.beforeAll(async () => {
  await sql`INSERT INTO branch (branch_code, name, status) VALUES ('EP01', '은평거점', 'ACTIVE') ON CONFLICT (branch_code) DO NOTHING`;
  const [b] = await sql<{ id: string }[]>`SELECT id FROM branch WHERE branch_code = 'EP01'`;
  await sql`INSERT INTO service_area (branch_id, sido, sigungu, eupmyeondong, legal_dong_code, is_serviceable)
    VALUES (${b!.id}, '서울특별시', '은평구', '불광동', '1138010400', true),
           (${b!.id}, '서울특별시', '은평구', '대조동', '1138010500', false)
    ON CONFLICT (legal_dong_code) DO NOTHING`;
  await sql`INSERT INTO service_category (code, name) VALUES ('AIRCON_CLEAN', '에어컨 청소') ON CONFLICT (code) DO NOTHING`;
  const [c] = await sql<{ id: string }[]>`SELECT id FROM service_category WHERE code = 'AIRCON_CLEAN'`;
  await sql`INSERT INTO service_product (category_id, product_code, name, device_type, clean_level, base_duration_min, included_items)
    VALUES (${c!.id}, 'AC-WALL-FULL', '벽걸이 완전분해 세척', 'WALL', 'FULL', 90, '필터·열교환기·송풍팬'),
           (${c!.id}, 'AC-STAND-FULL', '스탠드 완전분해 세척', 'STAND', 'FULL', 120, NULL)
    ON CONFLICT (product_code) DO NOTHING`;
  await sql`UPDATE service_product SET included_items = '필터·열교환기·송풍팬' WHERE product_code = 'AC-WALL-FULL'`;
  const pid = async (code: string) =>
    (await sql<{ id: string }[]>`SELECT id FROM service_product WHERE product_code = ${code}`)[0]!.id;
  const wall = await pid('AC-WALL-FULL');
  const stand = await pid('AC-STAND-FULL');
  // 벽걸이: 공통 90,000 + 은평 85,000 (단계 0과 같은 값, 대수 할인 없음) / 스탠드: 130,000, 2대 이상 5% 할인
  await sql`INSERT INTO price_policy (product_id, branch_id, unit_price, valid_from)
    SELECT ${wall}, NULL, 90000, '2026-01-01' WHERE NOT EXISTS (SELECT 1 FROM price_policy WHERE product_id = ${wall} AND branch_id IS NULL)`;
  await sql`INSERT INTO price_policy (product_id, branch_id, unit_price, valid_from)
    SELECT ${wall}, ${b!.id}, 85000, '2026-01-01' WHERE NOT EXISTS (SELECT 1 FROM price_policy WHERE product_id = ${wall} AND branch_id = ${b!.id})`;
  await sql`UPDATE price_policy SET valid_from = '2026-01-01', multi_unit_discount_json = NULL WHERE product_id = ${wall}`;
  await sql`INSERT INTO price_policy (product_id, unit_price, valid_from, multi_unit_discount_json)
    SELECT ${stand}, 130000, '2026-01-01', '[{"min":2,"rate":5}]'::jsonb WHERE NOT EXISTS (SELECT 1 FROM price_policy WHERE product_id = ${stand})`;
  await sql`INSERT INTO surcharge_rule (rule_code, name, apply_type, condition_json, amount_type, amount) VALUES
    ('NIGHT', '야간 방문 할증', 'AUTO_QUOTE', '{"weekday":true,"after":"18:00"}', 'FIXED', 30000),
    ('HOLIDAY', '휴일 방문 할증', 'AUTO_QUOTE', '{"weekend":true,"holiday":true}', 'FIXED', 30000)
    ON CONFLICT (rule_code) DO NOTHING`;
  await sql`INSERT INTO surcharge_rule (rule_code, name, apply_type, amount_type, amount, per_unit, customer_notice)
    VALUES ('HEAVY_DIRT', '오염 심함', 'ON_SITE', 'FIXED', 20000, true, '곰팡이·오염이 심하면 대당 추가')
    ON CONFLICT (rule_code) DO NOTHING`;
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

/** 벽걸이 1대(은평 85,000) + 스탠드 2대(260,000) − 스탠드 대수할인 5%(13,000) = 332,000 */
const EXPECTED = '332,000원';

test('C-QUO 비서비스 지역은 안내가 뜨고, 서비스 지역은 견적이 나온다 (BR-001, F-CUS-QUO-01~04)', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: '견적 받기' }).click();
  await expect(page).toHaveURL(/\/quote$/);
  await expect(page.getByRole('button', { name: '다음' })).toBeDisabled();

  await page.getByRole('button', { name: '주소 검색' }).click();
  await searchAddress(page, '대조동');
  await expect(page.getByRole('dialog', { name: '아직 서비스하지 않는 지역이에요' })).toBeVisible();
  await page.getByRole('button', { name: '다른 주소 검색' }).click();
  await searchAddress(page, '불광동');
  await expect(page.getByText('서비스 가능한 지역입니다.')).toBeVisible();
  await page.getByRole('button', { name: '다음' }).click();

  // C-QUO-020 기기 형태 (가격이 있는 형태만)
  await expect(page).toHaveURL(/\/quote\/device/);
  await page.getByRole('button', { name: '벽걸이' }).click();
  await page.getByRole('button', { name: '스탠드' }).click();
  await expect(page.getByRole('button', { name: '스탠드' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '다음' }).click();

  // C-QUO-030 대수 → 하단 바 예상 금액
  await expect(page).toHaveURL(/\/quote\/count/);
  // 벽걸이 1 + 스탠드 1 = 2대 → 스탠드 5% 할인: 85,000 + 130,000 − 6,500
  await expect(page.locator('.ac-bottom-bar')).toContainText('208,500원');
  await page.getByRole('button', { name: '스탠드 대수 늘리기' }).click();
  await expect(page.locator('.ac-bottom-bar')).toContainText(EXPECTED);
  await page.getByRole('button', { name: '견적 보기' }).click();

  // C-QUO-040 결과
  await expect(page).toHaveURL(/\/quote\/result\/Q\d{10}$/);
  await expect(page.getByRole('heading', { name: '표준 견적이 나왔어요' })).toBeVisible();
  await expect(page.locator('.ac-bottom-bar')).toContainText(EXPECTED);
  await expect(page.getByText('스탠드 완전분해 세척 대수 할인 5%')).toBeVisible();
  await expect(page.getByText('−13,000원')).toBeVisible();
  await expect(page.getByText('포함: 필터·열교환기·송풍팬')).toBeVisible();
  await expect(page.getByText('현장에서 추가요금이 생길 수 있는 경우')).toBeVisible();

  // BR-014 저장된 견적: 항목 합계 = 총액, 스냅샷 보관, 유효기한 = 발행 + 7일(BR-015)
  const quoteNo = page.url().split('/').pop()!;
  const [q] = await sql<{ total_amount: number; status: string; days: number; items_sum: number }[]>`
    SELECT q.total_amount, q.status, round(extract(epoch FROM (q.expires_at - q.created_at)) / 86400)::int AS days,
           (SELECT sum(amount)::int FROM quote_item WHERE quote_id = q.id) AS items_sum
    FROM quote q WHERE quote_no = ${quoteNo}`;
  expect(q).toMatchObject({ total_amount: 332000, status: 'ISSUED', days: 7, items_sum: 332000 });
});

test('A-PRD-050 관리자 견적 시뮬레이터 금액이 고객 견적과 같다 (F-ADM-PRD-05, BR-011~013)', async ({
  page,
}) => {
  await page.goto('/admin/login');
  await page.getByRole('textbox', { name: 'ID' }).fill('superadmin');
  await page.getByLabel('비밀번호').fill('E2e-super-1');
  await page.getByRole('button', { name: '로그인' }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'));

  await page.goto('/admin/prd/simulator');
  await expect(page.locator('.ac-lnb')).toContainText('견적 시뮬레이터');
  await page.getByRole('combobox', { name: '법정동 코드' }).fill('1138010400');
  await page.getByRole('combobox', { name: '기기 형태 1' }).selectOption({ label: '벽걸이' });
  await page.getByRole('button', { name: '기기 추가' }).click();
  await page.getByRole('combobox', { name: '기기 형태 2' }).selectOption({ label: '스탠드' });
  await page.getByRole('spinbutton', { name: '대수 2' }).fill('2');
  await page.getByRole('spinbutton', { name: '대수 2' }).press('Enter'); // 검색 영역 Enter = 조회
  await expect(page.locator('tfoot')).toContainText(EXPECTED);

  // 토요일 19시: 야간(평일 전용)은 빠지고 휴일 할증 1건만 (BR-012·013)
  await page.getByLabel('희망 방문일').fill('2027-03-06');
  await page.getByLabel('희망 방문 시각').fill('19:00');
  await page.getByRole('button', { name: '조회' }).click();
  await expect(page.locator('tbody')).toContainText('휴일 방문 할증');
  await expect(page.locator('tbody')).not.toContainText('야간 방문 할증');
  await expect(page.locator('tfoot')).toContainText('362,000원');

  // 비서비스 지역 (BR-001)
  await page.getByRole('combobox', { name: '법정동 코드' }).fill('1138010500');
  await page.getByRole('button', { name: '조회' }).click();
  await expect(page.getByText('아직 서비스하지 않는 지역입니다.')).toBeVisible();
});

test('F-SYS-02 견적 만료 배치: 유효기한이 지난 견적을 만료 처리한다', async ({ page, request }) => {
  expect((await request.get('/api/jobs/quote-expire')).status()).toBe(401);
  const [q] = await sql<{ quote_no: string }[]>`
    UPDATE quote SET expires_at = now() - interval '1 minute'
    WHERE id = (SELECT max(id) FROM quote) RETURNING quote_no`;
  const res = await request.get('/api/jobs/quote-expire', {
    headers: { authorization: `Bearer ${E2E_ENV.CRON_SECRET}` },
  });
  expect(res.status()).toBe(200);
  expect((await res.json()).expired).toBeGreaterThanOrEqual(1);
  const [after] = await sql<{ status: string }[]>`SELECT status FROM quote WHERE quote_no = ${q!.quote_no}`;
  expect(after?.status).toBe('EXPIRED');
  await page.goto(`/quote/result/${q!.quote_no}`);
  await expect(page.getByText('유효기간이 지난 견적입니다. 다시 견적을 받아 주세요.')).toBeVisible();
});
