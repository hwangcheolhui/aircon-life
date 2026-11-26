import { describe, expect, it } from 'vitest';
import {
  type CommissionPolicyLike,
  assertBatchTransition,
  assertSettlementTransition,
  batchNoOf,
  calcJobShares,
  canAdjustSettlement,
  canTransitionBatch,
  canTransitionSettlement,
  checkAdjustment,
  checkBatchConfirm,
  checkCommissionPolicy,
  checkDisputeResolve,
  checkTechResponse,
  isMonday,
  isSettlementLocked,
  isoWeek,
  manualItemAmount,
  previousWeek,
  scheduledPayDateOf,
  selectCommissionPolicy,
  splitTransferTargets,
  summarizeSettlement,
  weekOf,
  withholdingOf,
} from './settlement-rules';

const policy = (p: Partial<CommissionPolicyLike> = {}): CommissionPolicyLike => ({
  id: 1,
  policyName: '기본',
  techGrade: null,
  contractType: null,
  branchId: null,
  calcType: 'RATE',
  techShareRate: 55,
  perUnitAmount: null,
  extraChargeShareRate: 70,
  supportRoleRate: 30,
  withholdingRate: 3.3,
  validFrom: '2026-01-01',
  validTo: null,
  ...p,
});

const job = (p: Partial<Parameters<typeof calcJobShares>[0]> = {}) => ({
  totalAmount: 120000,
  extraAmount: 30000,
  units: 1,
  mainTechnicianId: 10,
  supportTechnicianIds: [] as number[],
  accompanyTechnicianIds: [] as number[],
  ...p,
});

describe('BR-080 정산 주기 주 1회(월~일 집계)', () => {
  it('BR-080 날짜가 속한 주의 월~일', () => {
    expect(weekOf('2026-11-18')).toEqual({ periodStart: '2026-11-16', periodEnd: '2026-11-22' });
    expect(weekOf('2026-11-16')).toEqual({ periodStart: '2026-11-16', periodEnd: '2026-11-22' });
    expect(weekOf('2026-11-22')).toEqual({ periodStart: '2026-11-16', periodEnd: '2026-11-22' });
  });

  it('BR-080 월요일 배치(F-SYS-10)는 지난주 월~일 회차를 만든다', () => {
    expect(previousWeek('2026-11-23')).toEqual({ periodStart: '2026-11-16', periodEnd: '2026-11-22' });
  });

  it('BR-080 회차 번호는 ISO 주차 S2026-W47, 거점 회차는 거점 코드를 붙인다', () => {
    expect(isoWeek('2026-11-16')).toEqual({ year: 2026, week: 47 });
    expect(batchNoOf('2026-11-16')).toBe('S2026-W47');
    expect(batchNoOf('2026-11-16', 'EP01')).toBe('S2026-W47-EP01');
    // 해가 바뀌는 주: 2026-12-28(월) 주의 목요일은 2026-12-31 → 2026년 53주
    expect(batchNoOf('2026-12-28')).toBe('S2026-W53');
    expect(batchNoOf('2027-01-04')).toBe('S2027-W01');
  });

  it('BR-080 지급 예정일 = 기간 끝 다음 주의 지급 요일(설정값)', () => {
    expect(scheduledPayDateOf('2026-11-22', 'WED')).toBe('2026-11-25');
    expect(scheduledPayDateOf('2026-11-22', 'MON')).toBe('2026-11-23');
  });

  it('BR-080 예외: 회차 시작일은 월요일만', () => {
    expect(isMonday('2026-11-16')).toBe(true);
    expect(isMonday('2026-11-17')).toBe(false);
    expect(isMonday('abc')).toBe(false);
  });
});

describe('상태 전이 (01 §3.3)', () => {
  it('회차 DRAFT → CALCULATED → CONFIRMED → PAID → CLOSED', () => {
    expect(canTransitionBatch('DRAFT', 'CALCULATED')).toBe(true);
    expect(canTransitionBatch('CALCULATED', 'CONFIRMED')).toBe(true);
    expect(canTransitionBatch('CONFIRMED', 'PAID')).toBe(true);
    expect(canTransitionBatch('PAID', 'CLOSED')).toBe(true);
  });

  it('예외: 회차는 단계를 건너뛰거나 되돌릴 수 없다', () => {
    expect(canTransitionBatch('DRAFT', 'CONFIRMED')).toBe(false);
    expect(canTransitionBatch('CONFIRMED', 'CALCULATED')).toBe(false);
    expect(() => assertBatchTransition('CLOSED', 'PAID')).toThrow();
  });

  it('기사별 CALCULATED → 확인/이의 → CONFIRMED → PAID, 미응답은 회차 확정 때 함께 확정', () => {
    expect(canTransitionSettlement('CALCULATED', 'TECH_CONFIRMED')).toBe(true);
    expect(canTransitionSettlement('CALCULATED', 'DISPUTED')).toBe(true);
    expect(canTransitionSettlement('CALCULATED', 'CONFIRMED')).toBe(true);
    expect(canTransitionSettlement('DISPUTED', 'CONFIRMED')).toBe(true);
    expect(canTransitionSettlement('CONFIRMED', 'PAID')).toBe(true);
  });

  it('예외: 확인한 정산서는 다시 이의로, 지급된 정산서는 어디로도 못 간다', () => {
    expect(canTransitionSettlement('TECH_CONFIRMED', 'DISPUTED')).toBe(false);
    expect(canTransitionSettlement('DISPUTED', 'TECH_CONFIRMED')).toBe(false);
    expect(() => assertSettlementTransition('PAID', 'CONFIRMED')).toThrow();
  });
});

describe('F-ADM-STL-01 수수료 정책 선택', () => {
  const tech = { grade: 'REGULAR', contractType: 'FREELANCER', branchId: 7 };

  it('더 구체적인 정책이 이긴다 (거점 > 등급 > 계약형태)', () => {
    const all = [
      policy({ id: 1 }),
      policy({ id: 2, techGrade: 'REGULAR' }),
      policy({ id: 3, contractType: 'FREELANCER' }),
      policy({ id: 4, branchId: 7 }),
    ];
    expect(selectCommissionPolicy(all, tech, '2026-11-22')?.id).toBe(4);
    expect(selectCommissionPolicy(all.slice(0, 3), tech, '2026-11-22')?.id).toBe(2);
  });

  it('같은 조건이면 늦게 시작한 정책', () => {
    const all = [policy({ id: 1, validFrom: '2026-01-01' }), policy({ id: 2, validFrom: '2026-06-01' })];
    expect(selectCommissionPolicy(all, tech, '2026-11-22')?.id).toBe(2);
  });

  it('예외: 다른 등급·거점, 기간 밖 정책은 고르지 않는다', () => {
    const all = [
      policy({ id: 1, techGrade: 'TRAINEE' }),
      policy({ id: 2, branchId: 8 }),
      policy({ id: 3, validTo: '2026-10-31' }),
      policy({ id: 4, validFrom: '2026-12-01' }),
    ];
    expect(selectCommissionPolicy(all, tech, '2026-11-22')).toBeNull();
  });

  it('정책 입력: 계산 방식별 필수값과 비율 범위', () => {
    const base = { techShareRate: null, perUnitAmount: null, extraChargeShareRate: null, supportRoleRate: null, withholdingRate: 3.3 };
    expect(checkCommissionPolicy({ ...base, calcType: 'RATE' }).techShareRate).toContain('필수 입력값');
    expect(checkCommissionPolicy({ ...base, calcType: 'PER_UNIT' }).perUnitAmount).toContain('필수 입력값');
    expect(Object.keys(checkCommissionPolicy({ ...base, calcType: 'MIXED' }))).toEqual(['techShareRate', 'perUnitAmount']);
    expect(checkCommissionPolicy({ ...base, calcType: 'RATE', techShareRate: 120 }).techShareRate).toContain('0~100');
    expect(checkCommissionPolicy({ ...base, calcType: 'RATE', techShareRate: 55 })).toEqual({});
  });
});

describe('F-ADM-STL-02 건별 배분', () => {
  it('작업비 × 배분율 + 추가요금 × 추가요금 배분율', () => {
    const items = calcJobShares(job(), policy());
    expect(items).toEqual([
      expect.objectContaining({ technicianId: 10, role: 'MAIN', itemType: 'JOB', salesAmount: 90000, shareRate: 55, payAmount: 49500 }),
      expect.objectContaining({ technicianId: 10, role: 'MAIN', itemType: 'EXTRA', salesAmount: 30000, shareRate: 70, payAmount: 21000 }),
    ]);
  });

  it('2인 작업: 주기사 (100−지원율)% · 지원기사 지원율%, 합계는 배분액과 같다', () => {
    const items = calcJobShares(job({ extraAmount: 0, totalAmount: 90000, supportTechnicianIds: [11] }), policy());
    const main = items.find((i) => i.role === 'MAIN')!;
    const sup = items.find((i) => i.role === 'SUPPORT')!;
    expect(sup.payAmount).toBe(14850); // 49,500 × 30%
    expect(main.payAmount).toBe(34650); // 49,500 − 14,850
    expect(main.payAmount + sup.payAmount).toBe(49500);
    expect(main.shareRate).toBe(38.5);
    expect(sup.shareRate).toBe(16.5);
  });

  it('2인 작업 예외: 지원기사가 둘이면 지원 몫을 똑같이 나누고, 추가요금은 주기사만', () => {
    const items = calcJobShares(job({ supportTechnicianIds: [11, 12] }), policy());
    const sups = items.filter((i) => i.role === 'SUPPORT');
    expect(sups.map((s) => s.payAmount)).toEqual([7425, 7425]);
    expect(items.filter((i) => i.itemType === 'EXTRA').map((i) => i.technicianId)).toEqual([10]);
  });

  it('교육 동행(ACCOMPANY)은 0원 항목으로 남는다', () => {
    const items = calcJobShares(job({ extraAmount: 0, accompanyTechnicianIds: [13] }), policy());
    expect(items.find((i) => i.role === 'ACCOMPANY')).toEqual(expect.objectContaining({ technicianId: 13, payAmount: 0 }));
  });

  it('대당 고정(PER_UNIT)·혼합(MIXED) 계산', () => {
    const perUnit = calcJobShares(job({ extraAmount: 0, units: 3 }), policy({ calcType: 'PER_UNIT', perUnitAmount: 20000 }));
    expect(perUnit[0]).toEqual(expect.objectContaining({ payAmount: 60000, shareRate: null, memo: '대당 20,000원 × 3대' }));
    const mixed = calcJobShares(job({ extraAmount: 0, totalAmount: 100000, units: 2 }), policy({ calcType: 'MIXED', techShareRate: 40, perUnitAmount: 5000 }));
    expect(mixed[0]!.payAmount).toBe(50000);
  });
});

describe('BR-082·083 정산서 합계', () => {
  const items = [
    { itemType: 'JOB', role: 'MAIN', workOrderId: 1, salesAmount: 90000, payAmount: 49500 },
    { itemType: 'EXTRA', role: 'MAIN', workOrderId: 1, salesAmount: 30000, payAmount: 21000 },
    { itemType: 'JOB', role: 'MAIN', workOrderId: 2, salesAmount: 90000, payAmount: 49500 },
    { itemType: 'JOB', role: 'ACCOMPANY', workOrderId: 3, salesAmount: 90000, payAmount: 0 },
  ];

  it('BR-083 도급 기사는 과세 대상의 3.3% 원천징수(10원 미만 절사)', () => {
    expect(withholdingOf(120000, 'FREELANCER', 3.3)).toBe(3960);
    expect(withholdingOf(120005, 'FREELANCER', 3.3)).toBe(3960);
    expect(withholdingOf(12345, 'FREELANCER', 3.3)).toBe(400);
  });

  it('BR-083 예외: 근로·사업자 기사, 과세 대상 0 이하는 원천징수 없음', () => {
    expect(withholdingOf(120000, 'EMPLOYEE', 3.3)).toBe(0);
    expect(withholdingOf(120000, 'PARTNER', 3.3)).toBe(0);
    expect(withholdingOf(-5000, 'FREELANCER', 3.3)).toBe(0);
  });

  it('BR-082 현장 수금 현금은 실지급액에서 상계(원천세 계산에는 넣지 않음)', () => {
    const t = summarizeSettlement(items, { cashCollected: 120000, contractType: 'FREELANCER', withholdingRate: 3.3 });
    expect(t).toEqual({
      jobCount: 2,
      grossSales: 210000,
      basePay: 99000,
      extraPay: 21000,
      incentive: 0,
      deduction: 0,
      cashCollected: 120000,
      taxableAmount: 120000,
      withholdingTax: 3960,
      netPay: -3960,
    });
  });

  it('인센티브는 더하고 공제·음수 조정은 뺀 뒤 원천징수', () => {
    const t = summarizeSettlement(
      [
        ...items,
        { itemType: 'INCENTIVE', role: null, workOrderId: null, salesAmount: 0, payAmount: 10000 },
        { itemType: 'DEDUCTION', role: null, workOrderId: null, salesAmount: 0, payAmount: -5000 },
        { itemType: 'ADJUST', role: null, workOrderId: null, salesAmount: 0, payAmount: -2000 },
        { itemType: 'ADJUST', role: null, workOrderId: null, salesAmount: 0, payAmount: 3000 },
      ],
      { cashCollected: 0, contractType: 'FREELANCER', withholdingRate: 3.3 },
    );
    expect(t.incentive).toBe(13000);
    expect(t.deduction).toBe(7000);
    expect(t.taxableAmount).toBe(126000);
    expect(t.withholdingTax).toBe(4150);
    expect(t.netPay).toBe(121850);
  });

  it('관리자 조정 금액의 부호: 인센티브 +, 공제 −, 조정은 입력 그대로', () => {
    expect(manualItemAmount('INCENTIVE', 5000)).toBe(5000);
    expect(manualItemAmount('DEDUCTION', 5000)).toBe(-5000);
    expect(manualItemAmount('ADJUST', -3000)).toBe(-3000);
  });
});

describe('BR-084 확정 후 수정 불가, 다음 회차 조정', () => {
  it('BR-084 확정·지급된 정산서는 잠긴다', () => {
    expect(isSettlementLocked('CONFIRMED')).toBe(true);
    expect(isSettlementLocked('PAID')).toBe(true);
    expect(isSettlementLocked('CALCULATED')).toBe(false);
  });

  it('BR-084 조정은 계산된 회차에서 기사 미확인·이의 정산서(또는 새 정산서)에만', () => {
    expect(canAdjustSettlement('CALCULATED', 'CALCULATED')).toBe(true);
    expect(canAdjustSettlement('CALCULATED', 'DISPUTED')).toBe(true);
    expect(canAdjustSettlement('CALCULATED', null)).toBe(true);
  });

  it('BR-084 예외: 기사가 확인했거나 확정된 회차는 조정할 수 없다(다음 회차로)', () => {
    expect(canAdjustSettlement('CALCULATED', 'TECH_CONFIRMED')).toBe(false);
    expect(canAdjustSettlement('CONFIRMED', 'CONFIRMED')).toBe(false);
    expect(canAdjustSettlement('DRAFT', null)).toBe(false);
  });

  it('조정 입력 검증: 구분·금액·사유 필수, 인센티브·공제는 양수', () => {
    expect(checkAdjustment({ itemType: 'ADJUST', amount: -3000, memo: 'S2026-W46 과지급 회수' })).toEqual({});
    expect(checkAdjustment({ itemType: 'INCENTIVE', amount: -1, memo: 'x' }).amount).toBeTruthy();
    expect(Object.keys(checkAdjustment({ itemType: 'X', amount: 0, memo: ' ' }))).toEqual(['itemType', 'amount', 'memo']);
  });

  it('회차 확정: 이의가 남아 있으면 막는다', () => {
    expect(checkBatchConfirm('CALCULATED', ['TECH_CONFIRMED', 'CALCULATED'])).toBeNull();
    expect(checkBatchConfirm('CALCULATED', ['DISPUTED', 'TECH_CONFIRMED'])).toContain('1건');
    expect(checkBatchConfirm('DRAFT', [])).toContain('계산이 끝난');
  });
});

describe('F-TEC-STL-02 기사 확인·이의, F-ADM-STL-03 이의 처리', () => {
  it('계산됨 상태에서 확인 또는 이의(사유 필수)', () => {
    expect(checkTechResponse({ status: 'CALCULATED', action: 'CONFIRM', note: '' })).toEqual({});
    expect(checkTechResponse({ status: 'CALCULATED', action: 'DISPUTE', note: '' }).note).toContain('필수 입력값');
    expect(checkTechResponse({ status: 'CALCULATED', action: 'DISPUTE', note: '추가요금 누락' })).toEqual({});
  });

  it('예외: 이미 확인·이의한 정산서는 다시 답할 수 없다', () => {
    expect(checkTechResponse({ status: 'TECH_CONFIRMED', action: 'DISPUTE', note: 'x' }).form).toBeTruthy();
    expect(checkTechResponse({ status: 'DISPUTED', action: 'CONFIRM', note: '' }).form).toContain('이의');
  });

  it('이의 처리는 이의 상태에서 처리 내용 필수', () => {
    expect(checkDisputeResolve({ status: 'DISPUTED', note: '추가요금 조정 반영' })).toEqual({});
    expect(checkDisputeResolve({ status: 'DISPUTED', note: '' }).note).toBeTruthy();
    expect(checkDisputeResolve({ status: 'CALCULATED', note: 'x' }).form).toBeTruthy();
  });
});

describe('F-ADM-STL-04 지급 파일 대상', () => {
  it('실지급액 > 0 이고 계좌가 있는 정산서만 이체, 계좌 없음·0 이하는 따로', () => {
    const rows = [
      { techCode: 'A', techName: 'a', bankCode: '004', bankAccount: '123', accountHolder: 'a', netPay: 10000 },
      { techCode: 'B', techName: 'b', bankCode: null, bankAccount: null, accountHolder: null, netPay: 5000 },
      { techCode: 'C', techName: 'c', bankCode: '004', bankAccount: '456', accountHolder: 'c', netPay: -3960 },
    ];
    const r = splitTransferTargets(rows);
    expect(r.transfers.map((x) => x.techCode)).toEqual(['A']);
    expect(r.missingAccount.map((x) => x.techCode)).toEqual(['B']);
    expect(r.nonPositive.map((x) => x.techCode)).toEqual(['C']);
  });
});
