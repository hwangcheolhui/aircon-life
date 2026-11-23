import { describe, expect, it } from 'vitest';
import { areaOpenRequestInput, branchInput, fieldErrors, pricePolicyInput, surchargeRuleInput } from './index';

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
    const r = branchInput.parse({ branchCode: 'EP01', name: '은평거점', status: 'ACTIVE', radiusKm: '5.0', phone: '' });
    expect(r.phone).toBeNull();
    expect(r.radiusKm).toBe('5.0');
  });

  it('대수 할인 JSON을 검증한다', () => {
    const base = { productId: '1', unitPrice: '90000', validFrom: '2027-01-01', priority: '0' };
    expect(pricePolicyInput.safeParse({ ...base, multiUnitDiscountJson: '[{"min":2,"rate":5}]' }).success).toBe(true);
    expect(pricePolicyInput.safeParse({ ...base, multiUnitDiscountJson: '[{"min":1,"rate":5}]' }).success).toBe(false);
    expect(pricePolicyInput.safeParse({ ...base, multiUnitDiscountJson: '{bad' }).success).toBe(false);
    expect(pricePolicyInput.safeParse({ ...base, validTo: '2026-12-31' }).success).toBe(false);
  });

  it('정률 할증은 100%를 넘을 수 없다', () => {
    const r = surchargeRuleInput.safeParse({ ruleCode: 'NIGHT', name: '야간', applyType: 'AUTO_QUOTE', amountType: 'RATE', amount: '150' });
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

describe('오픈 알림 신청 입력 (F-CUS-QUO-08)', () => {
  const base = { legalDongCode: '4113511000', sido: '경기', sigungu: '성남시 분당구', eupmyeondong: '백현동' };
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
    expect(areaOpenRequestInput.safeParse({ ...base, phone: '02-123-4567', privacyAgreed: true }).success).toBe(false);
  });
});
