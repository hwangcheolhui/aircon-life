/**
 * 단계 4-2 완료 기준 (04 §2 단계 4-2):
 * 운영자가 설정한 관할 경계가 기사 지도에 보이고, 관할 밖 미배정 작업은 보이지 않는다(BR-110).
 * 코스 순서를 바꾸면 도착 예정이 즉시 다시 계산되고, 시간창 위반이 있으면 확정되지 않는다(BR-112).
 * 자동 추천은 전/후 비교로 이동시간을 줄이고, 확정하면 고객에게 방문 예정 시간이 안내된다.
 * 마감(18:00)까지 미확정 코스는 자동 확정된다(BR-113). 두 기사가 같은 작업을 동시에 담으면 한 명만 성공한다.
 * + 근무 시작(위치정보 수집 동의)·근무 중 위치 수집(BR-115), A-DSP-020 자가 배정 승인/거절(BR-111), 배치 4종.
 * 기준 데이터는 SQL로 보장하고, 주문은 고객 화면으로 1건 만든 뒤 SQL로 복제한다(이 파일만 따로 실행해도 동작).
 */
import { type Browser, type Page, expect, test } from '@playwright/test';
import postgres from 'postgres';
import { E2E_ENV } from '../playwright.config';

test.describe.configure({ mode: 'serial' });

const sql = postgres(E2E_ENV.DATABASE_URL, { max: 1, onnotice: () => undefined });
// 테스트 전용 가상 번호(실제 개인정보 아님)
const TA = { code: 'T42-A', name: '구역기사가', phone: '01042420001' };
const TB = { code: 'T42-B', name: '구역기사나', phone: '01042420002' };
const CUSTOMER_PHONE = '010-4242-0003';
const DONG = { BULGWANG: '1138010400', DAEJO: '1138010500', YEOKCHON: '1138010300' };
const CENTER = {
  BULGWANG: [37.6177, 126.9288],
  DAEJO: [37.6142, 126.9201],
  YEOKCHON: [37.6106, 126.9161],
} as const;

let branchId = '';
let srcOrderNo = '';
const techId: Record<string, string> = {};
const kstDay = async (plus: number) =>
  (
    await sql<
      { d: string }[]
    >`SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date + ${plus}::int, 'YYYY-MM-DD') AS d`
  )[0]!.d;
let D1 = '';
let D2 = '';

test.beforeAll(async () => {
  await sql`INSERT INTO branch (branch_code, name, status, phone) VALUES ('EP01', '은평거점', 'ACTIVE', '02-000-0000') ON CONFLICT (branch_code) DO NOTHING`;
  await sql`UPDATE branch SET status = 'ACTIVE', phone = coalesce(phone, '02-000-0000') WHERE branch_code = 'EP01'`;
  const [b] = await sql<{ id: string }[]>`SELECT id FROM branch WHERE branch_code = 'EP01'`;
  branchId = b!.id;
  for (const [code, dong] of [
    [DONG.BULGWANG, '불광동'],
    [DONG.DAEJO, '대조동'],
    [DONG.YEOKCHON, '역촌동'],
  ] as const) {
    await sql`INSERT INTO service_area (branch_id, sido, sigungu, eupmyeondong, legal_dong_code, is_serviceable)
      VALUES (${branchId}, '서울특별시', '은평구', ${dong}, ${code}, true) ON CONFLICT (legal_dong_code) DO NOTHING`;
  }
  // 앞 단계 E2E(지역 오픈 알림)가 대조동을 서비스 불가로 바꿔 두었을 수 있다
  await sql`UPDATE service_area SET is_serviceable = true, branch_id = ${branchId} WHERE legal_dong_code IN (${DONG.BULGWANG}, ${DONG.DAEJO}, ${DONG.YEOKCHON})`;
  await sql`INSERT INTO service_category (code, name) VALUES ('AIRCON_CLEAN', '에어컨 청소') ON CONFLICT (code) DO NOTHING`;
  const [c] = await sql<{ id: string }[]>`SELECT id FROM service_category WHERE code = 'AIRCON_CLEAN'`;
  await sql`INSERT INTO service_product (category_id, product_code, name, device_type, clean_level, base_duration_min)
    VALUES (${c!.id}, 'AC-WALL-FULL', '벽걸이 완전분해 세척', 'WALL', 'FULL', 90) ON CONFLICT (product_code) DO NOTHING`;
  const [w] = await sql<{ id: string }[]>`SELECT id FROM service_product WHERE product_code = 'AC-WALL-FULL'`;
  await sql`INSERT INTO price_policy (product_id, branch_id, unit_price, valid_from)
    SELECT ${w!.id}, NULL, 90000, '2026-01-01' WHERE NOT EXISTS (SELECT 1 FROM price_policy WHERE product_id = ${w!.id} AND branch_id IS NULL)`;
  for (let d = 1; d <= 7; d++) {
    for (let h = 9; h <= 17; h++) {
      await sql`INSERT INTO time_slot (branch_id, slot_date, slot_hour, slot_kind, capacity)
        VALUES (${branchId}, (now() AT TIME ZONE 'Asia/Seoul')::date + ${d}::int, ${h}, 'NORMAL', 5)
        ON CONFLICT (branch_id, slot_date, slot_hour, slot_kind) DO UPDATE SET capacity = greatest(time_slot.capacity, time_slot.booked_count + 5), is_closed = false`;
    }
  }
  await sql`UPDATE system_setting SET setting_value = '18:00' WHERE setting_key = 'ROUTE_CONFIRM_DEADLINE'`;
  await sql`UPDATE system_setting SET setting_value = 'Y' WHERE setting_key IN ('SELF_ASSIGN_ENABLED', 'SELF_ASSIGN_NEEDS_APPROVAL')`;
  D1 = await kstDay(1);
  D2 = await kstDay(2);
});

test.afterAll(async () => {
  await sql`UPDATE system_setting SET setting_value = '18:00' WHERE setting_key = 'ROUTE_CONFIRM_DEADLINE'`;
  await sql.end();
});

async function adminLogin(page: Page) {
  await page.goto('/admin/login');
  await page.getByRole('textbox', { name: 'ID' }).fill('superadmin');
  await page.getByLabel('비밀번호').fill('E2e-super-1');
  await page.getByRole('button', { name: '로그인' }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'));
}

const savedToast = (page: Page) =>
  expect(page.locator('.ac-toast').filter({ hasText: '저장에 성공하였습니다.' }).last()).toBeVisible();

async function registerTech(page: Page, t: typeof TA) {
  await page.goto('/admin/tec/technicians');
  await page.getByRole('button', { name: '기사 등록' }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('textbox', { name: '기사 코드', exact: true }).fill(t.code);
  await d.getByRole('textbox', { name: '이름', exact: true }).fill(t.name);
  await d.getByRole('textbox', { name: '연락처', exact: true }).fill(t.phone);
  await d.getByRole('combobox', { name: '소속 거점' }).selectOption({ label: '은평거점' });
  await d.getByRole('button', { name: '저장' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await savedToast(page);
}

/** 구역 저장: 저장 → 확인 → 폼이 닫힐 때까지 (토스트는 앞 저장 것이 남아 있을 수 있음) */
async function saveZoneForm(page: Page) {
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(page.locator('#zone-form-title')).toHaveCount(0);
  await savedToast(page);
}

async function techLogin(browser: Browser, t: typeof TA, geo = false) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...(geo
      ? {
          geolocation: { latitude: CENTER.BULGWANG[0], longitude: CENTER.BULGWANG[1] },
          permissions: ['geolocation'],
        }
      : {}),
  });
  const p = await ctx.newPage();
  await p.goto('/tech/login');
  await p.getByRole('textbox', { name: '휴대폰 번호' }).fill(t.phone);
  await p.getByRole('button', { name: '인증번호 받기' }).click();
  const code = ((await p.locator('.tec-mock-box strong').textContent()) ?? '').trim();
  await p.getByRole('textbox', { name: '인증번호' }).fill(code);
  await p.getByRole('button', { name: '로그인' }).click();
  await expect(p).toHaveURL(/\/tech$/, { timeout: 30_000 });
  return p;
}

async function customerLogin(browser: Browser) {
  const p = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  return p;
}

/** 고객 화면으로 만든 원본 주문을 복제 (주소 좌표·동·약속 시각·상태 지정) */
async function cloneOrder(
  no: string,
  o: {
    dong: string;
    lat: number;
    lng: number;
    date: string;
    hm: string;
    status?: string;
    window?: [string, string];
    people?: number;
  },
) {
  const [src] = await sql<
    { id: string; address_id: string }[]
  >`SELECT id, address_id FROM service_order WHERE order_no = ${srcOrderNo}`;
  await sql.begin(async (tx) => {
    await tx`DROP TABLE IF EXISTS tmp_addr; DROP TABLE IF EXISTS tmp_order; DROP TABLE IF EXISTS tmp_item`.simple();
    await tx`CREATE TEMP TABLE tmp_addr AS SELECT * FROM customer_address WHERE id = ${src!.address_id}`;
    await tx`UPDATE tmp_addr SET id = nextval(pg_get_serial_sequence('customer_address', 'id')), legal_dong_code = ${o.dong}, lat = ${o.lat}, lng = ${o.lng}, is_default = false`;
    const [a] = await tx<{ id: string }[]>`INSERT INTO customer_address SELECT * FROM tmp_addr RETURNING id`;
    await tx`CREATE TEMP TABLE tmp_order AS SELECT * FROM service_order WHERE id = ${src!.id}`;
    const at = `${o.date}T${o.hm}:00+09:00`;
    await tx`UPDATE tmp_order SET id = nextval(pg_get_serial_sequence('service_order', 'id')), order_no = ${no}, address_id = ${a!.id},
      promised_at = ${at}::timestamptz, status = ${o.status ?? 'ASSIGN_WAIT'}, required_tech_count = ${o.people ?? 1},
      arrival_window_start = ${o.window ? `${o.date}T${o.window[0]}:00+09:00` : null}::timestamptz,
      arrival_window_end = ${o.window ? `${o.date}T${o.window[1]}:00+09:00` : null}::timestamptz`;
    const [n] = await tx<{ id: string }[]>`INSERT INTO service_order SELECT * FROM tmp_order RETURNING id`;
    await tx`CREATE TEMP TABLE tmp_item AS SELECT * FROM order_item WHERE order_id = ${src!.id}`;
    await tx`UPDATE tmp_item SET id = nextval(pg_get_serial_sequence('order_item', 'id')), order_id = ${n!.id}`;
    await tx`INSERT INTO order_item SELECT * FROM tmp_item`;
  });
}

/** 운영자 배정 대신 SQL로 확정 배정 (코스 시나리오 준비용) */
async function assignTo(no: string, tech: string) {
  const [o] = await sql<{ id: string }[]>`SELECT id FROM service_order WHERE order_no = ${no}`;
  await sql`INSERT INTO assignment (order_id, technician_id, role, assign_method, status, accepted_at) VALUES (${o!.id}, ${tech}, 'MAIN', 'MANUAL', 'ACCEPTED', now())`;
  await sql`UPDATE service_order SET status = 'ASSIGNED' WHERE id = ${o!.id}`;
}

test('준비: 기사 2명 등록·숙련·근무 + 고객 예약 1건', async ({ page, browser }) => {
  await adminLogin(page);
  await registerTech(page, TA);
  await registerTech(page, TB);
  const rows = await sql<
    { id: string; code: string }[]
  >`SELECT id, tech_code AS code FROM technician WHERE tech_code IN (${TA.code}, ${TB.code})`;
  for (const r of rows) {
    techId[r.code] = r.id;
    await sql`UPDATE technician SET status = 'ACTIVE', accompany_required_count = 0 WHERE id = ${r.id}`;
    await sql`INSERT INTO technician_skill (technician_id, device_type, skill_level) VALUES (${r.id}, 'WALL', 'CAN_SOLO')
      ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO work_schedule (technician_id, work_date, schedule_type)
      SELECT ${r.id}, d::date, 'WORK' FROM generate_series((now() AT TIME ZONE 'Asia/Seoul')::date, (now() AT TIME ZONE 'Asia/Seoul')::date + 8, '1 day') d
      ON CONFLICT (technician_id, work_date) DO UPDATE SET schedule_type = 'WORK'`;
  }

  // 고객: 불광동 주소로 예약(현장 결제) → 이후 SQL 복제 원본
  const cu = await customerLogin(browser);
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
  await cu.getByRole('textbox', { name: '이름' }).fill('코스고객');
  await cu.getByRole('textbox', { name: '휴대폰 번호' }).fill(CUSTOMER_PHONE);
  await cu.getByRole('button', { name: '인증번호 받기' }).click();
  const code = ((await cu.locator('.cus-mock-box strong').textContent()) ?? '').trim();
  await cu.getByRole('textbox', { name: '인증번호' }).fill(code);
  await cu.getByRole('button', { name: '확인' }).click();
  await expect(cu).toHaveURL(/\/login\/terms/, { timeout: 30_000 });
  await cu.getByRole('checkbox', { name: '전체 동의' }).check();
  await cu.getByRole('button', { name: '동의하고 가입하기' }).click();
  await expect(cu.getByRole('heading', { name: '방문 날짜와 시간을 골라 주세요' })).toBeVisible({
    timeout: 30_000,
  });
  await cu.getByRole('group', { name: '방문 시간' }).getByRole('button').first().click();
  const notice = cu.getByRole('dialog', { name: '할증 시간대예요' });
  if (await notice.isVisible().catch(() => false)) await notice.getByRole('button', { name: '확인' }).click();
  await cu.getByRole('button', { name: '다음' }).click();
  await cu.getByRole('textbox', { name: '상세주소' }).fill('101동 303호');
  await cu.getByRole('button', { name: '아파트' }).click();
  await cu.getByRole('button', { name: '다음' }).click();
  await cu.getByRole('radio', { name: '현장 결제' }).check();
  await cu.getByRole('checkbox', { name: '취소 규정을 확인했어요 (필수)' }).check();
  await cu.getByRole('button', { name: '예약 확정' }).click();
  // 다른 단계 E2E가 같은 예시 주소로 예약해 두었으면 중복 확인 창이 뜬다(BR-022)
  const dup = cu.getByRole('dialog', { name: '이미 진행 중인 예약이 있어요' });
  await expect(cu.getByRole('heading', { name: '예약이 접수됐어요' }).or(dup)).toBeVisible({
    timeout: 30_000,
  });
  if (await dup.isVisible()) await dup.getByRole('button', { name: '새로 예약' }).click();
  await expect(cu).toHaveURL(/\/reserve\/done\/\d{10}[A-Z]\d$/, { timeout: 30_000 });
  srcOrderNo = cu.url().split('/').pop()!;
  // 원본은 시나리오에서 쓰지 않도록 취소 상태로 둔다(복제만 사용)
  await sql`UPDATE service_order SET status = 'CANCELED' WHERE order_no = ${srcOrderNo}`;
});

test('A-DSP-060 관할 구역 지정(법정동 선택·지도에 그리기) → 활동지역 반영·빈 곳/겹침 표시', async ({
  page,
}) => {
  await adminLogin(page);
  await page.goto(`/admin/dsp/zones?branchId=${branchId}`);
  await expect(page.getByRole('heading', { name: '기사 관할 구역 지정' })).toBeVisible();
  const map = page.getByRole('group', { name: /관할 구역 지도/ });

  // 기사 가: 주 관할 = 불광동·대조동 (법정동 선택)
  await page.getByRole('button', { name: new RegExp(TA.name) }).click();
  await page.getByRole('button', { name: '구역 추가' }).click();
  await page.getByRole('textbox', { name: '구역명' }).fill('불광·대조');
  await map.getByRole('button', { name: /불광동/ }).click();
  await map.getByRole('button', { name: /대조동/ }).click();
  await expect(map.getByRole('button', { name: /불광동/ })).toHaveAttribute('aria-pressed', 'true');
  await saveZoneForm(page);
  await expect(page.locator('.ac-map__zone')).toHaveCount(1);

  // 기사 나: 주 관할 = 역촌동 (지도에 직접 그리기: 역촌동 점 주변 세 점), 보조 관할 = 대조동
  await page.getByRole('button', { name: new RegExp(TB.name) }).click();
  await page.getByRole('button', { name: '구역 추가' }).click();
  await page.getByRole('textbox', { name: '구역명' }).fill('역촌');
  await page.getByRole('combobox', { name: '구역 구분' }).selectOption('PRIMARY');
  await page.getByRole('combobox', { name: '지정 방식' }).selectOption('DRAWN');
  const dot = await map.getByRole('button', { name: /역촌동/ }).boundingBox();
  const box = await map.boundingBox();
  const cx = dot!.x + dot!.width / 2 - box!.x;
  const cy = dot!.y + dot!.height / 2 - box!.y;
  for (const [dx, dy] of [
    [-70, -50],
    [70, -50],
    [0, 60],
  ] as const)
    await map.click({ position: { x: cx + dx, y: cy + dy } });
  await expect(page.locator('.ac-map__draft')).toHaveCount(1);
  await saveZoneForm(page);

  await page.getByRole('button', { name: '구역 추가' }).click();
  await page.getByRole('textbox', { name: '구역명' }).fill('대조 보조');
  await page.getByRole('combobox', { name: '구역 구분' }).selectOption('SECONDARY');
  await map.getByRole('button', { name: /대조동/ }).click();
  await saveZoneForm(page);

  // 활동지역(technician_area) = 구역에서 다시 만들어짐 (주 1·보조 2)
  const areas = await sql<{ code: string; tech: string; priority: number }[]>`
    SELECT a.legal_dong_code AS code, t.tech_code AS tech, a.priority FROM technician_area a JOIN technician t ON t.id = a.technician_id
    WHERE t.tech_code IN (${TA.code}, ${TB.code}) ORDER BY t.tech_code, a.legal_dong_code`;
  expect(areas.map((a) => `${a.tech}:${a.code}:${a.priority}`)).toEqual([
    `${TA.code}:${DONG.BULGWANG}:1`,
    `${TA.code}:${DONG.DAEJO}:1`,
    `${TB.code}:${DONG.YEOKCHON}:1`,
    `${TB.code}:${DONG.DAEJO}:2`,
  ]);
  // 서비스 지역 3곳 모두 주 관할이 있다 → 빈 곳 0
  await expect(page.locator('.adm-board-summary')).toContainText('주 관할 없는 동 0');
});

test('T-MAP-010 기사 지도에 관할 경계가 보이고, 관할 밖 미배정 작업은 보이지 않는다(BR-110)', async ({
  browser,
}) => {
  await cloneOrder('E42U1', { dong: DONG.BULGWANG, lat: 37.6181, lng: 126.9301, date: D1, hm: '11:07' });
  await cloneOrder('E42U2', { dong: DONG.DAEJO, lat: 37.6139, lng: 126.9205, date: D1, hm: '13:13' });
  await cloneOrder('E42U3', { dong: DONG.YEOKCHON, lat: 37.6108, lng: 126.9158, date: D1, hm: '11:23' });

  const a = await techLogin(browser, TA);
  await a.goto(`/tech/map?date=${D1}`);
  await expect(a.locator('.ac-map__zone')).toHaveCount(1);
  // 불광(11:07)·대조(13:13)는 보이고 역촌(11:23)은 관할 밖이라 안 보인다 (다른 단계 E2E 주문이 섞여 있어 시각으로 구분)
  await expect(a.getByRole('button', { name: /^미배정 .*11:07/ })).toHaveCount(1);
  await expect(a.getByRole('button', { name: /^미배정 .*13:13/ })).toHaveCount(1);
  await expect(a.getByRole('button', { name: /^미배정 .*11:23/ })).toHaveCount(0);
  await a.getByRole('button', { name: /^미배정 .*11:07/ }).click();
  await expect(a.getByRole('region', { name: '선택한 미배정 작업' })).toBeVisible();

  const b = await techLogin(browser, TB);
  await b.goto(`/tech/map?date=${D1}`);
  await expect(b.locator('.ac-map__zone')).toHaveCount(2); // 주(그림) + 보조
  await expect(b.getByRole('button', { name: /^미배정 .*11:23/ })).toHaveCount(1); // 역촌(주)
  await expect(b.getByRole('button', { name: /^미배정 .*13:13/ })).toHaveCount(1); // 대조(보조)
  await expect(b.getByRole('button', { name: /^미배정 .*11:07/ })).toHaveCount(0); // 불광은 관할 밖
});

test('F-TEC-RTE-04 자가 배정: 두 기사가 같은 작업을 동시에 담으면 한 명만 성공 → A-DSP-020 승인/거절(BR-111)', async ({
  browser,
  page,
}) => {
  const a = await techLogin(browser, TA);
  const b = await techLogin(browser, TB);
  // 동시에 같은 작업(대조동 E42U2) 담기
  for (const t of [a, b]) {
    await t.goto(`/tech/route/unassigned?date=${D1}`);
    await expect(
      t
        .locator('li.tec-open-job')
        .filter({ hasText: '13:13' })
        .getByRole('button', { name: '내 일정에 넣기' }),
    ).toBeVisible();
  }
  const card = (t: Page) =>
    t.locator('li.tec-open-job').filter({ has: t.getByRole('button', { name: '내 일정에 넣기' }) });
  // E42U2 = 오후 1시 카드
  const pick = async (t: Page) => {
    await card(t).filter({ hasText: '13:13' }).getByRole('button', { name: '내 일정에 넣기' }).click();
  };
  await Promise.all([pick(a), pick(b)]);
  await Promise.all([
    a
      .getByRole('dialog', { name: '내 일정에 넣으시겠습니까?' })
      .getByRole('button', { name: '넣기' })
      .click(),
    b
      .getByRole('dialog', { name: '내 일정에 넣으시겠습니까?' })
      .getByRole('button', { name: '넣기' })
      .click(),
  ]);
  // 두 화면 모두 결과(성공 토스트 또는 실패 알림)가 나올 때까지
  for (const t of [a, b])
    await expect(
      t
        .locator('.ac-toast, .ac-alert--danger')
        .filter({ hasText: /승인을 요청했습니다|이미/ })
        .first(),
    ).toBeVisible({ timeout: 30_000 });
  const [act] = await sql<{ n: number; tech: string }[]>`
    SELECT count(*)::int AS n, max(a.technician_id)::text AS tech FROM assignment a JOIN service_order o ON o.id = a.order_id
    WHERE o.order_no = 'E42U2' AND a.role = 'MAIN' AND a.status IN ('REQUESTED', 'ACCEPTED')`;
  expect(act!.n).toBe(1);
  const loser = act!.tech === techId[TA.code] ? b : a;
  await expect(loser.locator('.ac-alert--danger')).toContainText('이미');

  // 기사 가: 불광동(E42U1) 담기 → 승인 대기, 기사 나: 역촌동(E42U3) 담기 → 승인 대기
  await a.goto(`/tech/route/unassigned?date=${D1}`);
  await card(a).filter({ hasText: '11:07' }).getByRole('button', { name: '내 일정에 넣기' }).click();
  await a
    .getByRole('dialog', { name: '내 일정에 넣으시겠습니까?' })
    .getByRole('button', { name: '넣기' })
    .click();
  await expect(a.locator('.ac-toast').filter({ hasText: '승인을 요청했습니다' }).last()).toBeVisible();
  await b.goto(`/tech/route/unassigned?date=${D1}`);
  await card(b).filter({ hasText: '11:23' }).getByRole('button', { name: '내 일정에 넣기' }).click();
  await b
    .getByRole('dialog', { name: '내 일정에 넣으시겠습니까?' })
    .getByRole('button', { name: '넣기' })
    .click();
  await expect(b.locator('.ac-toast').filter({ hasText: '승인을 요청했습니다' }).last()).toBeVisible();

  // A-DSP-010 배정 보드: 승인 대기 표시
  await adminLogin(page);
  await page.goto(`/admin/dsp/board?branchId=${branchId}&date=${D1}`);
  await expect(page.getByRole('link', { name: /자가 배정 승인 대기\s*3\s*건/ })).toBeVisible();

  // A-DSP-020 [자가 배정 요청]: E42U1 거절(사유 필수) · E42U3·E42U2 승인
  await page.goto('/admin/dsp/transfers?tab=self');
  const row = (no: string) => page.locator('tbody tr').filter({ hasText: no });
  await row('E42U1').getByRole('button', { name: '처리' }).click();
  let m = page.getByRole('dialog', { name: '자가 배정 요청 처리' });
  await m.getByRole('button', { name: '거절' }).click();
  await expect(m).toContainText('거절 사유는 필수 입력값입니다.');
  await m.getByRole('textbox', { name: '거절 사유' }).fill('다른 기사 일정과 겹침');
  await m.getByRole('button', { name: '거절' }).click();
  await page
    .getByRole('dialog', { name: '자가 배정 요청을 거절하시겠습니까?' })
    .getByRole('button', { name: '거절' })
    .click();
  await savedToast(page);
  await expect(row('E42U1')).toHaveCount(0);
  for (const no of ['E42U3', 'E42U2']) {
    await row(no).getByRole('button', { name: '처리' }).click();
    m = page.getByRole('dialog', { name: '자가 배정 요청 처리' });
    await m.getByRole('button', { name: '승인' }).click();
    await page
      .getByRole('dialog', { name: '자가 배정을 승인하시겠습니까?' })
      .getByRole('button', { name: '승인' })
      .click();
    await savedToast(page);
    await expect(row(no)).toHaveCount(0);
  }
  const st = await sql<
    { no: string; status: string }[]
  >`SELECT order_no AS no, status FROM service_order WHERE order_no IN ('E42U1', 'E42U2', 'E42U3') ORDER BY order_no`;
  expect(st.map((s) => `${s.no}:${s.status}`)).toEqual([
    'E42U1:ASSIGN_WAIT',
    'E42U2:ASSIGNED',
    'E42U3:ASSIGNED',
  ]);
  const hist = await sql<{ action: string }[]>`
    SELECT h.action FROM assignment_history h JOIN service_order o ON o.id = h.order_id WHERE o.order_no = 'E42U1' ORDER BY h.id`;
  expect(hist.map((h) => h.action)).toEqual(['SELF_REQUEST', 'SELF_REJECT']);
});

test('T-RTE-010 순서 변경 즉시 재계산 · 시간창 위반이면 확정 불가 · 추천 전/후 비교 · 확정 → 고객 방문 예정 안내', async ({
  browser,
}) => {
  // 기사 가의 모레 코스: 동·서로 지그재그(약속 시각 순) + 마지막 서쪽 집은 09:00~09:30 에 와야 함 → 위반
  const W: [string, string] = ['09:00', '18:00'];
  await cloneOrder('E42R1', {
    dong: DONG.BULGWANG,
    lat: 37.6177,
    lng: 126.95,
    date: D2,
    hm: '10:00',
    window: W,
  });
  await cloneOrder('E42R2', {
    dong: DONG.BULGWANG,
    lat: 37.6177,
    lng: 126.9,
    date: D2,
    hm: '10:01',
    window: W,
  });
  await cloneOrder('E42R3', {
    dong: DONG.BULGWANG,
    lat: 37.62,
    lng: 126.952,
    date: D2,
    hm: '10:02',
    window: W,
  });
  await cloneOrder('E42R4', {
    dong: DONG.BULGWANG,
    lat: 37.615,
    lng: 126.898,
    date: D2,
    hm: '10:03',
    window: ['09:00', '09:30'],
  });
  for (const no of ['E42R1', 'E42R2', 'E42R3', 'E42R4']) await assignTo(no, techId[TA.code]!);

  const a = await techLogin(browser, TA);
  await a.goto(`/tech/map?date=${D2}`);
  await expect(a.locator('.ac-map__route')).toHaveCount(1);
  await a.getByRole('link', { name: '코스 짜기' }).click();
  await expect(a).toHaveURL(new RegExp(`/tech/route\\?date=${D2}`), { timeout: 30_000 });
  const stops = a.locator('.tec-route-stop');
  await expect(stops).toHaveCount(4, { timeout: 30_000 });

  // BR-112: 위반이 있으면 확정 버튼이 막힌다
  await expect(a.locator('.ac-alert--danger')).toContainText('도착 허용 시간을 벗어난 방문지가 1곳');
  await expect(a.getByRole('button', { name: '코스 확정' })).toBeDisabled();

  // F-TEC-RTE-01: 1번을 아래로 → 저장 전에도 도착 예정이 바로 바뀐다
  const before = await stops.nth(1).locator('.tec-route-stop__head').textContent();
  await stops.nth(0).getByRole('button', { name: '아래로' }).click();
  await expect(stops.nth(1).locator('.tec-route-stop__head')).not.toHaveText(before ?? '');
  await expect(a.locator('.tec-route-summary')).toContainText('편집 중');

  // F-TEC-RTE-02: 추천 → 전/후 비교 (이동시간 감소, 위반 0)
  await a.getByRole('button', { name: '최적 코스 추천' }).click();
  const rec = a.getByRole('dialog', { name: '최적 코스 추천' });
  await expect(rec).toContainText('줄일 수 있습니다');
  const cells = rec.locator('tbody tr');
  const nums = async (i: number) =>
    (await cells.nth(i).locator('td').allTextContents()).map((t) => Number(t.replace(/[^\d.]/g, '')));
  const [travelBefore, travelAfter] = await nums(0);
  expect(travelAfter!).toBeLessThan(travelBefore!);
  expect((await nums(2))[1]).toBe(0);
  await rec.getByRole('button', { name: '추천 적용' }).click();
  await expect(a.locator('.ac-toast').filter({ hasText: '추천 코스를 적용했습니다.' }).last()).toBeVisible();
  await expect(a.locator('.ac-alert--danger')).toHaveCount(0);

  // F-TEC-RTE-03: 확정 → 고객 4건 방문 예정 안내
  await a.getByRole('button', { name: '코스 확정' }).click();
  await a
    .getByRole('dialog', { name: '코스를 확정하시겠습니까?' })
    .getByRole('button', { name: '확정' })
    .click();
  await expect(
    a.locator('.ac-toast').filter({ hasText: '고객 4명에게 방문 예정 시간을 안내했습니다.' }).last(),
  ).toBeVisible();
  const [plan] = await sql<{ status: string; notified: number }[]>`
    SELECT p.status, (SELECT count(*)::int FROM route_stop s WHERE s.route_plan_id = p.id AND s.notified_arrival IS NOT NULL) AS notified
    FROM route_plan p WHERE p.technician_id = ${techId[TA.code]!} AND p.plan_date = ${D2}`;
  expect(plan).toMatchObject({ status: 'CONFIRMED', notified: 4 });
  const logs = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM notification_log l JOIN notification_template t ON t.id = l.template_id
    JOIN service_order o ON o.id = l.related_id WHERE t.template_code = 'VISIT_TIME_NOTICE' AND o.order_no LIKE 'E42R%'`;
  expect(logs[0]!.n).toBeGreaterThanOrEqual(4);

  // C-ORD-020: 고객은 좌표 없이 방문 예정 시각만 본다(BR-115)
  const cu = await customerLogin(browser);
  await cu.goto('/login');
  await cu.getByRole('link', { name: '휴대폰 번호로 계속하기' }).click();
  await cu.getByRole('textbox', { name: '이름' }).fill('코스고객');
  await cu.getByRole('textbox', { name: '휴대폰 번호' }).fill(CUSTOMER_PHONE);
  await cu.getByRole('button', { name: '인증번호 받기' }).click();
  const code = ((await cu.locator('.cus-mock-box strong').textContent()) ?? '').trim();
  await cu.getByRole('textbox', { name: '인증번호' }).fill(code);
  await cu.getByRole('button', { name: '확인' }).click();
  await cu.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
  await cu.goto('/orders/E42R1');
  await expect(cu.locator('main')).toContainText('방문 예정');
  await expect(cu.locator('main')).toContainText('전후');
});

test('F-SYS-16 마감이 지난 미확정 코스는 자동 확정된다(BR-113) · 배치 인증', async ({ request }) => {
  expect((await request.get('/api/jobs/route-autoconfirm')).status()).toBe(401);
  // 내일 코스(기사 나: 역촌 E42U3)의 마감을 지난 것으로 만든다: 마감 시각 00:00 → 오늘 00:00
  await sql`UPDATE system_setting SET setting_value = '00:00' WHERE setting_key = 'ROUTE_CONFIRM_DEADLINE'`;
  const auth = { headers: { authorization: `Bearer ${E2E_ENV.CRON_SECRET}` } };
  const res = await request.get('/api/jobs/route-autoconfirm', auth);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.confirmed).toBeGreaterThanOrEqual(1);
  await sql`UPDATE system_setting SET setting_value = '18:00' WHERE setting_key = 'ROUTE_CONFIRM_DEADLINE'`;
  const [plan] = await sql<
    { status: string }[]
  >`SELECT status FROM route_plan WHERE technician_id = ${techId[TB.code]!} AND plan_date = ${D1}`;
  expect(plan?.status).toBe('CONFIRMED');
  const push = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM notification_log l JOIN notification_template t ON t.id = l.template_id
    WHERE t.template_code = 'ROUTE_AUTO_CONFIRMED' AND l.receiver_type = 'TECHNICIAN' AND l.receiver_id = ${techId[TB.code]!}`;
  expect(push[0]!.n).toBe(1);
  const visit = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM notification_log l JOIN notification_template t ON t.id = l.template_id
    JOIN service_order o ON o.id = l.related_id WHERE t.template_code = 'VISIT_TIME_NOTICE' AND o.order_no = 'E42U3'`;
  expect(visit[0]!.n).toBe(1);

  for (const job of ['route-draft', 'route-remind', 'location-purge']) {
    expect((await request.get(`/api/jobs/${job}`)).status()).toBe(401);
    const r = await request.get(`/api/jobs/${job}`, auth);
    expect(r.status()).toBe(200);
    expect((await r.json()).ok).toBe(true);
  }
});

test('T-HOM-010 근무 시작(위치정보 수집 동의 1회) → 근무 중 위치 수집 → 근무 종료 후 미수집(BR-115)', async ({
  browser,
}) => {
  const a = await techLogin(browser, TA, true);
  await a.getByRole('button', { name: '근무 시작' }).click();
  const consent = a.getByRole('dialog', { name: '위치정보 수집 동의' });
  await expect(consent).toContainText('근무 시작부터 근무 종료까지만');
  await consent.getByRole('button', { name: '동의하고 근무 시작' }).click();
  await expect(a.getByRole('heading', { name: '근무 중' })).toBeVisible();
  await expect
    .poll(
      async () =>
        (
          await sql<
            { n: number }[]
          >`SELECT count(*)::int AS n FROM technician_location WHERE technician_id = ${techId[TA.code]!}`
        )[0]!.n,
      { timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(1);
  const [t] = await sql<{ agreed: boolean; duty: boolean }[]>`
    SELECT location_agreed_at IS NOT NULL AS agreed, duty_started_at IS NOT NULL AS duty FROM technician WHERE id = ${techId[TA.code]!}`;
  expect(t).toEqual({ agreed: true, duty: true });
  const audit = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM audit_log WHERE actor_type = 'TECHNICIAN' AND actor_id = ${techId[TA.code]!} AND target_table = 'technician' AND detail_json->>'consent' = 'LOCATION'`;
  expect(audit[0]!.n).toBe(1);

  // 지도에 내 위치 핀 (오늘)
  await a.goto('/tech/map');
  await expect(a.getByRole('button', { name: /^내 위치/ })).toHaveCount(1);

  await a.goto('/tech');
  await a.getByRole('button', { name: '근무 종료' }).click();
  await expect(a.getByRole('heading', { name: '근무 전' })).toBeVisible();
  const [off] = await sql<
    { duty: boolean }[]
  >`SELECT duty_started_at IS NOT NULL AS duty FROM technician WHERE id = ${techId[TA.code]!}`;
  expect(off!.duty).toBe(false);
  // 다시 시작할 때는 동의를 묻지 않는다
  await a.getByRole('button', { name: '근무 시작' }).click();
  await expect(a.getByRole('heading', { name: '근무 중' })).toBeVisible();
  await expect(a.getByRole('dialog', { name: '위치정보 수집 동의' })).toHaveCount(0);
});
