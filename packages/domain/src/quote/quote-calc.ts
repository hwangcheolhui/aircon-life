/**
 * 공용 견적 계산 모듈 (F-CUS-QUO-04 자동 표준 견적 산출).
 * 고객 견적(C-QUO-040)·관리자 견적 시뮬레이터(A-PRD-050, F-ADM-PRD-05)·상담 콘솔 출장접수(단계 3, F-ADM-CSL-05)가
 * 모두 이 함수 하나만 쓴다(BR-010~015, CLAUDE.md §5). DB를 모르는 순수 함수이며, 필요한 기준 데이터는 호출하는 쪽이 넘긴다.
 *
 * 계산 순서 (02 §1.2 F-CUS-QUO-04 처리 ①~⑥)
 *  ① service_area 로 서비스 가능 여부·거점 판단 (BR-001)
 *  ② (기기 형태, 작업 범위) → service_product 매칭
 *  ③ 거점·기간·고객유형에 맞는 price_policy 선택 (BR-010, selectPricePolicy)
 *  ④ 대수 할인: 견적 전체 대수로 구간을 정하고, 상품마다 그 상품 정책의 할인율을 적용 (상품 금액에만, 옵션 제외)
 *  ⑤ 자동 할증(AUTO_QUOTE): 권역 외 출장비 + 희망 일시가 있으면 야간·휴일(BR-011·012, 동시 해당 시 높은 1건 BR-013)
 *  ⑥ 예상 소요시간 = Σ(표준 소요시간 × 대수) + Σ(옵션 소요시간 × 수량)
 * 금액은 원 단위 정수, 할인·할증은 별도 행(음수/양수)으로 만들어 항목 합계 = 총액이 되게 한다.
 */
import { MSG } from '../messages';
import {
  type CustomerType,
  type MultiUnitDiscountTier,
  type PricePolicyLike,
  selectPricePolicy,
} from '../pricing/price-policy';

/* ---------- 입력 타입 ---------- */

export interface ServiceAreaLike {
  legalDongCode: string | null;
  branchId: number;
  isServiceable: boolean;
  /** 원거리 출장비(권역 외곽). 0이면 권역 외 할증 없음 */
  travelFee: number;
}

export interface QuoteProductLike {
  id: number;
  productCode: string;
  name: string;
  deviceType: string;
  cleanLevel: string;
  baseDurationMin: number;
  includedItems: string | null;
  excludedItems: string | null;
}

export interface QuotePolicyLike extends PricePolicyLike {
  multiUnitDiscountJson: MultiUnitDiscountTier[] | null;
}

export interface QuoteOptionLike {
  id: number;
  /** NULL = 모든 상품 공통 옵션 */
  productId: number | null;
  optionCode: string;
  name: string;
  price: number;
  durationMin: number;
}

export type SurchargeApplyType = 'AUTO_QUOTE' | 'ON_SITE';
export type AmountType = 'FIXED' | 'RATE';

export interface SurchargeRuleLike {
  id: number;
  ruleCode: string;
  name: string;
  applyType: string;
  conditionJson: Record<string, unknown> | null;
  amountType: AmountType;
  amount: number;
  perUnit: boolean;
  customerNotice: string | null;
}

/** 활성(is_active, 미삭제) 데이터만 넘긴다 */
export interface QuoteCatalog {
  products: readonly QuoteProductLike[];
  policies: readonly QuotePolicyLike[];
  options: readonly QuoteOptionLike[];
  surchargeRules: readonly SurchargeRuleLike[];
}

export interface QuoteLineInput {
  deviceType: string;
  cleanLevel: string;
  quantity: number;
}

/** 방문 희망 일시(한국 시간 기준 날짜·시각 문자열) */
export interface VisitAt {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
}

export interface QuoteCalcInput {
  /** 견적 주소의 법정동으로 찾은 관할 지역 (없으면 null = 서비스 불가) */
  area: ServiceAreaLike | null;
  lines: readonly QuoteLineInput[];
  options: readonly { optionId: number; quantity: number }[];
  customerType: CustomerType;
  /** 단가 적용 기준일 (희망 방문일, 없으면 견적일) */
  priceDate: string;
  visit: VisitAt | null;
  /** 공휴일(holiday.holiday_date) 목록 */
  holidays: readonly string[];
  catalog: QuoteCatalog;
  settings: {
    /** 시스템·천장형 합계가 이 대수 이상이면 "현장 확인 견적" 안내 (system_setting QUOTE_SITE_SURVEY_MIN_UNITS) */
    siteSurveyMinUnits: number;
  };
}

/* ---------- 출력 타입 ---------- */

export type QuoteItemType = 'PRODUCT' | 'OPTION' | 'SURCHARGE' | 'DISCOUNT';

/** quote_item 1행 (01 §2.4.2) */
export interface QuoteItemDraft {
  itemType: QuoteItemType;
  productId: number | null;
  optionId: number | null;
  surchargeRuleId: number | null;
  quantity: number;
  unitPrice: number;
  amount: number;
}

/** BR-014 스냅샷 항목: quote_item + 그 시점의 표시명·정책 */
export interface QuoteSnapshotItem extends QuoteItemDraft {
  name: string;
  pricePolicyId?: number;
  discountTiers?: MultiUnitDiscountTier[];
  discountRate?: number;
  ruleCode?: string;
  amountType?: AmountType;
  perUnit?: boolean;
}

export interface OnSiteRuleInfo {
  ruleCode: string;
  name: string;
  amountType: AmountType;
  amount: number;
  perUnit: boolean;
  customerNotice: string | null;
}

/** quote.price_snapshot_json (BR-014) — 결과 화면은 이 값으로 그린다 */
export interface QuoteSnapshot {
  version: 1;
  priceDate: string;
  visit: VisitAt | null;
  customerType: CustomerType;
  totalUnits: number;
  items: QuoteSnapshotItem[];
  products: { productId: number; name: string; includedItems: string | null; excludedItems: string | null }[];
  onSiteRules: OnSiteRuleInfo[];
  needsSiteSurvey: boolean;
}

export type QuoteCalcFailure =
  | { ok: false; reason: 'NOT_SERVICEABLE' }
  | { ok: false; reason: 'NO_LINES' }
  | { ok: false; reason: 'NO_PRODUCT'; deviceType: string; cleanLevel: string }
  | { ok: false; reason: 'NO_PRICE'; productId: number }
  | { ok: false; reason: 'INVALID_OPTION'; optionId: number };

export interface QuoteCalcSuccess {
  ok: true;
  branchId: number;
  items: QuoteItemDraft[];
  subtotalAmount: number;
  discountAmount: number;
  surchargeAmount: number;
  totalAmount: number;
  estimatedDurationMin: number;
  needsSiteSurvey: boolean;
  onSiteRules: OnSiteRuleInfo[];
  snapshot: QuoteSnapshot;
}

export type QuoteCalcResult = QuoteCalcSuccess | QuoteCalcFailure;

/** 현장 확인 견적 판단 대상 기기 형태 (02 F-CUS-QUO-04 예외: "시스템·천장형 4대 이상") */
export const SITE_SURVEY_DEVICE_TYPES: readonly string[] = ['SYSTEM', 'CEILING_1WAY', 'CEILING_4WAY'];

/* ---------- BR-001 서비스 지역 ---------- */

/** BR-001 법정동 → 관할 지역·거점. is_serviceable=true 인 경우에만 서비스 가능 */
export function resolveServiceArea<A extends ServiceAreaLike>(
  areas: readonly A[],
  legalDongCode: string,
): { serviceable: boolean; branchId: number | null; area: A | null } {
  const area = areas.find((a) => a.legalDongCode === legalDongCode) ?? null;
  if (!area) return { serviceable: false, branchId: null, area: null };
  return { serviceable: area.isServiceable, branchId: area.isServiceable ? area.branchId : null, area };
}

/* ---------- BR-011·012·013 야간·휴일 ---------- */

/** 0=일 … 6=토 (날짜 문자열만으로 계산해 서버 시간대에 영향받지 않게 한다) */
function dayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

function isWeekend(date: string) {
  const w = dayOfWeek(date);
  return w === 0 || w === 6;
}

/**
 * 조건(surcharge_rule.condition_json)에 맞는지.
 * - NIGHT  {"after":"18:00","weekday":true}: 방문 시각 ≥ after. weekday=true 면 평일(월~금, 공휴일 제외)에만 (BR-011)
 * - HOLIDAY {"weekend":true,"holiday":true}: 토·일(weekend) 또는 holiday 테이블의 날(holiday) (BR-012)
 */
export function matchesTimeRule(
  rule: SurchargeRuleLike,
  visit: VisitAt,
  holidays: readonly string[],
): boolean {
  const c = rule.conditionJson ?? {};
  const isHoliday = holidays.includes(visit.date);
  if (rule.ruleCode === 'NIGHT') {
    const after = typeof c.after === 'string' ? c.after : null;
    if (!after) return false;
    if (c.weekday === true && (isWeekend(visit.date) || isHoliday)) return false;
    return visit.time.slice(0, 5) >= after.slice(0, 5);
  }
  if (rule.ruleCode === 'HOLIDAY') {
    return (c.weekend === true && isWeekend(visit.date)) || (c.holiday === true && isHoliday);
  }
  return false;
}

function surchargeValue(
  rule: SurchargeRuleLike,
  units: number,
  base: number,
): { quantity: number; unitPrice: number; amount: number } {
  if (rule.amountType === 'RATE') {
    const amount = Math.floor((base * rule.amount) / 100);
    return { quantity: 1, unitPrice: amount, amount };
  }
  const quantity = rule.perUnit ? units : 1;
  return { quantity, unitPrice: rule.amount, amount: rule.amount * quantity };
}

/**
 * BR-011 야간·BR-012 휴일 중 해당하는 할증을 고르고, 둘 다 해당하면 금액이 높은 1건만(BR-013, 같으면 휴일).
 * units·base 는 대당·정률 규칙의 금액 비교용.
 */
export function pickTimeSurcharge<R extends SurchargeRuleLike>(
  rules: readonly R[],
  visit: VisitAt,
  holidays: readonly string[],
  units = 1,
  base = 0,
): R | null {
  const matched = rules.filter(
    (r) =>
      r.applyType === 'AUTO_QUOTE' &&
      (r.ruleCode === 'NIGHT' || r.ruleCode === 'HOLIDAY') &&
      matchesTimeRule(r, visit, holidays),
  );
  if (matched.length === 0) return null;
  return [...matched].sort((a, b) => {
    const diff = surchargeValue(b, units, base).amount - surchargeValue(a, units, base).amount;
    if (diff !== 0) return diff;
    return a.ruleCode === 'HOLIDAY' ? -1 : b.ruleCode === 'HOLIDAY' ? 1 : 0;
  })[0]!;
}

/* ---------- 견적 계산 ---------- */

function discountRateFor(tiers: readonly MultiUnitDiscountTier[] | null, totalUnits: number): number {
  let rate = 0;
  for (const t of tiers ?? []) if (totalUnits >= t.min && t.rate > rate) rate = t.rate;
  return rate;
}

export function calculateQuote(input: QuoteCalcInput): QuoteCalcResult {
  const { area, catalog } = input;
  // ① BR-001
  if (!area || !area.isServiceable) return { ok: false, reason: 'NOT_SERVICEABLE' };

  // 같은 (기기, 작업범위)는 한 줄로 합친다
  const merged = new Map<string, QuoteLineInput>();
  for (const l of input.lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1) continue;
    const key = `${l.deviceType}|${l.cleanLevel}`;
    const prev = merged.get(key);
    merged.set(key, { ...l, quantity: (prev?.quantity ?? 0) + l.quantity });
  }
  const lines = [...merged.values()];
  if (lines.length === 0) return { ok: false, reason: 'NO_LINES' };
  const totalUnits = lines.reduce((s, l) => s + l.quantity, 0);

  // ②③ 상품·단가
  const productLines: { product: QuoteProductLike; policy: QuotePolicyLike; quantity: number }[] = [];
  for (const l of lines) {
    const product = [...catalog.products]
      .filter((p) => p.deviceType === l.deviceType && p.cleanLevel === l.cleanLevel)
      .sort((a, b) =>
        a.productCode < b.productCode ? -1 : a.productCode > b.productCode ? 1 : a.id - b.id,
      )[0];
    if (!product)
      return { ok: false, reason: 'NO_PRODUCT', deviceType: l.deviceType, cleanLevel: l.cleanLevel };
    const policy = selectPricePolicy(catalog.policies, {
      productId: product.id,
      branchId: area.branchId,
      customerType: input.customerType,
      date: input.priceDate,
    });
    if (!policy) return { ok: false, reason: 'NO_PRICE', productId: product.id };
    productLines.push({ product, policy, quantity: l.quantity });
  }

  const items: QuoteSnapshotItem[] = [];
  let duration = 0;
  for (const { product, policy, quantity } of productLines) {
    items.push({
      itemType: 'PRODUCT',
      productId: product.id,
      optionId: null,
      surchargeRuleId: null,
      quantity,
      unitPrice: policy.unitPrice,
      amount: policy.unitPrice * quantity,
      name: product.name,
      pricePolicyId: policy.id,
      discountTiers: (policy.multiUnitDiscountJson ?? []).map((t) => ({ min: t.min, rate: t.rate })),
    });
    duration += product.baseDurationMin * quantity;
  }

  // 옵션: 공통 옵션이거나, 견적에 들어간 상품 전용 옵션만
  const selectedProductIds = new Set(productLines.map((p) => p.product.id));
  for (const o of input.options) {
    if (!Number.isInteger(o.quantity) || o.quantity < 1) continue;
    const opt = catalog.options.find((x) => x.id === o.optionId);
    if (!opt || (opt.productId !== null && !selectedProductIds.has(opt.productId))) {
      return { ok: false, reason: 'INVALID_OPTION', optionId: o.optionId };
    }
    items.push({
      itemType: 'OPTION',
      productId: opt.productId,
      optionId: opt.id,
      surchargeRuleId: null,
      quantity: o.quantity,
      unitPrice: opt.price,
      amount: opt.price * o.quantity,
      name: opt.name,
    });
    duration += opt.durationMin * o.quantity;
  }
  const subtotalAmount = items.reduce((s, i) => s + i.amount, 0);

  // ④ 대수 할인
  let discountAmount = 0;
  for (const { product, policy, quantity } of productLines) {
    const rate = discountRateFor(policy.multiUnitDiscountJson, totalUnits);
    if (rate <= 0) continue;
    const d = Math.floor((policy.unitPrice * quantity * rate) / 100);
    if (d <= 0) continue;
    discountAmount += d;
    items.push({
      itemType: 'DISCOUNT',
      productId: product.id,
      optionId: null,
      surchargeRuleId: null,
      quantity: 1,
      unitPrice: -d,
      amount: -d,
      name: `${product.name} 대수 할인 ${rate}%`,
      discountRate: rate,
    });
  }

  // ⑤ 자동 할증
  const auto = catalog.surchargeRules.filter((r) => r.applyType === 'AUTO_QUOTE');
  const base = subtotalAmount - discountAmount;
  let surchargeAmount = 0;
  const outer = auto.find((r) => r.ruleCode === 'OUTER_AREA');
  if (outer && area.travelFee > 0) {
    // 권역 외 출장비는 관할 지역(service_area.travel_fee)마다 다르므로 그 금액을 쓰고, 규칙은 사용 여부·표시명을 정한다
    surchargeAmount += area.travelFee;
    items.push({
      itemType: 'SURCHARGE',
      productId: null,
      optionId: null,
      surchargeRuleId: outer.id,
      quantity: 1,
      unitPrice: area.travelFee,
      amount: area.travelFee,
      name: outer.name,
      ruleCode: outer.ruleCode,
      amountType: 'FIXED',
      perUnit: false,
    });
  }
  if (input.visit) {
    const time = pickTimeSurcharge(auto, input.visit, input.holidays, totalUnits, base);
    if (time) {
      const v = surchargeValue(time, totalUnits, base);
      surchargeAmount += v.amount;
      items.push({
        itemType: 'SURCHARGE',
        productId: null,
        optionId: null,
        surchargeRuleId: time.id,
        ...v,
        name: time.name,
        ruleCode: time.ruleCode,
        amountType: time.amountType,
        perUnit: time.perUnit,
      });
    }
  }

  const totalAmount = Math.max(0, subtotalAmount - discountAmount + surchargeAmount);
  const siteUnits = lines
    .filter((l) => SITE_SURVEY_DEVICE_TYPES.includes(l.deviceType))
    .reduce((s, l) => s + l.quantity, 0);
  const needsSiteSurvey = siteUnits >= input.settings.siteSurveyMinUnits;
  const onSiteRules: OnSiteRuleInfo[] = catalog.surchargeRules
    .filter((r) => r.applyType === 'ON_SITE')
    .map((r) => ({
      ruleCode: r.ruleCode,
      name: r.name,
      amountType: r.amountType,
      amount: r.amount,
      perUnit: r.perUnit,
      customerNotice: r.customerNotice,
    }));

  const draftItems: QuoteItemDraft[] = items.map((i) => ({
    itemType: i.itemType,
    productId: i.productId,
    optionId: i.optionId,
    surchargeRuleId: i.surchargeRuleId,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    amount: i.amount,
  }));

  return {
    ok: true,
    branchId: area.branchId,
    items: draftItems,
    subtotalAmount,
    discountAmount,
    surchargeAmount,
    totalAmount,
    estimatedDurationMin: duration,
    needsSiteSurvey,
    onSiteRules,
    snapshot: {
      version: 1,
      priceDate: input.priceDate,
      visit: input.visit ? { ...input.visit } : null,
      customerType: input.customerType,
      totalUnits,
      items: items.map((i) => ({ ...i, discountTiers: i.discountTiers?.map((t) => ({ ...t })) })),
      products: productLines.map(({ product }) => ({
        productId: product.id,
        name: product.name,
        includedItems: product.includedItems,
        excludedItems: product.excludedItems,
      })),
      onSiteRules: onSiteRules.map((r) => ({ ...r })),
      needsSiteSurvey,
    },
  };
}

/** 견적 불가 사유 → 화면 문구 (고객 C-QUO·관리자 A-PRD-050 공용) */
export function quoteFailureMessage(r: QuoteCalcFailure): string {
  switch (r.reason) {
    case 'NOT_SERVICEABLE':
      return '아직 서비스하지 않는 지역입니다.';
    case 'NO_LINES':
      return MSG.required('기기');
    case 'NO_PRODUCT':
    case 'NO_PRICE':
      return '선택한 기기의 표준 가격이 아직 등록되지 않았습니다.';
    case 'INVALID_OPTION':
      return '선택한 옵션은 이 기기에 적용할 수 없습니다.';
  }
}

/* ---------- 단계 2 예약: 견적 스냅샷 + 방문 일시 할증 (BR-011·012·013·014) ---------- */

export interface VisitPricing {
  /** 견적 항목(스냅샷 단가 그대로, BR-014) + 방문 일시 할증 1건 */
  items: QuoteSnapshotItem[];
  subtotalAmount: number;
  discountAmount: number;
  surchargeAmount: number;
  totalAmount: number;
  /** 붙은 야간·휴일 할증 규칙 (없으면 null) → service_order.visit_type */
  timeRule: { id: number; ruleCode: string; name: string } | null;
}

/**
 * 고객 앱 견적은 방문 일시 없이 산출하므로(F-CUS-QUO-04), 예약에서 고른 일시로 야간·휴일 할증을 붙인다.
 * 상품·옵션·할인 단가는 견적 스냅샷 그대로 쓰고(BR-014 가격 변경 영향 없음), 할증만 현재 사용 중인 규칙으로 판단한다.
 * 이미 야간·휴일 할증이 들어 있는 견적(시뮬레이터·상담 콘솔)은 그것을 빼고 다시 판단한다.
 */
export function applyVisitSurcharge(input: {
  snapshot: Pick<QuoteSnapshot, 'items' | 'totalUnits'>;
  rules: readonly SurchargeRuleLike[];
  visit: VisitAt;
  holidays: readonly string[];
}): VisitPricing {
  const items = input.snapshot.items.filter(
    (i) => !(i.itemType === 'SURCHARGE' && (i.ruleCode === 'NIGHT' || i.ruleCode === 'HOLIDAY')),
  );
  const subtotalAmount = items.filter((i) => i.itemType === 'PRODUCT' || i.itemType === 'OPTION').reduce((s, i) => s + i.amount, 0);
  const discountAmount = -items.filter((i) => i.itemType === 'DISCOUNT').reduce((s, i) => s + i.amount, 0);
  const base = subtotalAmount - discountAmount;
  const time = pickTimeSurcharge(input.rules, input.visit, input.holidays, input.snapshot.totalUnits, base);
  if (time) {
    const v = surchargeValue(time, input.snapshot.totalUnits, base);
    items.push({
      itemType: 'SURCHARGE',
      productId: null,
      optionId: null,
      surchargeRuleId: time.id,
      ...v,
      name: time.name,
      ruleCode: time.ruleCode,
      amountType: time.amountType,
      perUnit: time.perUnit,
    });
  }
  const surchargeAmount = items.filter((i) => i.itemType === 'SURCHARGE').reduce((s, i) => s + i.amount, 0);
  return {
    items,
    subtotalAmount,
    discountAmount,
    surchargeAmount,
    totalAmount: Math.max(0, base + surchargeAmount),
    timeRule: time ? { id: time.id, ruleCode: time.ruleCode, name: time.name } : null,
  };
}

/** C-RSV-010 시간대 배지: 그 일시에 붙는 야간·휴일 할증 이름 (BR-011·012·013) */
export function visitSurchargeName(
  rules: readonly SurchargeRuleLike[],
  visit: VisitAt,
  holidays: readonly string[],
): string | null {
  return pickTimeSurcharge(rules, visit, holidays)?.name ?? null;
}
