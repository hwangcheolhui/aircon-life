import { describe, expect, it } from 'vitest';
import {
  areaOpenRequestInput,
  branchInput,
  fieldErrors,
  pricePolicyInput,
  routeEditInput,
  selfAssignDecisionInput,
  surchargeRuleInput,
  zoneInput,
} from './index';

describe('입력 스키마', () => {
  it('필수 누락 시 "○○은(는) 필수 입력값입니다." 문구를 낸다', () => {
    const r = branchInput.safeParse({ branchCode: '', name: '', status: 'ACTIVE' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const e = fieldErrors(r.error);
      expect(e.branchCode).toBe('거점 코드는 필수 입력값입니다.');
      expect(e.name).toBe('거점명은 필수 입력값입니다.');
    }
  });

  it('폼 문자열을 숫자·null로 바꾼다', () => {
    const r = branchInput.parse({
      branchCode: 'EP01',
      name: '은평거점',
      status: 'ACTIVE',
      radiusKm: '5.0',
      phone: '',
    });
    expect(r.phone).toBeNull();
    expect(r.radiusKm).toBe('5.0');
  });

  it('대수 할인 JSON을 검증한다', () => {
    const base = { productId: '1', unitPrice: '90000', validFrom: '2027-01-01', priority: '0' };
    expect(
      pricePolicyInput.safeParse({ ...base, multiUnitDiscountJson: '[{"min":2,"rate":5}]' }).success,
    ).toBe(true);
    expect(
      pricePolicyInput.safeParse({ ...base, multiUnitDiscountJson: '[{"min":1,"rate":5}]' }).success,
    ).toBe(false);
    expect(pricePolicyInput.safeParse({ ...base, multiUnitDiscountJson: '{bad' }).success).toBe(false);
    expect(pricePolicyInput.safeParse({ ...base, validTo: '2026-12-31' }).success).toBe(false);
  });

  it('정률 할증은 100%를 넘을 수 없다', () => {
    const r = surchargeRuleInput.safeParse({
      ruleCode: 'NIGHT',
      name: '야간',
      applyType: 'AUTO_QUOTE',
      amountType: 'RATE',
      amount: '150',
    });
    expect(r.success).toBe(false);
  });
});

describe('견적 입력 (F-CUS-QUO-04 · F-ADM-PRD-05)', () => {
  it('F-CUS-QUO-04 기기가 없으면 필수 입력 문구', async () => {
    const { customerQuoteInput } = await import('./index');
    const r = customerQuoteInput.safeParse({ legalDongCode: '1138010400', lines: [] });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('기기는 필수 입력값입니다.');
  });
  it('F-ADM-PRD-05 희망 방문 일시는 날짜·시각을 함께 입력해야 한다', async () => {
    const { quoteSimulationInput } = await import('./index');
    const base = {
      legalDongCode: '1138010400',
      lines: [{ deviceType: 'WALL', cleanLevel: 'FULL', quantity: '2' }],
      customerType: 'PERSONAL',
    };
    expect(quoteSimulationInput.safeParse({ ...base, visitDate: '2027-03-02', visitTime: '' }).success).toBe(
      false,
    );
    const ok = quoteSimulationInput.safeParse({ ...base, visitDate: '2027-03-02', visitTime: '19:00' });
    expect(ok.success && ok.data.lines[0]?.quantity).toBe(2);
  });
});

describe('단계 2 입력 스키마', async () => {
  const { reservationInput, phoneInput, changeRequestInput } = await import('./index');
  it('휴대폰 번호는 숫자만 남기고 형식을 검사한다', () => {
    expect(phoneInput().parse('010-1234-5678')).toBe('01012345678');
    expect(phoneInput().safeParse('02-123-4567').success).toBe(false);
  });
  it('예약은 취소 규정 동의가 필수다 (F-CUS-RSV-03)', () => {
    const base = {
      quoteNo: 'Q2703020001',
      slotDate: '2027-03-10',
      slotHour: '10',
      address: { zipcode: '03300', roadAddress: '예시로 1', legalDongCode: '1138010400' },
      detailAddress: '101동',
      housingType: 'APT',
      payMethod: 'ONSITE',
    };
    expect(reservationInput.safeParse({ ...base, cancelPolicyAgreed: true }).success).toBe(true);
    expect(reservationInput.safeParse({ ...base, cancelPolicyAgreed: false }).success).toBe(false);
  });
  it('일정 변경 요청은 새 일정이 필수, 취소 요청은 아니다 (F-CUS-ORD-03)', () => {
    expect(changeRequestInput.safeParse({ orderNo: 'x', requestType: 'RESCHEDULE' }).success).toBe(false);
    expect(changeRequestInput.safeParse({ orderNo: 'x', requestType: 'CANCEL' }).success).toBe(true);
  });
});

describe('오픈 알림 신청 입력 (F-CUS-QUO-08)', () => {
  const base = {
    legalDongCode: '4113511000',
    sido: '경기',
    sigungu: '성남시 분당구',
    eupmyeondong: '백현동',
  };
  it('BR-003 휴대폰 번호와 동의가 있으면 통과', () => {
    const r = areaOpenRequestInput.safeParse({ ...base, phone: ' 010-1234-5678 ', privacyAgreed: true });
    expect(r.success && r.data.phone).toBe('010-1234-5678');
  });
  it('BR-003 동의하지 않으면 필수 문구', () => {
    const r = areaOpenRequestInput.safeParse({ ...base, phone: '010-1234-5678', privacyAgreed: false });
    expect(r.success).toBe(false);
    expect(fieldErrors(r.error!).privacyAgreed).toBe('개인정보 수집·이용 동의는 필수 입력값입니다.');
  });
  it('BR-003 번호가 비었거나 휴대폰이 아니면 거절', () => {
    const empty = areaOpenRequestInput.safeParse({ ...base, phone: '', privacyAgreed: true });
    expect(fieldErrors(empty.error!).phone).toBe('휴대폰 번호는 필수 입력값입니다.');
    expect(
      areaOpenRequestInput.safeParse({ ...base, phone: '02-123-4567', privacyAgreed: true }).success,
    ).toBe(false);
  });
});

describe('단계 4-2 입력 스키마', () => {
  it('F-ADM-DSP-10 자가 배정 거절은 사유가 필수다', () => {
    const r = selfAssignDecisionInput.safeParse({ assignmentId: 1, decision: 'REJECT', reason: '' });
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrors(r.error).reason).toBe('거절 사유는 필수 입력값입니다.');
    expect(
      selfAssignDecisionInput.safeParse({ assignmentId: 1, decision: 'APPROVE', reason: '' }).success,
    ).toBe(true);
  });

  it('F-ADM-DSP-08 관할 구역은 구역명이 필수이고 적용기간 순서를 검사한다', () => {
    const r = zoneInput.safeParse({
      technicianId: 1,
      zoneName: '',
      zoneType: 'PRIMARY',
      defineMethod: 'DONG_SET',
      validFrom: '2026-03-10',
      validTo: '2026-03-01',
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrors(r.error).zoneName).toBe('구역명은 필수 입력값입니다.');
    const ok = zoneInput.parse({
      technicianId: '1',
      zoneName: '불광 일대',
      zoneType: 'PRIMARY',
      defineMethod: 'DRAWN',
      points: [
        [126.9, 37.6],
        [126.92, 37.6],
        [126.91, 37.62],
      ],
    });
    expect(ok.points).toHaveLength(3);
    expect(ok.color).toBe('1');
  });

  it('F-TEC-RTE-01 코스 편집은 방문지 유형을 제한한다', () => {
    expect(
      routeEditInput.safeParse({ date: '2026-03-10', stops: [{ key: 'A1', type: 'JOB', locked: false }] })
        .success,
    ).toBe(true);
    expect(
      routeEditInput.safeParse({ date: '2026-03-10', stops: [{ key: 'A1', type: 'LUNCH', locked: false }] })
        .success,
    ).toBe(false);
  });
});

describe('단계 5-1 입력 스키마', () => {
  it('BR-043 안전 체크 항목은 정해진 코드만', async () => {
    const { workSafetyInput } = await import('./index');
    expect(workSafetyInput.safeParse({ orderNo: 'A1', checked: ['ELECTRIC'], highPlaceWork: 'on' }).success).toBe(true);
    expect(workSafetyInput.safeParse({ orderNo: 'A1', checked: ['FOO'] }).success).toBe(false);
  });

  it('F-TEC-WRK-04 기기별 결과는 완료·일부·작업 불가 중 하나, 차기 권장은 1~36개월', async () => {
    const { workResultInput } = await import('./index');
    const unit = { orderItemId: '3', unitNo: '1', result: 'DONE', conditionNote: '', recommendNext: '12' };
    const r = workResultInput.safeParse({ orderNo: 'A1', dirtLevel: 'HIGH', units: [unit] });
    expect(r.success && r.data.units[0]).toMatchObject({ orderItemId: 3, unitNo: 1, recommendNext: 12, conditionNote: null });
    expect(workResultInput.safeParse({ orderNo: 'A1', units: [{ ...unit, result: '' }] }).success).toBe(false);
    expect(workResultInput.safeParse({ orderNo: 'A1', units: [{ ...unit, recommendNext: '48' }] }).success).toBe(false);
  });

  it('F-TEC-WRK-07 처리 내용은 필수', async () => {
    const { workCompleteInput } = await import('./index');
    const r = workCompleteInput.safeParse({ orderNo: 'A1', workNote: ' ' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message).toBe('처리 내용은 필수 입력값입니다.');
  });

  it('F-TEC-WRK-09 활동 유형은 통화·문자·방문 시도·메모', async () => {
    const { activityInput } = await import('./index');
    expect(activityInput.safeParse({ orderNo: 'A1', activityType: 'VISIT_TRY', content: '초인종 응답 없음' }).success).toBe(true);
    expect(activityInput.safeParse({ orderNo: 'A1', activityType: 'STATUS', content: 'x' }).success).toBe(false);
  });
});
