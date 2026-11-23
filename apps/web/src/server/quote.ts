import 'server-only';
/**
 * 견적 서버 서비스 — 공용 견적 모듈(@aircon/domain calculateQuote)에 DB 기준 데이터를 넣어 주는 유일한 곳.
 * 고객 견적(F-CUS-QUO-01~04)과 관리자 견적 시뮬레이터(F-ADM-PRD-05)가 같은 함수를 써서 결과가 같다(04 단계 1 완료 기준).
 */
import {
  holiday,
  pricePolicy,
  quote,
  quoteItem,
  serviceArea,
  serviceCategory,
  serviceOption,
  serviceProduct,
  surchargeRule,
} from '@aircon/db';
import {
  type CustomerType,
  type QuoteCalcResult,
  type QuoteCatalog,
  type QuoteSnapshot,
  type VisitAt,
  QUOTE_EXPIRABLE_STATUSES,
  SETTING_KEYS,
  assertQuoteTransition,
  isPolicyApplicable,
  calculateQuote,
  formatQuoteNo,
  kstDate,
  kstYymmdd,
  quoteExpiresAt,
  resolveServiceArea,
} from '@aircon/domain';
import { and, asc, desc, eq, inArray, isNull, like, lt } from 'drizzle-orm';
import { getDb } from './db';
import { getSettingNumber } from './settings';

type Db = ReturnType<typeof getDb>;

/** F-CUS-QUO-01 / BR-001 법정동 → 관할 지역 */
export async function findServiceArea(legalDongCode: string, db: Db = getDb()) {
  const rows = await db.select().from(serviceArea).where(eq(serviceArea.legalDongCode, legalDongCode));
  return resolveServiceArea(rows, legalDongCode);
}

/** 견적에 쓰는 활성 상품·가격·옵션·할증 (카테고리·상품이 사용 중인 것만) */
export async function loadQuoteCatalog(db: Db = getDb()): Promise<QuoteCatalog> {
  const [products, policies, options, rules] = await Promise.all([
    db
      .select({
        id: serviceProduct.id,
        productCode: serviceProduct.productCode,
        name: serviceProduct.name,
        deviceType: serviceProduct.deviceType,
        cleanLevel: serviceProduct.cleanLevel,
        baseDurationMin: serviceProduct.baseDurationMin,
        includedItems: serviceProduct.includedItems,
        excludedItems: serviceProduct.excludedItems,
      })
      .from(serviceProduct)
      .innerJoin(serviceCategory, eq(serviceCategory.id, serviceProduct.categoryId))
      .where(
        and(
          eq(serviceProduct.isActive, true),
          isNull(serviceProduct.deletedAt),
          eq(serviceCategory.isActive, true),
        ),
      )
      .orderBy(asc(serviceProduct.productCode)),
    db.select().from(pricePolicy),
    db
      .select()
      .from(serviceOption)
      .where(eq(serviceOption.isActive, true))
      .orderBy(asc(serviceOption.optionCode)),
    db
      .select()
      .from(surchargeRule)
      .where(eq(surchargeRule.isActive, true))
      .orderBy(asc(surchargeRule.ruleCode)),
  ]);
  return {
    products,
    policies: policies.map((p) => ({
      ...p,
      customerType: p.customerType as CustomerType | null,
      multiUnitDiscountJson: p.multiUnitDiscountJson ?? null,
    })),
    options,
    surchargeRules: rules.map((r) => ({
      ...r,
      amountType: r.amountType as 'FIXED' | 'RATE',
      conditionJson: r.conditionJson ?? null,
    })),
  };
}

export interface QuoteRequest {
  legalDongCode: string;
  lines: { deviceType: string; cleanLevel: string; quantity: number }[];
  options: { optionId: number; quantity: number }[];
  customerType: CustomerType;
  visit: VisitAt | null;
}

/** F-CUS-QUO-04 견적 산출 (저장하지 않음). 시뮬레이터·고객 미리보기·고객 저장이 모두 이 함수를 거친다. */
export async function computeQuote(
  req: QuoteRequest,
  now = new Date(),
  db: Db = getDb(),
): Promise<QuoteCalcResult> {
  const { area } = await findServiceArea(req.legalDongCode, db);
  const priceDate = req.visit?.date ?? kstDate(now);
  const [catalog, holidays, siteSurveyMinUnits] = await Promise.all([
    loadQuoteCatalog(db),
    req.visit
      ? db.select({ d: holiday.holidayDate }).from(holiday).where(eq(holiday.holidayDate, req.visit.date))
      : Promise.resolve([] as { d: string }[]),
    getSettingNumber(SETTING_KEYS.QUOTE_SITE_SURVEY_MIN_UNITS),
  ]);
  return calculateQuote({
    area,
    lines: req.lines,
    options: req.options,
    customerType: req.customerType,
    priceDate,
    visit: req.visit,
    holidays: holidays.map((h) => h.d),
    catalog,
    settings: { siteSurveyMinUnits },
  });
}

/** 그날 다음 견적 번호 (Q + YYMMDD + 4자리) */
async function nextQuoteNo(db: Db, now: Date): Promise<string> {
  const prefix = `Q${kstYymmdd(now)}`;
  const [last] = await db
    .select({ no: quote.quoteNo })
    .from(quote)
    .where(like(quote.quoteNo, `${prefix}%`))
    .orderBy(desc(quote.quoteNo))
    .limit(1);
  const seq = last ? Number(last.no.slice(prefix.length)) + 1 : 1;
  return formatQuoteNo(now, seq);
}

/**
 * F-CUS-QUO-04 ⑦ 견적 저장: quote(ISSUED) + quote_item, 단가·규칙 스냅샷(BR-014), 유효기한(BR-015).
 * 비회원 견적이라 customer_id·address_id 는 비워 둔다(F-CUS-AUTH-02, 예약 단계에서 연결).
 */
export async function issueQuote(req: QuoteRequest, channel: 'APP' | 'PHONE' | 'B2B', now = new Date()) {
  const db = getDb();
  const result = await computeQuote(req, now, db);
  if (!result.ok) return result;
  const expireDays = await getSettingNumber(SETTING_KEYS.QUOTE_EXPIRE_DAYS);
  assertQuoteTransition('DRAFT', 'ISSUED');
  for (let attempt = 0; ; attempt++) {
    try {
      const quoteNo = await db.transaction(async (tx) => {
        const no = await nextQuoteNo(tx as unknown as Db, now);
        const [row] = await tx
          .insert(quote)
          .values({
            quoteNo: no,
            channel,
            legalDongCode: req.legalDongCode,
            branchId: result.branchId,
            isServiceable: true,
            subtotalAmount: result.subtotalAmount,
            discountAmount: result.discountAmount,
            surchargeAmount: result.surchargeAmount,
            totalAmount: result.totalAmount,
            estimatedDurationMin: result.estimatedDurationMin,
            status: 'ISSUED',
            expiresAt: quoteExpiresAt(now, expireDays),
            priceSnapshotJson: result.snapshot,
          })
          .returning({ id: quote.id });
        await tx.insert(quoteItem).values(result.items.map((i) => ({ ...i, quoteId: row!.id })));
        return no;
      });
      return { ok: true as const, quoteNo };
    } catch (e) {
      const code =
        (e as { code?: string; cause?: { code?: string } }).code ??
        (e as { cause?: { code?: string } }).cause?.code;
      if (code === '23505' && attempt < 4) continue; // 같은 번호를 동시에 받은 경우 다시 번호를 받는다
      throw e;
    }
  }
}

/** C-QUO-040 견적 결과 조회 (견적 번호) */
export async function getQuoteByNo(quoteNo: string) {
  const [row] = await getDb().select().from(quote).where(eq(quote.quoteNo, quoteNo));
  if (!row) return null;
  return { ...row, snapshot: row.priceSnapshotJson as QuoteSnapshot | null };
}

/**
 * C-QUO-020·030 화면 구성용: 견적 가능한(활성 상품·유효 가격이 있는) 기기 형태·작업 범위·옵션.
 * anyBranch=true 면 거점 전용 가격도 있다고 본다(주소를 모를 때). 실제 금액은 computeQuote 가 다시 판단한다.
 */
export async function loadQuoteChoices(
  legalDongCode: string | null,
  opts: { anyBranch?: boolean } = {},
  now = new Date(),
) {
  const db = getDb();
  const catalog = await loadQuoteCatalog(db);
  const area = legalDongCode ? (await findServiceArea(legalDongCode, db)).area : null;
  const today = kstDate(now);
  const priced = catalog.products.filter((p) =>
    catalog.policies.some((pp) =>
      isPolicyApplicable(opts.anyBranch ? { ...pp, branchId: null } : pp, {
        productId: p.id,
        branchId: area?.branchId ?? null,
        customerType: 'PERSONAL',
        date: today,
      }),
    ),
  );
  return {
    products: priced.map((p) => ({
      id: p.id,
      deviceType: p.deviceType,
      cleanLevel: p.cleanLevel,
      name: p.name,
    })),
    options: catalog.options.map((o) => ({ id: o.id, productId: o.productId, name: o.name, price: o.price })),
  };
}

/**
 * F-SYS-02 견적 만료 배치: 유효기한이 지난 견적을 EXPIRED 로 (전이 가능한 상태만, 01 §3.8).
 * 견적에는 상태 이력 테이블이 없으므로(01 §2.4) 상태 컬럼만 바꾼다.
 */
export async function expireQuotes(now = new Date()) {
  const db = getDb();
  const rows = await db
    .update(quote)
    .set({ status: 'EXPIRED', updatedAt: now })
    .where(and(inArray(quote.status, [...QUOTE_EXPIRABLE_STATUSES]), lt(quote.expiresAt, now)))
    .returning({ id: quote.id });
  return rows.length;
}
