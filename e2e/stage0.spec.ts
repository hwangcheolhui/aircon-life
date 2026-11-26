/**
 * 단계 0 완료 기준 (04 §2 단계 0):
 * 슈퍼관리자가 거점 1곳·관할 법정동·상품(벽걸이/스탠드/천장형/2in1)·가격·야간/휴일 할증을 등록하고,
 * 역할별로 보이는 메뉴가 달라진다. + BR-102 거점 범위, 로그인 5회 실패 잠금.
 */
import { type Page, expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

async function login(page: Page, id: string, pw: string) {
  await page.goto('/admin/login');
  await page.getByRole('textbox', { name: 'ID' }).fill(id);
  await page.getByLabel('비밀번호').fill(pw);
  await page.getByRole('button', { name: '로그인' }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'));
}

async function logout(page: Page) {
  await page.getByRole('button', { name: '로그아웃' }).click();
  await page.waitForURL(/\/admin\/login/);
}

type Value = string | { select: string } | { check: boolean };

/** 등록 모달 열기 → 값 입력 → 저장 → Confirm → 토스트 확인 */
async function create(page: Page, noun: string, values: Record<string, Value>) {
  await page.getByRole('button', { name: `${noun} 등록` }).click();
  const dialog = page.getByRole('dialog');
  for (const [label, v] of Object.entries(values)) {
    if (typeof v === 'string') await dialog.getByRole('textbox', { name: label, exact: true }).fill(v);
    else if ('select' in v) await dialog.getByRole('combobox', { name: label, exact: true }).selectOption({ label: v.select });
    else await dialog.getByRole('checkbox', { name: label, exact: true }).setChecked(v.check);
  }
  await dialog.getByRole('button', { name: '저장' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(page.locator('.ac-toast').filter({ hasText: '저장에 성공하였습니다.' }).last()).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

const menuNames = async (page: Page) => page.locator('.ac-gnb__menu a').allTextContents();

test('비로그인 사용자는 /admin 에 들어갈 수 없다', async ({ page }) => {
  await page.goto('/admin/sys/branches');
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-channel', 'customer');
});

test('슈퍼관리자가 기준 데이터를 등록한다', async ({ page }) => {
  await login(page, 'superadmin', 'E2e-super-1');
  await expect(page.locator('html')).toHaveAttribute('data-channel', 'admin');

  // A-SYS-030 거점
  await page.goto('/admin/sys/branches');
  await page.getByRole('button', { name: '거점 등록' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '저장' }).click();
  await expect(page.getByText('거점 코드는 필수 입력값입니다.')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '닫기' }).click();
  await create(page, '거점', { '거점 코드': 'EP01', 거점명: '은평거점', '운영 상태': { select: '운영중' } });
  await create(page, '거점', { '거점 코드': 'BP01', 거점명: '부평거점' });

  // A-DSP-050 관할 법정동
  await page.goto('/admin/dsp/areas');
  await create(page, '관할 지역', {
    '담당 거점': { select: '은평거점' },
    '법정동 코드': '1138010400',
    시도: '서울특별시',
    시군구: '은평구',
    읍면동: '불광동',
  });
  await create(page, '관할 지역', { '담당 거점': { select: '부평거점' }, 시도: '인천광역시', 시군구: '부평구', 읍면동: '부평동' });
  await expect(page.locator('table tbody tr')).toHaveCount(2);

  // A-PRD-010 카테고리 → A-PRD-011 상품 4종
  await page.goto('/admin/prd/categories');
  await create(page, '카테고리', { '카테고리 코드': 'AIRCON_CLEAN', 표시명: '에어컨 청소' });
  await page.goto('/admin/prd/products');
  const products: [string, string, string][] = [
    ['AC-WALL-FULL', '벽걸이 완전분해 세척', '벽걸이'],
    ['AC-STAND-FULL', '스탠드 완전분해 세척', '스탠드'],
    ['AC-CEIL4-FULL', '천장형 4way 완전분해 세척', '천장형4way'],
    ['AC-2IN1-FULL', '2in1 완전분해 세척', '2in1'],
  ];
  for (const [code, name, device] of products) {
    await create(page, '상품', {
      카테고리: { select: '에어컨 청소' },
      '상품 코드': code,
      상품명: name,
      '기기 형태': { select: device },
      '작업 범위': { select: '완전분해' },
    });
  }
  await expect(page.locator('table tbody tr')).toHaveCount(4);

  // A-PRD-020 가격 + 미리보기 (BR-010)
  await page.goto('/admin/prd/prices');
  await create(page, '가격 정책', {
    상품: { select: '벽걸이 완전분해 세척' },
    '1대 단가(원, 부가세 포함)': '90000',
    '적용 시작일': '2027-01-01',
  });
  await create(page, '가격 정책', {
    상품: { select: '벽걸이 완전분해 세척' },
    거점: { select: '은평거점' },
    '1대 단가(원, 부가세 포함)': '85000',
    '적용 시작일': '2027-01-01',
  });
  const preview = page.locator('form').filter({ has: page.getByRole('button', { name: '미리보기' }) });
  await preview.getByRole('combobox', { name: '상품' }).selectOption({ label: '벽걸이 완전분해 세척' });
  await preview.getByRole('combobox', { name: '거점' }).selectOption({ label: '은평거점' });
  await preview.getByLabel('적용일').fill('2027-03-01');
  await preview.getByRole('button', { name: '미리보기' }).click();
  // 미리보기 결과(목록 셀의 같은 금액과 구분)
  await expect(page.locator('strong.ac-num', { hasText: '85,000원' })).toBeVisible();

  // A-PRD-030 야간·휴일 할증
  await page.goto('/admin/prd/surcharges');
  await create(page, '규칙', { '규칙 코드': { select: '야간 방문 할증' }, 표시명: '야간 방문 할증', '금액(원 또는 %)': '30000', '조건(JSON)': '{"weekday":true,"after":"18:00"}' });
  await create(page, '규칙', { '규칙 코드': { select: '휴일 방문 할증' }, 표시명: '휴일 방문 할증', '금액(원 또는 %)': '30000', '조건(JSON)': '{"weekend":true,"holiday":true}' });
  await expect(page.locator('table tbody tr')).toHaveCount(2);

  // A-SYS-010 상담원·거점장 계정
  await page.goto('/admin/sys/accounts');
  await create(page, '관리자 계정', {
    ID: 'cs01',
    이름: '상담원일',
    '이메일(로그인 계정)': 'cs01@example.invalid',
    연락처: '010-0000-0001',
    역할: { select: '상담원' },
    '초기 비밀번호': 'Cs-pass-01',
  });
  await create(page, '관리자 계정', {
    ID: 'bp01',
    이름: '부평거점장',
    '이메일(로그인 계정)': 'bp01@example.invalid',
    역할: { select: '거점장' },
    '소속 거점': { select: '부평거점' },
    '초기 비밀번호': 'Bp-pass-01',
  });
  // 목록은 마스킹 (BR-100)
  await expect(page.getByText('010-****-0001')).toBeVisible();
  await expect(page.getByText('상담원일')).toHaveCount(0);
  await expect(await menuNames(page)).toEqual(['상담', '접수·주문', '배정·일정', '처리', '고객', '기사', '상품·가격', '결제', '정산', 'CRM·VOC', '시스템']);
  await logout(page);
});

test('역할별로 보이는 메뉴가 다르다 (03 §4.4)', async ({ page }) => {
  await login(page, 'cs01', 'Cs-pass-01');
  expect(await menuNames(page)).toEqual(['상담', '접수·주문', '배정·일정', '처리', '고객', '기사', '상품·가격', '결제', 'CRM·VOC']);
  await page.goto('/admin/sys/accounts');
  await expect(page).toHaveURL(/denied=A-SYS-010/);
  // 상담원은 상품을 조회만 한다 (등록 버튼 없음)
  await page.goto('/admin/prd/products');
  await expect(page.getByRole('button', { name: '상품 등록' })).toHaveCount(0);
  await logout(page);

  await login(page, 'bp01', 'Bp-pass-01');
  expect(await menuNames(page)).toEqual(['상담', '접수·주문', '배정·일정', '처리', '고객', '기사', '상품·가격', '결제', '정산', 'CRM·VOC']);
  // BR-102 거점장은 자기 거점 관할 지역만 본다
  await page.goto('/admin/dsp/areas');
  await expect(page.locator('table tbody tr')).toHaveCount(1);
  await expect(page.locator('table tbody')).toContainText('부평동');
  await expect(page.locator('.ac-gnb__tools')).toContainText('부평거점');
  await logout(page);
});

test('비밀번호를 5회 틀리면 계정이 잠기고 슈퍼관리자가 해제한다', async ({ page }) => {
  for (let i = 1; i <= 5; i++) {
    await page.goto('/admin/login');
    await page.getByRole('textbox', { name: 'ID' }).fill('cs01');
    await page.getByLabel('비밀번호').fill('wrong-pass-1');
    await page.getByRole('button', { name: '로그인' }).click();
    await expect(page.getByRole('alert').first()).toContainText(i < 5 ? `남은 시도 ${5 - i}회` : '계정이 잠겼습니다');
  }
  await page.getByRole('textbox', { name: 'ID' }).fill('cs01');
  await page.getByLabel('비밀번호').fill('Cs-pass-01');
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.getByRole('alert').first()).toContainText('잠겼습니다');

  await login(page, 'superadmin', 'E2e-super-1');
  await page.goto('/admin/sys/accounts');
  await page.locator('tr', { hasText: 'cs01' }).dblclick();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox', { name: '이름', exact: true })).toHaveValue('상담원일');
  await dialog.getByRole('combobox', { name: '계정 상태' }).selectOption({ label: '사용' });
  await dialog.getByRole('button', { name: '저장' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(page.locator('.ac-toast').last()).toContainText('저장에 성공하였습니다.');
  await logout(page);
  await login(page, 'cs01', 'Cs-pass-01');
  expect(await menuNames(page)).toEqual(['상담', '접수·주문', '배정·일정', '처리', '고객', '기사', '상품·가격', '결제', 'CRM·VOC']);
});

test('역할·권한을 바꾸면 메뉴가 바로 달라진다 (A-SYS-020)', async ({ page }) => {
  await login(page, 'superadmin', 'E2e-super-1');
  await page.goto('/admin/sys/roles');
  await page.getByRole('tab', { name: '상담원' }).click();
  await page.getByRole('checkbox', { name: '거점 관리 조회' }).check();
  await page.getByRole('button', { name: '저장' }).click();
  await page.getByRole('dialog', { name: '저장하시겠습니까?' }).getByRole('button', { name: '저장' }).click();
  await expect(page.locator('.ac-toast').last()).toContainText('저장에 성공하였습니다.');
  await logout(page);
  await login(page, 'cs01', 'Cs-pass-01');
  expect(await menuNames(page)).toEqual(['상담', '접수·주문', '배정·일정', '처리', '고객', '기사', '상품·가격', '결제', 'CRM·VOC', '시스템']);
  await page.goto('/admin/sys/branches');
  await expect(page.getByRole('button', { name: '거점 등록' })).toHaveCount(0);
});
