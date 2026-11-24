import { describe, expect, it } from 'vitest';
import {
  agreedExtraTotal,
  approvalStatusFor,
  canCustomerRespond,
  checkExtraChargeInput,
  extraChargeState,
  pendingExtraCount,
  ruleChargeAmount,
} from './extra-charge';

const base = { chargeType: 'RULE', approvalStatus: 'NOT_REQUIRED', customerAgreed: false, agreedAt: null, deletedAt: null } as const;
const at = new Date('2026-12-01T03:00:00Z');

describe('추가요금 상태 (F-TEC-WRK-05 · F-CUS-ORD-04)', () => {
  it('규칙·자재·기기 추가는 승인 없이 바로 고객 동의 대기', () => {
    expect(approvalStatusFor('RULE')).toBe('NOT_REQUIRED');
    expect(approvalStatusFor('MATERIAL')).toBe('NOT_REQUIRED');
    expect(approvalStatusFor('DEVICE_ADD')).toBe('NOT_REQUIRED');
    expect(extraChargeState(base)).toBe('WAIT_CUSTOMER');
  });

  it('BR-042 기타(ETC) 추가요금은 관리자 승인 전에는 고객 동의 요청을 하지 않는다', () => {
    expect(approvalStatusFor('ETC')).toBe('REQUESTED');
    const etc = { ...base, chargeType: 'ETC', approvalStatus: 'REQUESTED' };
    expect(extraChargeState(etc)).toBe('WAIT_APPROVAL');
    expect(canCustomerRespond(etc)).toBe(false);
    expect(extraChargeState({ ...etc, approvalStatus: 'APPROVED' })).toBe('WAIT_CUSTOMER');
    expect(canCustomerRespond({ ...etc, approvalStatus: 'APPROVED' })).toBe(true);
  });

  it('BR-042 예외: 관리자가 반려한 기타 추가요금은 청구되지 않는다', () => {
    const c = { ...base, chargeType: 'ETC', approvalStatus: 'REJECTED' };
    expect(extraChargeState(c)).toBe('REJECTED');
    expect(canCustomerRespond(c)).toBe(false);
    expect(agreedExtraTotal([{ ...c, amount: 30000 }])).toBe(0);
  });

  it('동의·거절·철회 상태를 구분한다', () => {
    expect(extraChargeState({ ...base, customerAgreed: true, agreedAt: at })).toBe('AGREED');
    expect(extraChargeState({ ...base, customerAgreed: false, agreedAt: at })).toBe('DECLINED');
    expect(extraChargeState({ ...base, deletedAt: at })).toBe('WITHDRAWN');
    expect(canCustomerRespond({ ...base, customerAgreed: true, agreedAt: at })).toBe(false);
  });

  it('BR-040 고객이 동의한 추가요금만 금액에 반영한다', () => {
    const list = [
      { ...base, amount: 20000, customerAgreed: true, agreedAt: at },
      { ...base, amount: 10000 }, // 대기
      { ...base, amount: 5000, agreedAt: at }, // 거절
      { ...base, amount: 7000, customerAgreed: true, agreedAt: at, deletedAt: at }, // 철회
    ];
    expect(agreedExtraTotal(list)).toBe(20000);
  });

  it('BR-040 동의 대기(승인 대기 포함)가 남아 있으면 완료할 수 없도록 건수를 센다', () => {
    expect(
      pendingExtraCount([
        base,
        { ...base, chargeType: 'ETC', approvalStatus: 'REQUESTED' },
        { ...base, customerAgreed: true, agreedAt: at },
        { ...base, deletedAt: at },
      ]),
    ).toBe(2);
  });
});

describe('추가요금 입력 검증 (F-TEC-WRK-05)', () => {
  const ok = { chargeType: 'RULE', title: '오염 심함 추가 세척', amount: 20000, reason: '곰팡이 오염 심함', hasEvidence: false, hasRule: true, quantity: 1 };

  it('사전공개 규칙은 규칙을 골라야 한다', () => {
    expect(checkExtraChargeInput(ok)).toEqual({});
    expect(checkExtraChargeInput({ ...ok, hasRule: false }).surchargeRuleId).toBeTruthy();
  });

  it('BR-042 기타(ETC)는 사유와 증빙 사진이 필수다', () => {
    const etc = { ...ok, chargeType: 'ETC', hasRule: false };
    expect(checkExtraChargeInput({ ...etc, hasEvidence: true })).toEqual({});
    expect(checkExtraChargeInput(etc).evidence).toBeTruthy();
    expect(checkExtraChargeInput({ ...etc, hasEvidence: true, reason: ' ' }).reason).toBeTruthy();
  });

  it('예외: 금액은 1원 이상, 자재는 증빙 사진 필수', () => {
    expect(checkExtraChargeInput({ ...ok, chargeType: 'MATERIAL', hasRule: false, amount: 0, hasEvidence: true }).amount).toBeTruthy();
    expect(checkExtraChargeInput({ ...ok, chargeType: 'MATERIAL', hasRule: false }).evidence).toBeTruthy();
  });

  it('현장 기기 추가는 1대 이상', () => {
    const d = { ...ok, chargeType: 'DEVICE_ADD', hasRule: false };
    expect(checkExtraChargeInput(d)).toEqual({});
    expect(checkExtraChargeInput({ ...d, quantity: 0 }).quantity).toBeTruthy();
  });
});

describe('사전공개 규칙 금액', () => {
  it('정액·대당·정률', () => {
    expect(ruleChargeAmount({ amountType: 'FIXED', amount: 20000, perUnit: false }, 3, 100000)).toBe(20000);
    expect(ruleChargeAmount({ amountType: 'FIXED', amount: 10000, perUnit: true }, 3, 100000)).toBe(30000);
    expect(ruleChargeAmount({ amountType: 'RATE', amount: 15, perUnit: false }, 3, 99999)).toBe(14999);
  });
});
