import { describe, expect, it } from 'vitest';
import {
  type QuoteCalcInput,
  type QuoteCatalog,
  calculateQuote,
  pickTimeSurcharge,
  resolveServiceArea,
} from './quote-calc';

const catalog: QuoteCatalog = {
  products: [
    {
      id: 1,
      productCode: 'AC-WALL-BASIC',
      name: '벽걸이 일반 세척',
      deviceType: 'WALL',
      cleanLevel: 'BASIC',
      baseDurationMin: 60,
      includedItems: '필터',
      excludedItems: '실외기',
    },
    {
      id: 2,
      productCode: 'AC-WALL-FULL',
      name: '벽걸이 완전분해 세척',
      deviceType: 'WALL',
      cleanLevel: 'FULL',
      baseDurationMin: 90,
      includedItems: null,
      excludedItems: null,
    },
    {
      id: 3,
      productCode: 'AC-STAND-FULL',
      name: '스탠드 완전분해 세척',
      deviceType: 'STAND',
      cleanLevel: 'FULL',
      baseDurationMin: 120,
      includedItems: null,
      excludedItems: null,
    },
    {
      id: 4,
      productCode: 'AC-SYS-FULL',
      name: '시스템 완전분해 세척',
      deviceType: 'SYSTEM',
      cleanLevel: 'FULL',
      baseDurationMin: 100,
      includedItems: null,
      excludedItems: null,
    },
  ],
  policies: [
    {
      id: 11,
      productId: 1,
      branchId: null,
      customerType: null,
      unitPrice: 70000,
      validFrom: '2027-01-01',
      validTo: null,
      priority: 0,
      multiUnitDiscountJson: [
        { min: 2, rate: 5 },
        { min: 3, rate: 10 },
      ],
    },
    {
      id: 12,
      productId: 2,
      branchId: null,
      customerType: null,
      unitPrice: 90000,
      validFrom: '2027-01-01',
      validTo: null,
      priority: 0,
      multiUnitDiscountJson: [
        { min: 2, rate: 5 },
        { min: 3, rate: 10 },
      ],
    },
    {
      id: 13,
      productId: 3,
      branchId: null,
      customerType: null,
      unitPrice: 130000,
      validFrom: '2027-01-01',
      validTo: null,
      priority: 0,
      multiUnitDiscountJson: null,
    },
    {
      id: 14,
      productId: 4,
      branchId: null,
      customerType: null,
      unitPrice: 150000,
      validFrom: '2027-01-01',
      validTo: null,
      priority: 0,
      multiUnitDiscountJson: null,
    },
  ],
  options: [
    { id: 21, productId: null, optionCode: 'OUTDOOR', name: '실외기 추가', price: 30000, durationMin: 30 },
    {
      id: 22,
      productId: 3,
      optionCode: 'STAND_COAT',
      name: '스탠드 항균 코팅',
      price: 20000,
      durationMin: 10,
    },
  ],
  surchargeRules: [
    {
      id: 31,
      ruleCode: 'NIGHT',
      name: '야간 방문 할증',
      applyType: 'AUTO_QUOTE',
      conditionJson: { weekday: true, after: '18:00' },
      amountType: 'FIXED',
      amount: 30000,
      perUnit: false,
      customerNotice: null,
    },
    {
      id: 32,
      ruleCode: 'HOLIDAY',
      name: '휴일 방문 할증',
      applyType: 'AUTO_QUOTE',
      conditionJson: { weekend: true, holiday: true },
      amountType: 'FIXED',
      amount: 30000,
      perUnit: false,
      customerNotice: null,
    },
    {
      id: 33,
      ruleCode: 'OUTER_AREA',
      name: '권역 외 출장비',
      applyType: 'AUTO_QUOTE',
      conditionJson: null,
      amountType: 'FIXED',
      amount: 0,
      perUnit: false,
      customerNotice: null,
    },
    {
      id: 34,
      ruleCode: 'HEAVY_DIRT',
      name: '오염 심함',
      applyType: 'ON_SITE',
      conditionJson: null,
      amountType: 'FIXED',
      amount: 20000,
      perUnit: true,
      customerNotice: '곰팡이가 심하면 대당 추가',
    },
  ],
};

const area = { legalDongCode: '1138010400', branchId: 7, isServiceable: true, travelFee: 0 };

const input = (over: Partial<QuoteCalcInput> = {}): QuoteCalcInput => ({
  area,
  lines: [{ deviceType: 'WALL', cleanLevel: 'FULL', quantity: 1 }],
  options: [],
  customerType: 'PERSONAL',
  priceDate: '2027-03-02',
  visit: null,
  holidays: [],
  catalog,
  settings: { siteSurveyMinUnits: 4 },
  ...over,
});

function ok(r: ReturnType<typeof calculateQuote>) {
  if (!r.ok) throw new Error(`견적 실패: ${r.reason}`);
  return r;
}

describe('BR-001 법정동이 서비스 가능 지역일 때만 견적·예약', () => {
  const areas = [
    { legalDongCode: '1138010400', branchId: 7, isServiceable: true, travelFee: 0 },
    { legalDongCode: '1138010500', branchId: 7, isServiceable: false, travelFee: 0 },
  ];
  it('BR-001 서비스 가능 법정동은 거점이 매핑된다', () => {
    expect(resolveServiceArea(areas, '1138010400')).toEqual({
      serviceable: true,
      branchId: 7,
      area: areas[0],
    });
  });
  it('BR-001 is_serviceable=false 이거나 등록되지 않은 법정동은 서비스 불가', () => {
    expect(resolveServiceArea(areas, '1138010500').serviceable).toBe(false);
    expect(resolveServiceArea(areas, '9999999999')).toEqual({
      serviceable: false,
      branchId: null,
      area: null,
    });
  });
  it('BR-001 비서비스 지역이면 견적을 산출하지 않는다', () => {
    const r = calculateQuote(input({ area: { ...area, isServiceable: false } }));
    expect(r).toEqual({ ok: false, reason: 'NOT_SERVICEABLE' });
    expect(calculateQuote(input({ area: null }))).toEqual({ ok: false, reason: 'NOT_SERVICEABLE' });
  });
});

describe('BR-010 견적 금액 = Σ(단가×대수) − 대수할인 + 자동할증', () => {
  it('BR-010 1대는 할인 없이 단가 그대로', () => {
    const r = ok(calculateQuote(input()));
    expect(r.subtotalAmount).toBe(90000);
    expect(r.discountAmount).toBe(0);
    expect(r.totalAmount).toBe(90000);
    expect(r.estimatedDurationMin).toBe(90);
    expect(r.branchId).toBe(7);
  });

  it('BR-010 대수 할인은 견적 전체 대수로 구간을 정하고 각 상품 정책의 할인율을 적용한다', () => {
    // 벽걸이 완전분해 2대 + 스탠드 1대 = 3대 → 벽걸이 정책 10%, 스탠드 정책은 할인 규칙 없음
    const r = ok(
      calculateQuote(
        input({
          lines: [
            { deviceType: 'WALL', cleanLevel: 'FULL', quantity: 2 },
            { deviceType: 'STAND', cleanLevel: 'FULL', quantity: 1 },
          ],
        }),
      ),
    );
    expect(r.subtotalAmount).toBe(90000 * 2 + 130000);
    expect(r.discountAmount).toBe(18000);
    expect(r.totalAmount).toBe(310000 - 18000);
    const disc = r.items.filter((i) => i.itemType === 'DISCOUNT');
    expect(disc).toHaveLength(1);
    expect(disc[0]).toMatchObject({ productId: 2, amount: -18000, quantity: 1, unitPrice: -18000 });
  });

  it('BR-010 할인·할증은 별도 행으로 저장되어 항목 합계로 총액을 재계산할 수 있다', () => {
    const r = ok(
      calculateQuote(
        input({
          area: { ...area, travelFee: 10000 },
          lines: [{ deviceType: 'WALL', cleanLevel: 'BASIC', quantity: 3 }],
          options: [{ optionId: 21, quantity: 1 }],
        }),
      ),
    );
    const sum = r.items.reduce((s, i) => s + i.amount, 0);
    expect(sum).toBe(r.totalAmount);
    expect(r.items.map((i) => i.itemType)).toEqual(['PRODUCT', 'OPTION', 'DISCOUNT', 'SURCHARGE']);
  });

  it('BR-010 같은 기기·작업범위가 여러 번 들어오면 한 줄로 합친다', () => {
    const r = ok(
      calculateQuote(
        input({
          lines: [
            { deviceType: 'WALL', cleanLevel: 'FULL', quantity: 1 },
            { deviceType: 'WALL', cleanLevel: 'FULL', quantity: 1 },
          ],
        }),
      ),
    );
    const products = r.items.filter((i) => i.itemType === 'PRODUCT');
    expect(products).toHaveLength(1);
    expect(products[0]!.quantity).toBe(2);
  });

  it('BR-010 옵션은 가격×수량을 상품 합계에 더하고 소요시간도 더한다', () => {
    const r = ok(calculateQuote(input({ options: [{ optionId: 21, quantity: 2 }] })));
    expect(r.subtotalAmount).toBe(90000 + 60000);
    expect(r.estimatedDurationMin).toBe(90 + 60);
  });

  it('BR-010 선택하지 않은 상품 전용 옵션은 거절한다', () => {
    const r = calculateQuote(input({ options: [{ optionId: 22, quantity: 1 }] }));
    expect(r).toMatchObject({ ok: false, reason: 'INVALID_OPTION' });
  });

  it('BR-010 상품이나 유효 가격이 없으면 견적 불가 사유를 돌려준다', () => {
    expect(
      calculateQuote(input({ lines: [{ deviceType: 'WINDOW', cleanLevel: 'BASIC', quantity: 1 }] })),
    ).toMatchObject({
      ok: false,
      reason: 'NO_PRODUCT',
    });
    expect(calculateQuote(input({ priceDate: '2026-12-31' }))).toMatchObject({
      ok: false,
      reason: 'NO_PRICE',
    });
  });

  it('BR-010 거점 전용 정책이 있으면 그 단가를 쓴다', () => {
    const c = {
      ...catalog,
      policies: [...catalog.policies, { ...catalog.policies[1]!, id: 99, branchId: 7, unitPrice: 85000 }],
    };
    expect(ok(calculateQuote(input({ catalog: c }))).totalAmount).toBe(85000);
  });

  it('BR-010 권역 외 출장비는 관할 지역의 출장비로 자동 할증한다', () => {
    const r = ok(calculateQuote(input({ area: { ...area, travelFee: 15000 } })));
    expect(r.surchargeAmount).toBe(15000);
    expect(r.items.find((i) => i.itemType === 'SURCHARGE')).toMatchObject({
      surchargeRuleId: 33,
      amount: 15000,
    });
  });

  it('BR-010 권역 외 규칙이 꺼져 있으면 출장비를 붙이지 않는다', () => {
    const c = {
      ...catalog,
      surchargeRules: catalog.surchargeRules.filter((s) => s.ruleCode !== 'OUTER_AREA'),
    };
    expect(
      ok(calculateQuote(input({ catalog: c, area: { ...area, travelFee: 15000 } }))).surchargeAmount,
    ).toBe(0);
  });

  it('BR-010 희망 일시가 없으면 야간·휴일 할증은 붙지 않는다', () => {
    expect(ok(calculateQuote(input())).surchargeAmount).toBe(0);
  });
});

describe('BR-011·BR-012·BR-013 야간·휴일 할증', () => {
  const rules = catalog.surchargeRules;
  it('BR-011 평일 18:00 이후 방문은 야간 할증', () => {
    expect(pickTimeSurcharge(rules, { date: '2027-03-02', time: '18:00' }, [])?.ruleCode).toBe('NIGHT');
    expect(pickTimeSurcharge(rules, { date: '2027-03-02', time: '17:59' }, [])).toBeNull();
  });
  it('BR-012 토·일·공휴일 방문은 휴일 할증', () => {
    expect(pickTimeSurcharge(rules, { date: '2027-03-06', time: '10:00' }, [])?.ruleCode).toBe('HOLIDAY'); // 토
    expect(pickTimeSurcharge(rules, { date: '2027-03-07', time: '10:00' }, [])?.ruleCode).toBe('HOLIDAY'); // 일
    expect(pickTimeSurcharge(rules, { date: '2027-03-01', time: '10:00' }, ['2027-03-01'])?.ruleCode).toBe(
      'HOLIDAY',
    ); // 삼일절(월)
  });
  it('BR-013 야간·휴일 동시 해당 시 높은 할증 1건만 적용', () => {
    const anyDayNight = rules.map((r) =>
      r.ruleCode === 'NIGHT' ? { ...r, conditionJson: { after: '18:00' }, amount: 40000 } : r,
    );
    const picked = pickTimeSurcharge(anyDayNight, { date: '2027-03-06', time: '19:00' }, []);
    expect(picked).toMatchObject({ ruleCode: 'NIGHT', amount: 40000 });
    const r = ok(
      calculateQuote(
        input({
          visit: { date: '2027-03-06', time: '19:00' },
          catalog: { ...catalog, surchargeRules: anyDayNight },
        }),
      ),
    );
    expect(r.items.filter((i) => i.itemType === 'SURCHARGE')).toHaveLength(1);
    expect(r.surchargeAmount).toBe(40000);
  });
  it('BR-013 금액이 같으면 휴일 할증 1건만 적용', () => {
    const anyDayNight = rules.map((r) =>
      r.ruleCode === 'NIGHT' ? { ...r, conditionJson: { after: '18:00' } } : r,
    );
    expect(pickTimeSurcharge(anyDayNight, { date: '2027-03-06', time: '19:00' }, [])?.ruleCode).toBe(
      'HOLIDAY',
    );
  });
  it('BR-011 평일 전용 야간 규칙은 공휴일 저녁에 적용하지 않고 휴일 할증만 붙는다', () => {
    expect(pickTimeSurcharge(rules, { date: '2027-03-01', time: '19:00' }, ['2027-03-01'])?.ruleCode).toBe(
      'HOLIDAY',
    );
  });
  it('BR-011 대당 적용 규칙은 대수만큼 곱한다', () => {
    const perUnit = rules.map((r) => (r.ruleCode === 'NIGHT' ? { ...r, perUnit: true, amount: 10000 } : r));
    const r = ok(
      calculateQuote(
        input({
          visit: { date: '2027-03-02', time: '19:00' },
          lines: [{ deviceType: 'WALL', cleanLevel: 'FULL', quantity: 2 }],
          catalog: { ...catalog, surchargeRules: perUnit },
        }),
      ),
    );
    expect(r.surchargeAmount).toBe(20000);
  });
  it('BR-011 정률 할증은 할인 후 상품 합계 기준으로 계산한다', () => {
    const rate = rules.map((r) =>
      r.ruleCode === 'NIGHT' ? { ...r, amountType: 'RATE' as const, amount: 10 } : r,
    );
    const r = ok(
      calculateQuote(
        input({
          visit: { date: '2027-03-02', time: '19:00' },
          catalog: { ...catalog, surchargeRules: rate },
        }),
      ),
    );
    expect(r.surchargeAmount).toBe(9000);
  });
});

describe('BR-014 견적 시점 단가 스냅샷', () => {
  it('BR-014 스냅샷에 항목명·단가·정책 ID·적용 규칙을 남긴다', () => {
    const r = ok(calculateQuote(input({ visit: { date: '2027-03-02', time: '19:00' } })));
    expect(r.snapshot.items[0]).toMatchObject({
      itemType: 'PRODUCT',
      name: '벽걸이 완전분해 세척',
      unitPrice: 90000,
      pricePolicyId: 12,
    });
    expect(r.snapshot.items.find((i) => i.itemType === 'SURCHARGE')).toMatchObject({
      name: '야간 방문 할증',
      amount: 30000,
    });
    expect(r.snapshot.priceDate).toBe('2027-03-02');
  });
  it('BR-014 견적 후 가격 정책이 바뀌어도 이미 계산된 결과·스냅샷은 그대로다', () => {
    const policies = catalog.policies.map((p) => ({
      ...p,
      multiUnitDiscountJson: p.multiUnitDiscountJson?.map((t) => ({ ...t })) ?? null,
    }));
    const c = { ...catalog, policies };
    const r = ok(calculateQuote(input({ catalog: c })));
    policies[1]!.unitPrice = 1;
    policies[1]!.multiUnitDiscountJson![0]!.rate = 50;
    expect(r.totalAmount).toBe(90000);
    expect(r.snapshot.items[0]!.unitPrice).toBe(90000);
    expect(r.snapshot.items[0]!.discountTiers).toEqual([
      { min: 2, rate: 5 },
      { min: 3, rate: 10 },
    ]);
  });
});

describe('F-CUS-QUO-04 출력·예외', () => {
  it('F-CUS-QUO-04 시스템·천장형 합계가 기준 대수 이상이면 현장 확인 견적 안내', () => {
    const r = ok(
      calculateQuote(input({ lines: [{ deviceType: 'SYSTEM', cleanLevel: 'FULL', quantity: 4 }] })),
    );
    expect(r.needsSiteSurvey).toBe(true);
    expect(
      ok(calculateQuote(input({ lines: [{ deviceType: 'SYSTEM', cleanLevel: 'FULL', quantity: 3 }] })))
        .needsSiteSurvey,
    ).toBe(false);
  });
  it('F-CUS-QUO-04 현장 추가요금 조건(ON_SITE)과 포함/불포함 항목을 함께 돌려준다', () => {
    const r = ok(
      calculateQuote(input({ lines: [{ deviceType: 'WALL', cleanLevel: 'BASIC', quantity: 1 }] })),
    );
    expect(r.onSiteRules).toEqual([
      {
        ruleCode: 'HEAVY_DIRT',
        name: '오염 심함',
        amountType: 'FIXED',
        amount: 20000,
        perUnit: true,
        customerNotice: '곰팡이가 심하면 대당 추가',
      },
    ]);
    expect(r.snapshot.products).toEqual([
      { productId: 1, name: '벽걸이 일반 세척', includedItems: '필터', excludedItems: '실외기' },
    ]);
  });
  it('F-CUS-QUO-04 대수가 1 미만이거나 기기가 없으면 거절한다', () => {
    expect(calculateQuote(input({ lines: [] }))).toMatchObject({ ok: false, reason: 'NO_LINES' });
    expect(
      calculateQuote(input({ lines: [{ deviceType: 'WALL', cleanLevel: 'FULL', quantity: 0 }] })),
    ).toMatchObject({ ok: false, reason: 'NO_LINES' });
  });
});

describe('견적 불가 문구', () => {
  it('F-CUS-QUO-04 필수 누락 문구는 공통 형식을 따른다', async () => {
    const { MSG } = await import('../messages');
    const { quoteFailureMessage } = await import('./quote-calc');
    expect(quoteFailureMessage({ ok: false, reason: 'NO_LINES' })).toBe(MSG.required('기기'));
  });
});
