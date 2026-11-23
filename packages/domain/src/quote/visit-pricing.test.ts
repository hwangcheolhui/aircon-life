import { describe, expect, it } from 'vitest';
import { type SurchargeRuleLike, applyVisitSurcharge, visitSurchargeName } from './quote-calc';

const rule = (id: number, ruleCode: string, conditionJson: Record<string, unknown>, amount = 30000): SurchargeRuleLike => ({
  id,
  ruleCode,
  name: ruleCode === 'NIGHT' ? '야간 방문 할증' : '휴일 방문 할증',
  applyType: 'AUTO_QUOTE',
  conditionJson,
  amountType: 'FIXED',
  amount,
  perUnit: false,
  customerNotice: null,
});
const rules = [rule(1, 'NIGHT', { weekday: true, after: '18:00' }), rule(2, 'HOLIDAY', { weekend: true, holiday: true })];
const snapshot = {
  totalUnits: 2,
  items: [
    { itemType: 'PRODUCT' as const, productId: 1, optionId: null, surchargeRuleId: null, quantity: 2, unitPrice: 90000, amount: 180000, name: '벽걸이' },
    { itemType: 'DISCOUNT' as const, productId: 1, optionId: null, surchargeRuleId: null, quantity: 1, unitPrice: -9000, amount: -9000, name: '대수 할인' },
  ],
};

describe('예약 방문 일시 할증 (F-CUS-RSV-01, BR-011·012·013·014)', () => {
  it('BR-014 견적 단가는 그대로, 평일 낮 방문은 할증 없음', () => {
    const r = applyVisitSurcharge({ snapshot, rules, visit: { date: '2027-03-10', time: '10:00' }, holidays: [] });
    expect(r).toMatchObject({ subtotalAmount: 180000, discountAmount: 9000, surchargeAmount: 0, totalAmount: 171000, timeRule: null });
  });
  it('BR-011 평일 18:00 이후 방문은 야간 할증 1건이 붙는다', () => {
    const r = applyVisitSurcharge({ snapshot, rules, visit: { date: '2027-03-10', time: '18:00' }, holidays: [] });
    expect(r.timeRule?.ruleCode).toBe('NIGHT');
    expect(r.totalAmount).toBe(201000);
  });
  it('BR-012 토요일·공휴일 방문은 휴일 할증', () => {
    expect(applyVisitSurcharge({ snapshot, rules, visit: { date: '2027-03-13', time: '10:00' }, holidays: [] }).timeRule?.ruleCode).toBe('HOLIDAY');
    expect(applyVisitSurcharge({ snapshot, rules, visit: { date: '2027-03-01', time: '10:00' }, holidays: ['2027-03-01'] }).timeRule?.ruleCode).toBe(
      'HOLIDAY',
    );
  });
  it('BR-013 휴일 저녁은 높은 할증 1건만 (같으면 휴일)', () => {
    const r = applyVisitSurcharge({ snapshot, rules: [rule(1, 'NIGHT', { after: '18:00' }), rules[1]!], visit: { date: '2027-03-13', time: '19:00' }, holidays: [] });
    expect(r.items.filter((i) => i.itemType === 'SURCHARGE')).toHaveLength(1);
    expect(r.timeRule?.ruleCode).toBe('HOLIDAY');
  });
  it('예외: 이미 들어 있던 야간·휴일 할증은 빼고 다시 판단한다', () => {
    const withNight = { ...snapshot, items: [...snapshot.items, { itemType: 'SURCHARGE' as const, productId: null, optionId: null, surchargeRuleId: 1, quantity: 1, unitPrice: 30000, amount: 30000, name: '야간', ruleCode: 'NIGHT' }] };
    expect(applyVisitSurcharge({ snapshot: withNight, rules, visit: { date: '2027-03-10', time: '10:00' }, holidays: [] }).surchargeAmount).toBe(0);
  });
  it('BR-011·012 시간대 배지 이름', () => {
    expect(visitSurchargeName(rules, { date: '2027-03-10', time: '19:00' }, [])).toBe('야간 방문 할증');
    expect(visitSurchargeName(rules, { date: '2027-03-10', time: '10:00' }, [])).toBeNull();
  });
});
