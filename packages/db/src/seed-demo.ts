/**
 * 테스트용 가상(시드) 데이터 — 고객 웹 · 상담 콘솔 · 기사 앱 · 관리자(ALP) 화면을 직접 눌러 볼 수 있게 한다.
 * 사용: pnpm db:seed:demo (scripts/seed-demo.ts) 또는 GitHub Actions "DB 준비 (마이그레이션·시드)"의 [테스트용 가상 데이터] 선택.
 *
 * 여러 번 실행해도 안전하다.
 *  1) 기준 데이터(거점·관할·상품·가격·할증·옵션·자재·쿠폰·관리자·기사·고객)는 코드·번호가 이미 있으면 건너뛴다.
 *  2) 지난 이력(완료 주문·결제·정산·후기·VOC·AS·안전사고·상담·캠페인·공지·교육 등)은 처음 한 번만 넣는다.
 *  3) 오늘·다가오는 일정(오늘 코스·작업중 주문·배정 대기·변경 요청 등)은 한국 날짜마다 한 번 넣는다.
 *     → 며칠 뒤 다시 실행하면 그날 기준의 "오늘 작업"이 새로 생긴다.
 *
 * 규칙(CLAUDE.md §5): 주문·작업·배정 등 상태는 packages/domain 전이 함수로 경로를 검증하고 이력 테이블에 1행씩 INSERT 한다.
 * 견적 금액은 공용 견적 모듈(calculateQuote)로 계산하고 스냅샷을 저장한다(BR-010~015). 개인정보 컬럼은 암호화·해시한다.
 */
import {
  type CommissionPolicyLike,
  type OrderStatus,
  type QuoteCatalog,
  type QuoteSnapshot,
  assertApplicationTransition,
  assertAsTransition,
  assertAssignTransition,
  assertBatchTransition,
  assertCampaignTransition,
  assertConsultTransition,
  assertCourseTransition,
  assertIncidentTransition,
  assertInspectionTransition,
  assertMaterialRequestTransition,
  assertRouteTransition,
  assertSettlementTransition,
  assertTaxDocTransition,
  assertVocTransition,
  assertWorkTransition,
  batchNoOf,
  buildSlotPlan,
  calcJobShares,
  calculateQuote,
  formatAfterNo,
  formatConsultNo,
  formatCustomerNo,
  formatOrderNo,
  formatQuoteNo,
  maskPhone,
  orderStatusHistoryRow,
  scheduledPayDateOf,
  selectCommissionPolicy,
  slotHoursFor,
  summarizeSettlement,
  weekOf,
} from '@aircon/domain';
import { encryptPii, hashPassword, hashPhone } from '@aircon/domain/server';
import { randomBytes } from 'node:crypto';
import { and, eq, inArray, isNull, like, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Db } from './client';
import {
  activityLog,
  adminUser,
  areaOpenRequest,
  asRequest,
  assignment,
  assignmentHistory,
  attachment,
  auditLog,
  branch,
  callLog,
  campaign,
  campaignTarget,
  commissionPolicy,
  consentHistory,
  consultation,
  coupon,
  customer,
  customerAddress,
  customerCoupon,
  customerDevice,
  customerTag,
  extraCharge,
  faq,
  followupRequest,
  holiday,
  incidentRecipient,
  material,
  materialRequest,
  materialUsage,
  memo,
  memoRecipient,
  notice,
  noticeRead,
  notificationLog,
  notificationTemplate,
  orderChangeRequest,
  orderItem,
  orderStatusHistory,
  payment,
  pricePolicy,
  quickMenu,
  quote,
  quoteItem,
  refund,
  review,
  role,
  routePlan,
  routeStop,
  safetyIncident,
  serviceArea,
  serviceCategory,
  serviceOption,
  serviceOrder,
  serviceProduct,
  settlement,
  settlementBatch,
  settlementItem,
  settlementStatusHistory,
  surchargeRule,
  systemSetting,
  taxDocument,
  techDocument,
  technician,
  technicianApplication,
  technicianArea,
  technicianDailyDistance,
  technicianGradeHistory,
  technicianLocation,
  technicianMaterialStock,
  technicianSkill,
  technicianZone,
  timeSlot,
  trainingCourse,
  trainingEnrollment,
  voc,
  vocHistory,
  workOrder,
  workPhoto,
  workResult,
  workSchedule,
} from './schema';
import {
  type CustKey,
  DEMO_ADMINS,
  DEMO_AREAS,
  DEMO_EXTRA_AREAS,
  DEMO_BRANCHES,
  DEMO_BRANCH_PRICES,
  DEMO_BUSINESS_PRICES,
  DEMO_CATEGORIES,
  DEMO_COUPONS,
  DEMO_CUSTOMERS,
  DEMO_MATERIALS,
  DEMO_OPTIONS,
  DEMO_PRODUCTS,
  DEMO_SURCHARGES,
  DEMO_TAG,
  DEMO_TECHS,
  type TechKey,
  demoAdminEmail,
} from './seed-demo-fixtures';

export interface DemoSeedOptions {
  /** PII_ENCRYPTION_KEY (앱과 같은 값이어야 화면에서 복호화된다) */
  piiKey: string;
  /** PII_HASH_PEPPER (앱과 같은 값이어야 휴대폰 번호로 로그인·검색된다) */
  pepper: string;
  /** 테스트 관리자·기사 비밀번호 */
  password: string;
  /** 관리자 인증 계정 생성 (Supabase Auth 또는 Mock). auth_user_id 를 돌려준다 */
  createAuthUser: (email: string, password: string) => Promise<string>;
  /** 작업 사진·서명 예시 이미지를 저장소에 올린다(없으면 이미지 없이 기록만) */
  putFile?: (key: string, body: Uint8Array, mimeType: string) => Promise<void>;
  now?: Date;
  log?: (msg: string) => void;
}

export interface DemoSeedResult {
  admins: number;
  technicians: number;
  customers: number;
  historyInserted: boolean;
  todayInserted: boolean;
  orders: number;
}

/* ====================================================================== */
/* 날짜 도우미 (한국 시간)                                                 */
/* ====================================================================== */

const DAY_MS = 86_400_000;
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const kstDateOf = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

class Clock {
  readonly today: string;
  constructor(readonly now: Date) {
    this.today = kstDateOf(now);
  }
  /** 오늘 + n 일 (YYYY-MM-DD) */
  day(n: number): string {
    const [y, m, d] = this.today.split('-').map(Number);
    return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
  }
  /** 일요일이면 하루 밀거나(미래) 당긴다(과거) — 기사 근무일(월~토)에 맞춘다 */
  workday(n: number): number {
    const dow = new Date(`${this.day(n)}T00:00:00Z`).getUTCDay();
    if (dow !== 0) return n;
    return n >= 0 ? n + 1 : n - 1;
  }
  /** 오늘 + n 일 hh:mm (KST) */
  at(n: number, hh: number, mm = 0): Date {
    return new Date(`${this.day(n)}T${pad(hh)}:${pad(mm)}:00+09:00`);
  }
  dow(date: string) {
    return new Date(`${date}T00:00:00Z`).getUTCDay();
  }
}

const addMin = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);
const kstYymmdd = (d: Date) => kstDateOf(d).slice(2).replace(/-/g, '');

/** 작은 단색 PNG (작업 사진·서명 예시 이미지). 외부 파일 없이 만든다 */
function solidPng(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const zlib = require('node:zlib') as typeof import('node:zlib');
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

/* ====================================================================== */
/* 시드 컨텍스트                                                           */
/* ====================================================================== */

type Ids = Record<string, number>;

interface Ctx {
  db: Db;
  o: DemoSeedOptions;
  clock: Clock;
  log: (m: string) => void;
  enc: (v: string) => string;
  ph: (v: string) => string;
  branchId: Ids;
  areaByCode: Map<string, { branchId: number; travelFee: number; lat: number; lng: number; zipcode: string; road: string; dong: string; sido: string; sigungu: string; isServiceable: boolean }>;
  adminId: Record<string, number>;
  techId: Partial<Record<TechKey, number>>;
  techMeta: Partial<Record<TechKey, { grade: string; contract: string; branchId: number }>>;
  cust: Partial<Record<CustKey, { id: number; phone: string; addressIds: number[]; branchId: number; type: 'PERSONAL' | 'BUSINESS' }>>;
  productId: Ids;
  productByType: Map<string, { id: number; minutes: number; warrantyDays: number; name: string; deviceType: string; cleanLevel: string }>;
  optionId: Ids;
  ruleId: Ids;
  materialId: Ids;
  couponId: Ids;
  templateId: Ids;
  catalog: QuoteCatalog;
  holidays: string[];
  seq: Map<string, number>;
  files: { before: string; after: string; signature: string; issue: string };
  slotIds: Map<string, number>;
  /** 트랜잭션용 복사본과 공유하는 집계 */
  stat: { orders: number };
}

const one = async <T>(q: Promise<T[]>): Promise<T> => {
  const r = await q;
  if (!r[0]) throw new Error('행을 만들지 못했습니다.');
  return r[0];
};

/** 번호 일련: 접두어별로 DB 의 마지막 번호 다음부터 (같은 실행 안에서도 증가) */
async function nextSeq(c: Ctx, key: string, current: () => Promise<number>): Promise<number> {
  if (!c.seq.has(key)) c.seq.set(key, await current());
  const n = c.seq.get(key)! + 1;
  c.seq.set(key, n);
  return n;
}

async function lastNo(c: Ctx, col: PgColumn, table: PgTable, prefix: string): Promise<number> {
  const [r] = await c.db
    .select({ no: sql<string | null>`max(${col})` })
    .from(table)
    .where(like(col, `${prefix}%`));
  return r?.no ? Number(String(r.no).slice(prefix.length)) || 0 : 0;
}

async function newCustomerNo(c: Ctx, at: Date) {
  const prefix = `C${kstYymmdd(at).slice(0, 4)}`;
  const n = await nextSeq(c, prefix, () => lastNo(c, customer.customerNo, customer, prefix));
  return formatCustomerNo(at, n);
}
async function newQuoteNo(c: Ctx, at: Date) {
  const prefix = `Q${kstYymmdd(at)}`;
  return formatQuoteNo(at, await nextSeq(c, prefix, () => lastNo(c, quote.quoteNo, quote, prefix)));
}
async function newConsultNo(c: Ctx, at: Date) {
  const prefix = `J${kstYymmdd(at)}`;
  return formatConsultNo(at, await nextSeq(c, prefix, () => lastNo(c, consultation.consultNo, consultation, prefix)));
}
async function newAfterNo(c: Ctx, p: 'V' | 'S' | 'A', at: Date) {
  const prefix = `${p}${kstYymmdd(at)}`;
  const current = () =>
    p === 'V'
      ? lastNo(c, voc.vocNo, voc, prefix)
      : p === 'S'
        ? lastNo(c, safetyIncident.incidentNo, safetyIncident, prefix)
        : lastNo(c, asRequest.asNo, asRequest, prefix);
  return formatAfterNo(p, at, await nextSeq(c, prefix, current));
}
/** 접수 번호는 분 단위 + 일련(A1…). 같은 분에 이미 있으면 다음 일련 */
async function newOrderNo(c: Ctx, at: Date) {
  const prefix = formatOrderNo(at, 1).slice(0, 10);
  const n = await nextSeq(c, `O${prefix}`, async () => {
    const [r] = await c.db
      .select({ n: sql<number>`count(*)::int` })
      .from(serviceOrder)
      .where(like(serviceOrder.orderNo, `${prefix}%`));
    return r?.n ?? 0;
  });
  return formatOrderNo(at, n);
}
let paySeq = 0;
function newPaymentNo(at: Date) {
  paySeq++;
  const k = new Date(at.getTime() + 9 * 3600_000).toISOString().replace(/[-:T]/g, '').slice(2, 14);
  // 앱(newPaymentNo)과 같은 형식: P + 한국시각 YYMMDDHHmmss + 4자리 (실행마다 겹치지 않게 무작위 섞음)
  const rnd = randomBytes(3).toString('hex').toUpperCase().slice(0, 3);
  return `P${k}${(paySeq % 36).toString(36).toUpperCase()}${rnd}`;
}

/* ====================================================================== */
/* 진입점                                                                  */
/* ====================================================================== */

export async function seedDemoData(db: Db, o: DemoSeedOptions): Promise<DemoSeedResult> {
  const now = o.now ?? new Date();
  const c: Ctx = {
    db,
    o,
    clock: new Clock(now),
    log: o.log ?? (() => undefined),
    enc: (v) => encryptPii(v, o.piiKey),
    ph: (v) => hashPhone(v, o.pepper),
    branchId: {},
    areaByCode: new Map(),
    adminId: {},
    techId: {},
    techMeta: {},
    cust: {},
    productId: {},
    productByType: new Map(),
    optionId: {},
    ruleId: {},
    materialId: {},
    couponId: {},
    templateId: {},
    catalog: { products: [], policies: [], options: [], surchargeRules: [] },
    holidays: [],
    seq: new Map(),
    files: { before: '', after: '', signature: '', issue: '' },
    slotIds: new Map(),
    stat: { orders: 0 },
  };
  paySeq = 0;

  const templates = await db.select({ id: notificationTemplate.id, code: notificationTemplate.templateCode }).from(notificationTemplate);
  if (templates.length === 0) throw new Error('기본 데이터가 없습니다. 먼저 pnpm db:seed 를 실행하세요.');
  for (const t of templates) c.templateId[t.code] = t.id;

  await seedBranches(c);
  await seedCatalog(c);
  const admins = await seedAdmins(c);
  const techs = await seedTechnicians(c);
  const customers = await seedCustomers(c);
  await uploadSampleFiles(c);
  await seedSchedulesAndSlots(c);

  // 지난 이력: 가상 데이터 주문이 하나도 없을 때만
  const [hist] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(serviceOrder)
    .where(like(serviceOrder.internalNote, `${DEMO_TAG}%`));
  const historyInserted = (hist?.n ?? 0) === 0;
  if (historyInserted) {
    c.log('지난 이력(완료 주문·정산·사후관리·CRM·콘텐츠·교육)을 넣습니다…');
    // 한 트랜잭션: 중간에 실패하면 아무것도 남지 않아 다시 실행하면 처음부터 넣는다
    await db.transaction(async (tx) => seedHistory({ ...c, db: tx as unknown as Db }));
  } else c.log('지난 이력은 이미 있어 건너뜁니다.');

  // 오늘·다가오는 일정: 한국 날짜마다 한 번
  const todayTag = `${DEMO_TAG.slice(0, -1)} ${c.clock.today}]`;
  const [today] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(serviceOrder)
    .where(like(serviceOrder.internalNote, `${todayTag}%`));
  const todayInserted = (today?.n ?? 0) === 0;
  if (todayInserted) {
    c.log(`오늘(${c.clock.today}) 일정·작업을 넣습니다…`);
    await db.transaction(async (tx) => seedToday({ ...c, db: tx as unknown as Db }, todayTag));
  } else c.log(`오늘(${c.clock.today}) 일정은 이미 있어 건너뜁니다.`);

  return { admins, technicians: techs, customers, historyInserted, todayInserted, orders: c.stat.orders };
}

/* ====================================================================== */
/* 1. 기준 데이터                                                          */
/* ====================================================================== */

async function seedBranches(c: Ctx) {
  const { db } = c;
  await db
    .insert(branch)
    .values(
      DEMO_BRANCHES.map((b) => ({
        branchCode: b.code,
        name: b.name,
        status: b.status,
        address: b.address,
        centerLat: b.lat,
        centerLng: b.lng,
        radiusKm: b.radiusKm,
        phone: b.phone,
        openTime: '09:00',
        closeTime: '18:00',
        openedAt: b.openedAt,
      })),
    )
    .onConflictDoNothing();
  const rows = await db.select({ id: branch.id, code: branch.branchCode }).from(branch).where(inArray(branch.branchCode, DEMO_BRANCHES.map((b) => b.code)));
  for (const r of rows) c.branchId[r.code] = r.id;

  await db
    .insert(serviceArea)
    .values(
      DEMO_AREAS.map((a) => ({
        branchId: c.branchId[a.branch]!,
        sido: a.sido,
        sigungu: a.sigungu,
        eupmyeondong: a.dong,
        legalDongCode: a.code,
        isServiceable: a.serviceable,
        travelFee: a.travelFee,
      })),
    )
    .onConflictDoNothing();
  await db
    .insert(serviceArea)
    .values(
      DEMO_EXTRA_AREAS.map((a) => ({
        branchId: c.branchId[a.branch]!,
        sido: a.sido,
        sigungu: a.sigungu,
        eupmyeondong: a.dong,
        legalDongCode: a.code,
        isServiceable: true,
        travelFee: 0,
      })),
    )
    .onConflictDoNothing();
  const areas = await db.select().from(serviceArea).where(inArray(serviceArea.legalDongCode, DEMO_AREAS.map((a) => a.code)));
  for (const a of DEMO_AREAS) {
    const row = areas.find((r) => r.legalDongCode === a.code);
    c.areaByCode.set(a.code, {
      branchId: row?.branchId ?? c.branchId[a.branch]!,
      travelFee: row?.travelFee ?? a.travelFee,
      isServiceable: row?.isServiceable ?? a.serviceable,
      lat: a.lat,
      lng: a.lng,
      zipcode: a.zipcode,
      road: a.road,
      dong: a.dong,
      sido: a.sido,
      sigungu: a.sigungu,
    });
  }
  // 2026년 남은 공휴일(기본 시드는 2027년부터) — 휴일 할증 시험용
  await db.insert(holiday).values([{ holidayDate: '2026-12-25', name: '성탄절', isSurcharge: true }]).onConflictDoNothing();
}

async function seedCatalog(c: Ctx) {
  const { db } = c;
  await db.insert(serviceCategory).values(DEMO_CATEGORIES).onConflictDoNothing();
  const cats = await db.select().from(serviceCategory).where(inArray(serviceCategory.code, DEMO_CATEGORIES.map((x) => x.code)));
  const catId = (code: string) => cats.find((x) => x.code === code)!.id;

  await db
    .insert(serviceProduct)
    .values(
      DEMO_PRODUCTS.map((p) => ({
        categoryId: catId('AIRCON_CLEAN'),
        productCode: p.code,
        name: p.name,
        deviceType: p.deviceType,
        cleanLevel: p.cleanLevel,
        baseDurationMin: p.minutes,
        requiredTechCount: p.techCount ?? 1,
        requiredSkillLevel: p.skill ?? null,
        description: `${p.name} (테스트 상품)`,
        includedItems: p.included,
        excludedItems: p.excluded,
        warrantyDays: p.warrantyDays,
      })),
    )
    .onConflictDoNothing();
  const products = await db.select().from(serviceProduct).where(inArray(serviceProduct.productCode, DEMO_PRODUCTS.map((p) => p.code)));
  for (const p of products) {
    c.productId[p.productCode] = p.id;
    c.productByType.set(`${p.deviceType}|${p.cleanLevel}`, {
      id: p.id,
      minutes: p.baseDurationMin,
      warrantyDays: p.warrantyDays,
      name: p.name,
      deviceType: p.deviceType,
      cleanLevel: p.cleanLevel,
    });
  }

  // 가격 정책: 상품마다 공통가가 없을 때만 (운영 중 바꾼 가격 보존)
  const existing = await db.select({ productId: pricePolicy.productId, branchId: pricePolicy.branchId, customerType: pricePolicy.customerType }).from(pricePolicy);
  const has = (pid: number, bid: number | null, ct: string | null) => existing.some((e) => e.productId === pid && e.branchId === bid && e.customerType === ct);
  const policies: (typeof pricePolicy.$inferInsert)[] = [];
  for (const p of DEMO_PRODUCTS) {
    const pid = c.productId[p.code]!;
    if (!has(pid, null, null)) policies.push({ productId: pid, unitPrice: p.price, multiUnitDiscountJson: p.tiers ?? null, validFrom: '2026-01-01' });
  }
  for (const bp of DEMO_BRANCH_PRICES) {
    const pid = c.productId[bp.product]!;
    const bid = c.branchId[bp.branch]!;
    if (!has(pid, bid, null)) policies.push({ productId: pid, branchId: bid, unitPrice: bp.price, multiUnitDiscountJson: DEMO_PRODUCTS.find((p) => p.code === bp.product)?.tiers ?? null, validFrom: '2026-01-01', priority: 10 });
  }
  for (const bp of DEMO_BUSINESS_PRICES) {
    const pid = c.productId[bp.product]!;
    if (!has(pid, null, 'BUSINESS')) policies.push({ productId: pid, customerType: 'BUSINESS', unitPrice: bp.price, multiUnitDiscountJson: DEMO_PRODUCTS.find((p) => p.code === bp.product)?.tiers ?? null, validFrom: '2026-01-01', priority: 5 });
  }
  if (policies.length) await db.insert(pricePolicy).values(policies);

  await db
    .insert(surchargeRule)
    .values(DEMO_SURCHARGES.map((s) => ({ ...s, conditionJson: s.conditionJson as Record<string, unknown> | null })))
    .onConflictDoNothing();
  await db
    .insert(serviceOption)
    .values(DEMO_OPTIONS.map((x) => ({ optionCode: x.code, name: x.name, productId: x.product ? c.productId[x.product]! : null, price: x.price, durationMin: x.minutes })))
    .onConflictDoNothing();
  await db
    .insert(material)
    .values(DEMO_MATERIALS.map((m) => ({ materialCode: m.code, name: m.name, unit: m.unit, unitCost: m.cost, salePrice: m.sale, safetyStock: m.safety })))
    .onConflictDoNothing();
  await db
    .insert(coupon)
    .values(
      DEMO_COUPONS.map((x) => ({
        code: x.code,
        name: x.name,
        discountType: x.type,
        discountValue: x.value,
        maxDiscount: x.max,
        minOrderAmount: x.min,
        validFrom: x.from,
        validTo: x.to,
        issueLimit: x.limit,
        targetCategoryId: catId('AIRCON_CLEAN'),
      })),
    )
    .onConflictDoNothing();

  for (const r of await db.select({ id: serviceOption.id, code: serviceOption.optionCode }).from(serviceOption)) c.optionId[r.code] = r.id;
  for (const r of await db.select({ id: surchargeRule.id, code: surchargeRule.ruleCode }).from(surchargeRule)) c.ruleId[r.code] = r.id;
  for (const r of await db.select({ id: material.id, code: material.materialCode }).from(material)) c.materialId[r.code] = r.id;
  for (const r of await db.select({ id: coupon.id, code: coupon.code }).from(coupon)) c.couponId[r.code] = r.id;

  // 견적 계산용 카탈로그 (활성 데이터만)
  const allProducts = await db.select().from(serviceProduct).where(and(eq(serviceProduct.isActive, true), isNull(serviceProduct.deletedAt)));
  const allPolicies = await db.select().from(pricePolicy);
  const allOptions = await db.select().from(serviceOption).where(eq(serviceOption.isActive, true));
  const allRules = await db.select().from(surchargeRule).where(eq(surchargeRule.isActive, true));
  c.catalog = {
    products: allProducts.map((p) => ({ id: p.id, productCode: p.productCode, name: p.name, deviceType: p.deviceType, cleanLevel: p.cleanLevel, baseDurationMin: p.baseDurationMin, includedItems: p.includedItems, excludedItems: p.excludedItems })),
    policies: allPolicies.map((p) => ({ id: p.id, productId: p.productId, branchId: p.branchId, customerType: (p.customerType as 'PERSONAL' | 'BUSINESS' | null) ?? null, unitPrice: p.unitPrice, validFrom: p.validFrom, validTo: p.validTo, priority: p.priority, multiUnitDiscountJson: p.multiUnitDiscountJson ?? null })),
    options: allOptions.map((x) => ({ id: x.id, productId: x.productId, optionCode: x.optionCode, name: x.name, price: x.price, durationMin: x.durationMin })),
    surchargeRules: allRules.map((r) => ({ id: r.id, ruleCode: r.ruleCode, name: r.name, applyType: r.applyType, conditionJson: r.conditionJson ?? null, amountType: r.amountType as 'FIXED' | 'RATE', amount: r.amount, perUnit: r.perUnit, customerNotice: r.customerNotice })),
  };
  c.holidays = (await db.select({ d: holiday.holidayDate }).from(holiday)).map((h) => h.d);
}

async function seedAdmins(c: Ctx): Promise<number> {
  const { db } = c;
  const roles = await db.select().from(role);
  let created = 0;
  for (const a of DEMO_ADMINS) {
    const [exists] = await db.select({ id: adminUser.id }).from(adminUser).where(eq(adminUser.loginId, a.loginId));
    if (exists) {
      c.adminId[a.loginId] = exists.id;
      continue;
    }
    const r = roles.find((x) => x.roleCode === a.role);
    if (!r) throw new Error(`${a.role} 역할이 없습니다. 먼저 pnpm db:seed 를 실행하세요.`);
    let authUserId: string;
    try {
      authUserId = await c.o.createAuthUser(demoAdminEmail(a.loginId), c.o.password);
    } catch (e) {
      c.log(`  ! ${a.loginId}: 인증 계정을 만들지 못해 건너뜁니다 (${(e as Error).message})`);
      continue;
    }
    const row = await one(
      db
        .insert(adminUser)
        .values({
          authUserId,
          loginId: a.loginId,
          name: a.name,
          phone: c.enc(a.phone),
          email: demoAdminEmail(a.loginId),
          roleId: r.id,
          branchId: a.branch ? c.branchId[a.branch]! : null,
          status: a.status,
          loginFailCount: a.status === 'LOCKED' ? 5 : 0,
        })
        .returning({ id: adminUser.id }),
    );
    c.adminId[a.loginId] = row.id;
    created++;
  }
  // 거점장 지정 (비어 있을 때만)
  for (const [code, login] of [['EP01', 'demo-ep'], ['BD01', 'demo-bd']] as const) {
    const id = c.adminId[login];
    if (id) await db.update(branch).set({ managerAdminId: id }).where(and(eq(branch.branchCode, code), isNull(branch.managerAdminId)));
  }
  c.log(`관리자 계정: 새로 ${created}개 (전체 ${Object.keys(c.adminId).length}개)`);
  return created;
}

/** 관리자 행위자 ID (계정을 못 만들었으면 null) */
const adm = (c: Ctx, login: string) => c.adminId[login] ?? null;

async function seedTechnicians(c: Ctx): Promise<number> {
  const { db } = c;
  let created = 0;
  const pwHash = hashPassword(c.o.password);
  for (const t of DEMO_TECHS) {
    const [exists] = await db.select({ id: technician.id }).from(technician).where(eq(technician.techCode, t.code));
    const branchId = c.branchId[t.branch]!;
    c.techMeta[t.key] = { grade: t.grade, contract: t.contract, branchId };
    if (exists) {
      c.techId[t.key] = exists.id;
      continue;
    }
    const joined = c.clock.day(-t.joinedDaysAgo);
    const row = await one(
      db
        .insert(technician)
        .values({
          techCode: t.code,
          loginId: c.ph(t.phone),
          passwordHash: pwHash,
          name: t.name,
          displayName: t.name,
          phone: c.enc(t.phone),
          branchId,
          grade: t.grade,
          contractType: t.contract,
          bizRegNo: t.contract === 'EMPLOYEE' ? null : '000-00-00000',
          status: t.status,
          joinedAt: joined,
          leftAt: t.status === 'LEFT' ? c.clock.day(-30) : null,
          leaveReason: t.status === 'LEFT' ? 'SEASONAL' : null,
          accompanyRequiredCount: 3,
          accompanyDoneCount: t.grade === 'TRAINEE' ? 1 : 3,
          licenses: t.grade === 'LEADER' ? '공조냉동기계기능사' : null,
          bankCode: '004',
          bankAccount: c.enc('000000-00-000000'),
          accountHolder: t.name,
          hasVehicle: t.grade !== 'TRAINEE',
          vehicleNo: t.grade !== 'TRAINEE' ? '00가0000' : null,
          insuranceJoined: true,
          ratingAvg: t.status === 'ACTIVE' ? (t.grade === 'LEADER' ? '4.85' : '4.40') : null,
          intro: t.intro,
          locationAgreedAt: t.status === 'ACTIVE' ? c.clock.at(-t.joinedDaysAgo + 1, 9) : null,
          createdAt: c.clock.at(-t.joinedDaysAgo, 10),
          createdBy: adm(c, 'demo-ops'),
        })
        .returning({ id: technician.id }),
    );
    const id = row.id;
    c.techId[t.key] = id;
    created++;

    // 숙련 (BR-072)
    const skillsFor = (): { deviceType: string; skillLevel: string }[] => {
      if (t.grade === 'LEADER') return ['WALL', 'STAND', 'TWO_IN_ONE', 'CEILING_1WAY', 'CEILING_4WAY', 'SYSTEM', 'WINDOW'].map((d) => ({ deviceType: d, skillLevel: 'CAN_TEACH' }));
      if (t.grade === 'TRAINEE') return [{ deviceType: 'WALL', skillLevel: 'CAN_ASSIST' }, { deviceType: 'STAND', skillLevel: 'CAN_ASSIST' }];
      return [
        { deviceType: 'WALL', skillLevel: 'CAN_SOLO' },
        { deviceType: 'STAND', skillLevel: 'CAN_SOLO' },
        { deviceType: 'TWO_IN_ONE', skillLevel: 'CAN_SOLO' },
        { deviceType: 'WINDOW', skillLevel: 'CAN_SOLO' },
        { deviceType: 'CEILING_4WAY', skillLevel: 'CAN_ASSIST' },
        { deviceType: 'SYSTEM', skillLevel: 'CAN_ASSIST' },
      ];
    };
    await db.insert(technicianSkill).values(
      skillsFor().map((s) => ({ technicianId: id, ...s, certifiedAt: joined, certifiedBy: adm(c, t.branch === 'EP01' ? 'demo-ep' : 'demo-bd') })),
    );

    // 관할 구역(지도) + 활동지역
    if (t.dongs.length) {
      const first = c.areaByCode.get(t.dongs[0]!)!;
      const zone = await one(
        db
          .insert(technicianZone)
          .values({
            technicianId: id,
            branchId,
            zoneName: `${t.name} 주 관할`,
            zoneType: 'PRIMARY',
            defineMethod: 'DONG_SET',
            dongCodes: t.dongs,
            centerLat: first.lat.toFixed(7),
            centerLng: first.lng.toFixed(7),
            color: String((DEMO_TECHS.indexOf(t) % 6) + 1),
            validFrom: joined,
          })
          .returning({ id: technicianZone.id }),
      );
      await db.insert(technicianArea).values(t.dongs.map((d) => ({ technicianId: id, zoneId: zone.id, legalDongCode: d, priority: 1 })));
    }

    // 등급 이력 (INSERT ONLY)
    await db.insert(technicianGradeHistory).values({ technicianId: id, fromGrade: null, toGrade: t.grade === 'LEADER' ? 'REGULAR' : t.grade, reason: '최초 등록', approvedBy: adm(c, 'demo-ops'), effectiveDate: joined, createdAt: c.clock.at(-t.joinedDaysAgo, 10) });
    if (t.grade === 'LEADER') {
      await db.insert(technicianGradeHistory).values({ technicianId: id, fromGrade: 'REGULAR', toGrade: 'LEADER', reason: '평점·작업 실적 우수로 팀장 승급', approvedBy: adm(c, 'demo-super'), effectiveDate: c.clock.day(-60), createdAt: c.clock.at(-60, 11) });
    }

    // 보유 자재
    if (t.status === 'ACTIVE' || t.status === 'TRAINING') {
      await db.insert(technicianMaterialStock).values([
        { technicianId: id, materialId: c.materialId['M-CLEANER']!, quantity: t.grade === 'TRAINEE' ? 1 : 6 },
        { technicianId: id, materialId: c.materialId['M-COVER']!, quantity: 20 },
        { technicianId: id, materialId: c.materialId['M-FILTER']!, quantity: t.key === 'seo' ? 1 : 8 },
        { technicianId: id, materialId: c.materialId['M-DRAIN']!, quantity: 4 },
      ]);
    }
  }
  c.log(`기사: 새로 ${created}명 (전체 ${Object.keys(c.techId).length}명)`);
  return created;
}

async function seedCustomers(c: Ctx): Promise<number> {
  const { db } = c;
  let created = 0;
  for (const k of DEMO_CUSTOMERS) {
    const hash = c.ph(k.phone);
    const [exists] = await db.select({ id: customer.id }).from(customer).where(and(eq(customer.phone1Hash, hash), isNull(customer.deletedAt)));
    let id: number;
    const joinedAt = c.clock.at(-k.joinedDaysAgo, 10, 30);
    if (exists) {
      // 이미 같은 번호로 로그인·가입한 고객이면 그 고객에 이력을 붙인다
      id = exists.id;
    } else {
      const row = await one(
        db
          .insert(customer)
          .values({
            customerNo: await newCustomerNo(c, joinedAt),
            customerType: k.type,
            name: c.enc(k.name),
            phone1: c.enc(k.phone),
            phone1Hash: hash,
            email: k.email,
            joinChannel: k.join,
            authProvider: k.auth,
            grade: k.grade,
            privacyAgreeStatus: 'AGREED',
            marketingAgree: k.marketing,
            referralCode: `D${k.phone.slice(-4)}`,
            memo: k.memo,
            status: k.status,
            dormantAt: k.status === 'DORMANT' ? c.clock.at(-30, 2) : null,
            createdAt: joinedAt,
            updatedAt: joinedAt,
          })
          .returning({ id: customer.id }),
      );
      id = row.id;
      created++;
      // 동의 이력 (INSERT ONLY)
      const channel = k.join === 'PHONE' ? 'PHONE' : 'APP';
      await db.insert(consentHistory).values([
        { customerId: id, consentType: 'TERMS', action: 'AGREE', channel, termsVersion: 'v1.0', agentAdminId: channel === 'PHONE' ? adm(c, 'demo-cs') : null, createdAt: joinedAt },
        { customerId: id, consentType: 'PRIVACY_REQUIRED', action: 'AGREE', channel, termsVersion: 'v1.0', agentAdminId: channel === 'PHONE' ? adm(c, 'demo-cs') : null, createdAt: joinedAt },
        { customerId: id, consentType: 'MARKETING_SMS', action: k.marketing ? 'AGREE' : 'DISAGREE', channel, termsVersion: 'v1.0', createdAt: joinedAt },
      ]);
      if (k.tags.length) {
        await db.insert(customerTag).values(k.tags.map((tagCode) => ({ customerId: id, tagCode, note: tagCode === 'CAUTION' ? '방문 전 통화 필수' : tagCode === 'MOVING' ? '다음 달 이사 예정' : '연 2회 이상 이용', createdBy: adm(c, 'demo-cs') })));
      }
    }
    // 주소가 하나도 없으면(먼저 직접 로그인해 생긴 고객 포함) 예시 주소를 넣는다
    const [hasAddr] = await db
      .select({ id: customerAddress.id })
      .from(customerAddress)
      .where(and(eq(customerAddress.customerId, id), isNull(customerAddress.deletedAt)))
      .limit(1);
    if (!hasAddr) {
      for (const [i, a] of k.addresses.entries()) {
        const area = c.areaByCode.get(a.dong)!;
        const jitter = (DEMO_CUSTOMERS.indexOf(k) * 7 + i * 3) % 10;
        await db.insert(customerAddress).values({
          customerId: id,
          alias: a.alias,
          zipcode: area.zipcode,
          roadAddress: `${area.road} ${a.no} (예시)`,
          jibunAddress: `${area.sido.replace('특별시', '').replace('광역시', '').replace('도', '')} ${area.sigungu} ${area.dong} ${a.no}`,
          detailAddress: c.enc(a.detail),
          legalDongCode: a.dong,
          lat: (area.lat + (jitter - 5) * 0.0006).toFixed(7),
          lng: (area.lng + ((jitter * 3) % 10 - 5) * 0.0007).toFixed(7),
          housingType: a.housing,
          hasElevator: a.elevator,
          parkingNote: a.parking ?? null,
          branchId: area.branchId,
          isDefault: i === 0,
          createdAt: joinedAt,
          createdBy: id,
        });
      }
    }
    const addrs = await db.select({ id: customerAddress.id, branchId: customerAddress.branchId }).from(customerAddress).where(and(eq(customerAddress.customerId, id), isNull(customerAddress.deletedAt))).orderBy(customerAddress.id);
    c.cust[k.key] = { id, phone: k.phone, addressIds: addrs.map((a) => a.id), branchId: addrs[0]?.branchId ?? c.branchId.EP01!, type: k.type };
  }
  c.log(`고객: 새로 ${created}명 (전체 ${Object.keys(c.cust).length}명)`);
  return created;
}

async function uploadSampleFiles(c: Ctx) {
  const files = {
    before: { key: 'demo/work-before.png', png: solidPng(64, 48, [120, 110, 90]) },
    after: { key: 'demo/work-after.png', png: solidPng(64, 48, [225, 238, 250]) },
    signature: { key: 'demo/signature.png', png: solidPng(96, 32, [250, 250, 250]) },
    issue: { key: 'demo/issue.png', png: solidPng(64, 48, [200, 80, 60]) },
  };
  for (const [k, f] of Object.entries(files)) {
    c.files[k as keyof Ctx['files']] = f.key;
    if (!c.o.putFile) continue;
    try {
      await c.o.putFile(f.key, f.png, 'image/png');
    } catch (e) {
      // 이미 올린 파일(재실행)이거나 저장소 미설정 — 기록은 남기고 계속한다
      if (!/exists|duplicate/i.test((e as Error).message)) c.log(`  ! 예시 이미지 ${f.key} 업로드 실패: ${(e as Error).message}`);
    }
  }
}

async function newAttachment(c: Ctx, file: keyof Ctx['files'], refType: string, refId: number | null, by: { type: string; id: number | null }, at: Date) {
  const row = await one(
    c.db
      .insert(attachment)
      .values({
        storageKey: c.files[file],
        originalName: `${file}.png`,
        mimeType: 'image/png',
        sizeBytes: 200,
        refType,
        refId,
        uploadedByType: by.type,
        uploadedById: by.id,
        createdAt: at,
      })
      .returning({ id: attachment.id }),
  );
  return row.id;
}

/* ---------- 근무표·슬롯 ---------- */

async function seedSchedulesAndSlots(c: Ctx) {
  const { db, clock } = c;
  const rows: (typeof workSchedule.$inferInsert)[] = [];
  for (const t of DEMO_TECHS) {
    const id = c.techId[t.key];
    if (!id || !['ACTIVE', 'TRAINING'].includes(t.status)) continue;
    for (let n = -35; n <= 21; n++) {
      const date = clock.day(n);
      const dow = clock.dow(date);
      let scheduleType = dow === 0 ? 'OFF' : 'WORK';
      let note: string | null = null;
      if (t.status === 'TRAINING' && dow !== 0) {
        scheduleType = dow === 2 || dow === 4 ? 'TRAINING' : 'WORK';
        note = scheduleType === 'TRAINING' ? '기본과정 교육' : '동행 실습';
      }
      if (t.key === 'seo' && n === 4 && dow !== 0) {
        scheduleType = 'HALF_PM';
        note = '오후 반차';
      }
      if (t.key === 'moon' && n === 9 && dow !== 0) {
        scheduleType = 'ANNUAL';
        note = '연차';
      }
      if (t.key === 'lim' && dow === 6) scheduleType = 'ON_CALL';
      rows.push({ technicianId: id, workDate: date, scheduleType, startTime: scheduleType === 'WORK' ? '09:00' : null, endTime: scheduleType === 'WORK' ? '18:00' : null, maxJobs: scheduleType === 'WORK' ? 5 : null, note });
    }
  }
  for (let i = 0; i < rows.length; i += 500) await db.insert(workSchedule).values(rows.slice(i, i + 500)).onConflictDoNothing();

  // 슬롯: 오늘부터 SLOT_DAYS_AHEAD(기본 14)일 — 슬롯 자동 생성 배치(F-SYS-01)와 같은 계산
  const setting = async (key: string, fallback: string) => (await db.select().from(systemSetting).where(eq(systemSetting.settingKey, key)))[0]?.settingValue ?? fallback;
  const days = Number(await setting('SLOT_DAYS_AHEAD', '14'));
  const defaults = {
    defaultStart: await setting('WORK_DEFAULT_START', '09:00'),
    defaultEnd: await setting('WORK_DEFAULT_END', '18:00'),
    jobsPerTechHour: Number(await setting('SLOT_JOBS_PER_TECH_HOUR', '1')),
  };
  const dates = Array.from({ length: days + 1 }, (_, i) => clock.day(i));
  for (const code of ['EP01', 'BD01']) {
    const branchId = c.branchId[code]!;
    const scheds = await db
      .select({ technicianId: workSchedule.technicianId, workDate: workSchedule.workDate, scheduleType: workSchedule.scheduleType, startTime: workSchedule.startTime, endTime: workSchedule.endTime })
      .from(workSchedule)
      .innerJoin(technician, eq(technician.id, workSchedule.technicianId))
      .where(and(eq(technician.branchId, branchId), eq(technician.status, 'ACTIVE'), isNull(technician.deletedAt), inArray(workSchedule.workDate, dates)));
    const plan = buildSlotPlan({ branchId, dates, schedules: scheds, ...defaults });
    if (plan.length) await db.insert(timeSlot).values(plan.map((p) => ({ ...p, bookedCount: 0, isClosed: false }))).onConflictDoNothing();
  }
  const slots = await db.select({ id: timeSlot.id, branchId: timeSlot.branchId, slotDate: timeSlot.slotDate, slotHour: timeSlot.slotHour }).from(timeSlot).where(and(inArray(timeSlot.slotDate, dates), eq(timeSlot.slotKind, 'NORMAL')));
  for (const s of slots) c.slotIds.set(`${s.branchId}|${s.slotDate}|${s.slotHour}`, s.id);
}

/* ====================================================================== */
/* 2. 주문 만들기 (견적 → 주문 → 배정 → 작업 → 결제 → 후기)                */
/* ====================================================================== */

interface OrderSpec {
  cust: CustKey;
  addr?: number;
  /** 오늘 기준 일 수 (음수 = 과거) */
  day: number;
  hour: number;
  minute?: number;
  lines: { deviceType: string; cleanLevel: string; quantity: number }[];
  options?: { code: string; qty: number }[];
  channel?: 'APP' | 'PHONE' | 'AS';
  orderType?: 'NORMAL' | 'URGENT' | 'AS';
  status: OrderStatus;
  tech?: TechKey;
  support?: TechKey;
  accompany?: TechKey;
  /** 배정 상태 (기본 ACCEPTED) */
  assign?: 'ACCEPTED' | 'TRANSFER_REQUESTED' | 'SELF_REQUESTED';
  assignMethod?: 'MANUAL' | 'AUTO' | 'SELF';
  /** 결제: PREPAY(선결제 카드) · CARD(현장 카드) · CASH(현금, 기사 수금) · TRANSFER(계좌이체, 기사 수금) · EASY(간편결제 후결제) · RECEIVABLE(미수) */
  pay?: 'PREPAY' | 'CARD' | 'CASH' | 'TRANSFER' | 'EASY' | 'RECEIVABLE' | 'NONE';
  coupon?: string;
  pendingReason?: string;
  cancelReason?: string;
  cancelFrom?: 'RECEIVED' | 'ASSIGNED';
  /** 동의된 현장 추가요금 */
  extras?: { rule: string; qty: number; reason: string }[];
  /** 자재 사용 */
  materials?: { code: string; qty: number; charge: boolean }[];
  review?: { rating: number; tags: string; content: string; reply?: string; hidden?: boolean; nps?: number };
  inspection?: 'APPROVED' | 'REJECTED' | 'NONE';
  dirt?: 'LOW' | 'MID' | 'HIGH';
  createdDaysBefore?: number;
  request?: string;
  note: string;
  parentOrderId?: number;
  free?: boolean;
  consultationId?: number;
}

interface MadeOrder {
  id: number;
  orderNo: string;
  customerId: number;
  branchId: number;
  addressId: number;
  workOrderId: number | null;
  totalAmount: number;
  extraAmount: number;
  promisedAt: Date;
  duration: number;
  units: number;
  techId: number | null;
  assignmentId: number | null;
  completedAt: Date | null;
  itemIds: { id: number; productId: number | null; quantity: number; itemType: string }[];
  spec: OrderSpec;
  cashCollected: number;
}

const PATHS: Record<string, OrderStatus[]> = {
  RECEIVED: ['RECEIVED'],
  ASSIGN_WAIT: ['RECEIVED', 'ASSIGN_WAIT'],
  ASSIGNED: ['RECEIVED', 'ASSIGNED'],
  ON_THE_WAY: ['RECEIVED', 'ASSIGNED', 'ON_THE_WAY'],
  IN_PROGRESS: ['RECEIVED', 'ASSIGNED', 'ON_THE_WAY', 'IN_PROGRESS'],
  PENDING: ['RECEIVED', 'ASSIGNED', 'ON_THE_WAY', 'PENDING'],
  WORK_DONE: ['RECEIVED', 'ASSIGNED', 'ON_THE_WAY', 'IN_PROGRESS', 'WORK_DONE'],
  COMPLETED: ['RECEIVED', 'ASSIGNED', 'ON_THE_WAY', 'IN_PROGRESS', 'WORK_DONE', 'COMPLETED'],
};

const WORK_PATHS: Record<string, string[]> = {
  ON_THE_WAY: ['READY', 'ON_THE_WAY'],
  IN_PROGRESS: ['READY', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS'],
  PENDING: ['READY', 'ON_THE_WAY', 'ARRIVED', 'PENDING'],
  WORK_DONE: ['READY', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS', 'DONE'],
  COMPLETED: ['READY', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS', 'DONE'],
};

async function notify(c: Ctx, code: string, to: { type: 'CUSTOMER' | 'TECHNICIAN' | 'ADMIN'; id: number | null; phone?: string }, related: { type: string; id: number } | null, at: Date, status: 'SENT' | 'FAILED' | 'FALLBACK_SMS' = 'SENT') {
  const tid = c.templateId[code];
  if (!tid) return;
  const isPush = to.type !== 'CUSTOMER';
  await c.db.insert(notificationLog).values({
    templateId: tid,
    receiverType: to.type,
    receiverId: to.id,
    receiverPhoneMasked: to.phone ? maskPhone(to.phone) : null,
    channel: isPush ? 'PUSH' : status === 'FALLBACK_SMS' ? 'SMS' : 'ALIMTALK',
    relatedType: related?.type ?? null,
    relatedId: related?.id ?? null,
    status,
    sentAt: status === 'FAILED' ? null : at,
    failReason: status === 'FAILED' ? '수신 거부(테스트)' : null,
    createdAt: at,
  });
}

async function makeOrder(c: Ctx, s: OrderSpec): Promise<MadeOrder> {
  const { db, clock } = c;
  const cu = c.cust[s.cust]!;
  const addressId = cu.addressIds[s.addr ?? 0] ?? cu.addressIds[0]!;
  const [addr] = await db.select().from(customerAddress).where(eq(customerAddress.id, addressId));
  const area = c.areaByCode.get(addr!.legalDongCode!)!;
  const branchId = area.branchId;
  const visitDate = clock.day(s.day);
  const promisedAt = clock.at(s.day, s.hour, s.minute ?? 0);
  const createdAt = addMin(clock.at(s.day - (s.createdDaysBefore ?? 3), 9 + (c.stat.orders % 9), (c.stat.orders * 7) % 60), 0);
  const createdAtSafe = createdAt > c.clock.now ? addMin(c.clock.now, -30 - c.stat.orders) : createdAt;

  // 공용 견적 모듈로 금액 계산 (BR-010~015)
  const calc = calculateQuote({
    area: { legalDongCode: addr!.legalDongCode, branchId, isServiceable: true, travelFee: area.travelFee },
    lines: s.lines,
    options: (s.options ?? []).map((x) => ({ optionId: c.optionId[x.code]!, quantity: x.qty })),
    customerType: cu.type,
    priceDate: visitDate,
    visit: { date: visitDate, time: `${pad(s.hour)}:${pad(s.minute ?? 0)}` },
    holidays: c.holidays,
    catalog: c.catalog,
    settings: { siteSurveyMinUnits: 4 },
  });
  if (!calc.ok) throw new Error(`가상 주문 견적 계산 실패: ${JSON.stringify(calc)}`);
  const free = Boolean(s.free);
  let items = calc.items.map((i) => ({ ...i }));
  let subtotal = calc.subtotalAmount;
  let discount = calc.discountAmount;
  let surcharge = calc.surchargeAmount;
  if (free) {
    // 보증 AS 재방문: 금액 0원 (revisitOrderItems 와 같은 결과)
    items = items.filter((i) => i.itemType === 'PRODUCT').map((i) => ({ ...i, unitPrice: 0, amount: 0 }));
    subtotal = 0;
    discount = 0;
    surcharge = 0;
  }
  let couponDiscount = 0;
  if (s.coupon && !free) {
    const cp = DEMO_COUPONS.find((x) => x.code === s.coupon)!;
    const base = subtotal - discount + surcharge;
    couponDiscount = cp.type === 'FIXED' ? cp.value : Math.min(Math.floor((base * cp.value) / 100), cp.max ?? Number.MAX_SAFE_INTEGER);
    items.push({ itemType: 'DISCOUNT', productId: null, optionId: null, surchargeRuleId: null, quantity: 1, unitPrice: -couponDiscount, amount: -couponDiscount, name: `쿠폰 ${cp.name}` } as never);
    discount += couponDiscount;
  }
  const units = s.lines.reduce((n, l) => n + l.quantity, 0);
  const duration = calc.estimatedDurationMin;

  // 견적 (CONVERTED, BR-014 스냅샷)
  const q = await one(
    db
      .insert(quote)
      .values({
        quoteNo: await newQuoteNo(c, createdAtSafe),
        customerId: cu.id,
        channel: s.channel === 'PHONE' ? 'PHONE' : s.channel === 'AS' ? 'AS' : 'APP',
        addressId,
        legalDongCode: addr!.legalDongCode!,
        branchId,
        isServiceable: true,
        subtotalAmount: calc.subtotalAmount,
        discountAmount: calc.discountAmount,
        surchargeAmount: calc.surchargeAmount,
        totalAmount: calc.totalAmount,
        estimatedDurationMin: duration,
        status: 'CONVERTED',
        expiresAt: new Date(createdAtSafe.getTime() + 7 * DAY_MS),
        priceSnapshotJson: calc.snapshot as QuoteSnapshot,
        createdAt: createdAtSafe,
        updatedAt: createdAtSafe,
        createdBy: cu.id,
      })
      .returning({ id: quote.id }),
  );
  await db.insert(quoteItem).values(calc.items.map((i) => ({ quoteId: q.id, itemType: i.itemType, productId: i.productId, optionId: i.optionId, surchargeRuleId: i.surchargeRuleId, quantity: i.quantity, unitPrice: i.unitPrice, amount: i.amount })));

  // 현장 추가요금(동의) 합계
  const extraRows = (s.extras ?? []).map((e) => {
    const rule = DEMO_SURCHARGES.find((r) => r.ruleCode === e.rule)!;
    return { ...e, title: rule.name, amount: rule.perUnit ? rule.amount * e.qty : rule.amount };
  });
  const matCharge = (s.materials ?? []).filter((m) => m.charge).map((m) => ({ ...m, mat: DEMO_MATERIALS.find((x) => x.code === m.code)! }));
  const workDone = ['WORK_DONE', 'COMPLETED'].includes(s.status);
  const extraAmount = workDone ? extraRows.reduce((n, e) => n + e.amount, 0) + matCharge.reduce((n, m) => n + m.mat.sale * m.qty, 0) : 0;
  const totalBase = Math.max(0, subtotal - discount + surcharge);
  const total = totalBase + extraAmount;

  const isPhone = s.channel === 'PHONE';
  const actor = (st: OrderStatus): { actorType: 'CUSTOMER' | 'TECHNICIAN' | 'ADMIN' | 'SYSTEM'; actorId: number | null } => {
    if (st === 'RECEIVED') return isPhone ? { actorType: 'ADMIN', actorId: adm(c, 'demo-cs') } : { actorType: 'CUSTOMER', actorId: cu.id };
    if (st === 'ASSIGNED' || st === 'ASSIGN_WAIT') return s.assignMethod === 'SELF' ? { actorType: 'ADMIN', actorId: adm(c, 'demo-ops') } : { actorType: 'ADMIN', actorId: adm(c, 'demo-ops') };
    if (st === 'COMPLETED') return { actorType: 'SYSTEM', actorId: null };
    if (st === 'CANCELED') return s.cancelReason === 'CUSTOMER_REQUEST' ? { actorType: 'CUSTOMER', actorId: cu.id } : { actorType: 'ADMIN', actorId: adm(c, 'demo-ops') };
    return { actorType: 'TECHNICIAN', actorId: s.tech ? c.techId[s.tech]! : null };
  };

  const path: OrderStatus[] = s.status === 'CANCELED' ? (s.cancelFrom === 'ASSIGNED' ? ['RECEIVED', 'ASSIGNED', 'CANCELED'] : ['RECEIVED', 'CANCELED']) : [...PATHS[s.status]!];

  // 시간표 (상태별 시각)
  const departAt = addMin(promisedAt, -35);
  const arriveAt = addMin(promisedAt, -2);
  const startAt = addMin(promisedAt, 5);
  const finishAt = addMin(startAt, duration);
  const assignedAt = addMin(createdAtSafe, 90);
  const timeOf = (st: OrderStatus): Date => {
    switch (st) {
      case 'RECEIVED':
        return createdAtSafe;
      case 'ASSIGNED':
      case 'ASSIGN_WAIT':
        return assignedAt;
      case 'ON_THE_WAY':
        return departAt;
      case 'IN_PROGRESS':
        return arriveAt;
      case 'PENDING':
        return addMin(promisedAt, 15);
      case 'WORK_DONE':
        return finishAt;
      case 'COMPLETED':
        return addMin(finishAt, 10);
      case 'CANCELED':
        return addMin(assignedAt, 600);
      default:
        return createdAtSafe;
    }
  };
  const clampNow = (d: Date) => (d > clock.now ? clock.now : d);

  const paid = (() => {
    if (s.pay === 'PREPAY') return total;
    if (s.status === 'COMPLETED') return total;
    return 0;
  })();
  const paymentStatus = (() => {
    if (s.status === 'CANCELED') return s.pay === 'PREPAY' ? 'REFUNDED' : 'UNPAID';
    if (s.status === 'COMPLETED') return 'PAID';
    if (s.pay === 'RECEIVABLE') return 'RECEIVABLE';
    if (s.pay === 'PREPAY') return 'PREPAID';
    return 'UNPAID';
  })();
  const completedAt = s.status === 'COMPLETED' ? timeOf('COMPLETED') : workDone ? finishAt : null;
  const hours = slotHoursFor(s.hour, duration);
  const visitType = items.find((i) => i.itemType === 'SURCHARGE' && (i as { ruleCode?: string }).ruleCode && ['NIGHT', 'HOLIDAY'].includes((i as { ruleCode?: string }).ruleCode!)) ? ((items.find((i) => ['NIGHT', 'HOLIDAY'].includes((i as { ruleCode?: string }).ruleCode ?? '')) as { ruleCode?: string }).ruleCode as string) : 'IN_HOURS';

  const ord = await one(
    db
      .insert(serviceOrder)
      .values({
        orderNo: await newOrderNo(c, createdAtSafe),
        customerId: cu.id,
        addressId,
        branchId,
        quoteId: q.id,
        consultationId: s.consultationId ?? null,
        parentOrderId: s.parentOrderId ?? null,
        channel: s.channel ?? 'APP',
        orderType: s.orderType ?? 'NORMAL',
        status: s.status,
        pendingReason: s.status === 'PENDING' ? (s.pendingReason ?? 'CUSTOMER_ABSENT') : null,
        cancelReason: s.status === 'CANCELED' ? (s.cancelReason ?? 'CUSTOMER_REQUEST') : null,
        requestedDate: visitDate,
        requestedTimeFrom: `${pad(s.hour)}:00`,
        requestedTimeTo: `${pad(s.hour + hours.length)}:00`,
        promisedAt,
        visitType,
        requiredTechCount: s.support ? 2 : 1,
        customerRequest: s.request ?? null,
        internalNote: s.note,
        subtotalAmount: subtotal,
        discountAmount: discount,
        surchargeAmount: surcharge,
        extraAmount,
        totalAmount: total,
        paidAmount: s.status === 'CANCELED' ? 0 : paid,
        paymentStatus,
        couponId: s.coupon ? c.couponId[s.coupon]! : null,
        isDuplicateChecked: true,
        completedAt,
        canceledAt: s.status === 'CANCELED' ? timeOf('CANCELED') : null,
        createdAt: createdAtSafe,
        createdBy: isPhone ? adm(c, 'demo-cs') : cu.id,
        updatedAt: clampNow(timeOf(s.status)),
      })
      .returning({ id: serviceOrder.id, orderNo: serviceOrder.orderNo }),
  );
  c.stat.orders++;
  const itemRows = await db
    .insert(orderItem)
    .values(
      items.map((i) => ({
        orderId: ord.id,
        itemType: i.itemType,
        productId: i.productId,
        optionId: i.optionId,
        surchargeRuleId: i.surchargeRuleId,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        amount: i.amount,
        itemStatus: workDone && i.itemType === 'PRODUCT' ? 'DONE' : 'PLANNED',
      })),
    )
    .returning({ id: orderItem.id, productId: orderItem.productId, quantity: orderItem.quantity, itemType: orderItem.itemType });
  if (s.coupon && !free) {
    await db.insert(customerCoupon).values({ couponId: c.couponId[s.coupon]!, customerId: cu.id, status: 'USED', usedOrderId: ord.id, issuedAt: addMin(createdAtSafe, -60 * 24 * 5), usedAt: createdAtSafe }).onConflictDoNothing();
  }

  // 상태 이력 (전이 함수로 검증하며 1행씩)
  let prev: OrderStatus | null = null;
  for (const st of path) {
    const a = actor(st);
    await db.insert(orderStatusHistory).values({
      ...orderStatusHistoryRow({
        orderId: ord.id,
        from: prev,
        to: st,
        actorType: a.actorType,
        actorId: a.actorId,
        reasonCode: st === 'PENDING' ? (s.pendingReason ?? 'CUSTOMER_ABSENT') : st === 'CANCELED' ? (s.cancelReason ?? 'CUSTOMER_REQUEST') : null,
        memo: st === 'COMPLETED' ? '결제 완료' : st === 'PENDING' ? '재약속 희망: 고객과 통화 후 결정' : null,
      }),
      createdAt: clampNow(timeOf(st)),
    });
    prev = st;
  }

  // 슬롯 차감 (BR-021) — 살아 있는 미래 주문만
  if (s.status !== 'CANCELED' && s.day >= 0) {
    for (const h of hours) {
      await db
        .update(timeSlot)
        .set({ bookedCount: sql`${timeSlot.bookedCount} + 1`, capacity: sql`greatest(${timeSlot.capacity}, ${timeSlot.bookedCount} + 1)` })
        .where(and(eq(timeSlot.branchId, branchId), eq(timeSlot.slotDate, visitDate), eq(timeSlot.slotHour, h), eq(timeSlot.slotKind, 'NORMAL')));
    }
  }

  // 알림 이력 (고객)
  await notify(c, 'ORDER_CONFIRMED', { type: 'CUSTOMER', id: cu.id, phone: cu.phone }, { type: 'ORDER', id: ord.id }, addMin(createdAtSafe, 1));

  // 배정
  const techId = s.tech ? c.techId[s.tech]! : null;
  let assignmentId: number | null = null;
  const reachedAssigned = path.includes('ASSIGNED') || (s.assign === 'SELF_REQUESTED' && techId);
  if (techId && reachedAssigned) {
    const method = s.assignMethod ?? (s.assign === 'SELF_REQUESTED' ? 'SELF' : 'MANUAL');
    let status: string = 'ACCEPTED';
    if (s.assign === 'SELF_REQUESTED') status = 'REQUESTED';
    if (s.status === 'CANCELED') status = 'CANCELED';
    if (status === 'CANCELED') assertAssignTransition('ACCEPTED', 'CANCELED');
    if (s.assign === 'TRANSFER_REQUESTED') {
      assertAssignTransition('ACCEPTED', 'TRANSFER_REQUESTED');
      status = 'TRANSFER_REQUESTED';
    }
    const a = await one(
      db
        .insert(assignment)
        .values({
          orderId: ord.id,
          technicianId: techId,
          role: 'MAIN',
          timeSlotId: c.slotIds.get(`${branchId}|${visitDate}|${s.hour}`) ?? null,
          scheduledStart: promisedAt,
          scheduledEnd: addMin(promisedAt, duration),
          assignMethod: method,
          status,
          inZone: true,
          rejectReason: s.assign === 'TRANSFER_REQUESTED' ? '차량 정비로 오후 방문이 어렵습니다.' : null,
          assignedBy: method === 'SELF' ? null : adm(c, 'demo-ops'),
          acceptedAt: status === 'REQUESTED' ? null : assignedAt,
          createdAt: assignedAt,
          createdBy: method === 'SELF' ? techId : adm(c, 'demo-ops'),
        })
        .returning({ id: assignment.id }),
    );
    assignmentId = a.id;
    if (s.assign === 'SELF_REQUESTED') {
      await db.insert(assignmentHistory).values({ orderId: ord.id, toTechnicianId: techId, action: 'SELF_REQUEST', reason: '관할 지도에서 작업 담기', actorType: 'TECHNICIAN', actorId: techId, createdAt: assignedAt });
    } else {
      await db.insert(assignmentHistory).values({ orderId: ord.id, toTechnicianId: techId, action: 'ASSIGN', actorType: 'ADMIN', actorId: adm(c, 'demo-ops'), createdAt: assignedAt });
      await notify(c, 'TECH_JOB_ASSIGNED', { type: 'TECHNICIAN', id: techId }, { type: 'ORDER', id: ord.id }, assignedAt);
      await notify(c, 'TECH_ASSIGNED', { type: 'CUSTOMER', id: cu.id, phone: cu.phone }, { type: 'ORDER', id: ord.id }, addMin(assignedAt, 1));
      if (s.assign === 'TRANSFER_REQUESTED') {
        await db.insert(assignmentHistory).values({ orderId: ord.id, fromTechnicianId: techId, action: 'TRANSFER_REQUEST', reason: '차량 정비로 오후 방문이 어렵습니다.', actorType: 'TECHNICIAN', actorId: techId, createdAt: clampNow(addMin(promisedAt, -180)) });
      }
      if (s.status === 'CANCELED') {
        await db.insert(assignmentHistory).values({ orderId: ord.id, fromTechnicianId: techId, action: 'UNASSIGN', reason: '주문 취소', actorType: 'ADMIN', actorId: adm(c, 'demo-ops'), createdAt: timeOf('CANCELED') });
      }
    }
    for (const [k, r] of [[s.support, 'SUPPORT'], [s.accompany, 'ACCOMPANY']] as const) {
      if (!k) continue;
      const sid = c.techId[k]!;
      await db.insert(assignment).values({ orderId: ord.id, technicianId: sid, role: r, scheduledStart: promisedAt, scheduledEnd: addMin(promisedAt, duration), assignMethod: 'MANUAL', status: 'ACCEPTED', assignedBy: adm(c, 'demo-ops'), acceptedAt: assignedAt, createdAt: assignedAt });
      await db.insert(assignmentHistory).values({ orderId: ord.id, toTechnicianId: sid, action: 'ASSIGN', reason: r === 'SUPPORT' ? '2인 작업 지원' : '교육 동행', actorType: 'ADMIN', actorId: adm(c, 'demo-ops'), createdAt: assignedAt });
    }
  }

  // 작업 (현장)
  let workOrderId: number | null = null;
  let cashCollected = 0;
  const wpath = WORK_PATHS[s.status];
  if (wpath && techId) {
    let wprev: string | null = null;
    for (const w of wpath) {
      assertWorkTransition(wprev, w as never);
      wprev = w;
    }
    const done = workDone;
    const started = ['IN_PROGRESS', 'WORK_DONE', 'COMPLETED'].includes(s.status);
    const arrived = started || s.status === 'PENDING';
    const inspection = done ? (s.inspection ?? 'APPROVED') : 'NONE';
    if (inspection !== 'NONE') assertInspectionTransition(null, inspection);
    const cashLike = s.pay === 'CASH' || s.pay === 'TRANSFER';
    if (s.status === 'COMPLETED' && cashLike) cashCollected = total;
    const w = await one(
      db
        .insert(workOrder)
        .values({
          orderId: ord.id,
          mainTechnicianId: techId,
          status: wprev!,
          departedAt: departAt,
          arrivedAt: arrived ? arriveAt : null,
          startedAt: started ? startAt : null,
          finishedAt: done ? finishAt : null,
          workMinutes: done ? duration : null,
          resultCode: done ? 'DONE_NORMAL' : null,
          pendingCode: s.status === 'PENDING' ? (s.pendingReason ?? 'CUSTOMER_ABSENT') : null,
          dirtLevel: started ? (s.dirt ?? 'MID') : null,
          workNote: done ? '열교환기·송풍팬 완전분해 세척 완료. 배수 정상 확인했습니다.' : s.status === 'PENDING' ? '도착 후 30분 대기, 고객 연락 두절' : null,
          internalNote: s.dirt === 'HIGH' ? '곰팡이 심함 — 다음 방문 시 항균 코팅 권장' : null,
          issueFound: s.dirt === 'HIGH' ? '드레인판 곰팡이 다량' : null,
          highPlaceWork: started ? s.lines.some((l) => l.deviceType.startsWith('CEILING') || l.deviceType === 'SYSTEM') : null,
          safetyChecklistDone: started,
          laborAmount: done ? totalBase : null,
          extraAmount,
          materialAmount: (s.materials ?? []).reduce((n, m) => n + DEMO_MATERIALS.find((x) => x.code === m.code)!.cost * m.qty, 0),
          discountAmount: discount,
          finalAmount: done ? total : null,
          receivedAmount: cashCollected,
          isSettlementTarget: s.status === 'COMPLETED' && inspection !== 'REJECTED',
          inspectionStatus: inspection === 'NONE' ? null : inspection,
          inspectionNote: inspection === 'REJECTED' ? '작업 후 사진에 열교환기 오염이 남아 있습니다. 재작업 바랍니다.' : null,
          inspectedBy: inspection === 'NONE' ? null : adm(c, 'demo-ops'),
          inspectedAt: inspection === 'NONE' ? null : clampNow(addMin(finishAt, 60 * 20)),
          createdAt: departAt,
          createdBy: techId,
          updatedAt: clampNow(done ? finishAt : timeOf(s.status)),
        })
        .returning({ id: workOrder.id }),
    );
    workOrderId = w.id;
    await notify(c, 'ON_THE_WAY', { type: 'CUSTOMER', id: cu.id, phone: cu.phone }, { type: 'ORDER', id: ord.id }, departAt);
    await db.insert(activityLog).values({ orderId: ord.id, actorType: 'TECHNICIAN', actorId: techId, activityType: 'CALL', content: '출발 전 고객 통화: 방문 시간 안내', createdAt: addMin(departAt, -5) });
    if (s.status === 'PENDING') {
      await db.insert(activityLog).values([
        { orderId: ord.id, actorType: 'TECHNICIAN', actorId: techId, activityType: 'VISIT_TRY', content: '현관 벨 3회, 30분 대기 후 철수', createdAt: addMin(promisedAt, 10) },
        { orderId: ord.id, actorType: 'TECHNICIAN', actorId: techId, activityType: 'SMS', content: '부재 안내 문자 발송', createdAt: addMin(promisedAt, 14) },
      ]);
      await notify(c, 'PENDING_ABSENT', { type: 'CUSTOMER', id: cu.id, phone: cu.phone }, { type: 'ORDER', id: ord.id }, addMin(promisedAt, 15));
    }
    // 기기별 결과·사진 (BR-041 전·후 사진)
    if (started) {
      let unitIndex = 0;
      for (const it of itemRows.filter((i) => i.itemType === 'PRODUCT')) {
        for (let u = 1; u <= it.quantity; u++) {
          unitIndex++;
          let deviceId: number | null = null;
          const product = [...c.productByType.values()].find((p) => p.id === it.productId)!;
          if (done) {
            // 같은 주소·형태의 보유 기기가 있으면 이어서 쓴다(작업 완료 때 기기 자동 연결과 같은 결과)
            const owned = await db
              .select({ id: customerDevice.id, lastCleanedAt: customerDevice.lastCleanedAt })
              .from(customerDevice)
              .where(and(eq(customerDevice.customerId, cu.id), eq(customerDevice.addressId, addressId), eq(customerDevice.deviceType, product.deviceType), isNull(customerDevice.deletedAt)))
              .orderBy(customerDevice.id);
            const reuse = owned[u - 1];
            if (reuse) {
              deviceId = reuse.id;
              if (!reuse.lastCleanedAt || reuse.lastCleanedAt < kstDateOf(finishAt)) {
                await db.update(customerDevice).set({ lastCleanedAt: kstDateOf(finishAt), lastCleanLevel: product.cleanLevel, recommendMonths: 12, updatedAt: finishAt, updatedBy: techId }).where(eq(customerDevice.id, reuse.id));
              }
            }
          }
          if (done && !deviceId) {
            const d = await one(
              db
                .insert(customerDevice)
                .values({
                  customerId: cu.id,
                  addressId,
                  deviceType: product.deviceType,
                  brand: ['SAMSUNG', 'LG', 'CARRIER', 'WINIA'][unitIndex % 4]!,
                  modelName: `TEST-${product.deviceType}-${100 + unitIndex}`,
                  installYear: 2018 + (unitIndex % 6),
                  locationInHouse: ['거실', '안방', '작은방', '사무실'][unitIndex % 4]!,
                  isInverter: unitIndex % 2 === 0,
                  hasHeating: product.deviceType === 'STAND',
                  lastCleanedAt: kstDateOf(finishAt),
                  lastCleanLevel: product.cleanLevel,
                  recommendMonths: 12,
                  createdAt: finishAt,
                  createdBy: techId,
                })
                .returning({ id: customerDevice.id }),
            );
            deviceId = d.id;
          }
          if (done) {
            await db.insert(workResult).values({ workOrderId: w.id, orderItemId: it.id, unitNo: u, customerDeviceId: deviceId, result: 'DONE', conditionNote: s.dirt === 'HIGH' ? '곰팡이 심함, 세척 후 양호' : '양호', recommendNext: 12, createdAt: finishAt, createdBy: techId });
          }
          for (const photoType of done ? (['BEFORE', 'AFTER'] as const) : (['BEFORE'] as const)) {
            const at = photoType === 'BEFORE' ? addMin(startAt, 3) : addMin(finishAt, -3);
            const fileId = await newAttachment(c, photoType === 'BEFORE' ? 'before' : 'after', 'WORK_PHOTO', w.id, { type: 'TECHNICIAN', id: techId }, at);
            await db.insert(workPhoto).values({ workOrderId: w.id, orderItemId: it.id, unitNo: u, customerDeviceId: deviceId, photoType, fileId, takenAt: at, marketingAgree: s.cust === 'hong', createdAt: at, createdBy: techId });
          }
        }
      }
    }
    // 현장 추가요금 (동의 완료분)
    if (done) {
      for (const e of extraRows) {
        const ev = await newAttachment(c, 'issue', 'EXTRA_CHARGE', null, { type: 'TECHNICIAN', id: techId }, addMin(startAt, 10));
        await db.insert(extraCharge).values({ workOrderId: w.id, surchargeRuleId: c.ruleId[e.rule]!, chargeType: 'RULE', title: e.title, quantity: e.qty, amount: e.amount, reason: e.reason, evidenceFileId: ev, customerAgreed: true, agreedMethod: 'APP_CONFIRM', agreedAt: addMin(startAt, 15), approvalStatus: 'NOT_REQUIRED', createdAt: addMin(startAt, 10), createdBy: techId });
        await notify(c, 'EXTRA_CHARGE_REQUEST', { type: 'CUSTOMER', id: cu.id, phone: cu.phone }, { type: 'ORDER', id: ord.id }, addMin(startAt, 11));
      }
      for (const m of s.materials ?? []) {
        const mat = DEMO_MATERIALS.find((x) => x.code === m.code)!;
        let extraId: number | null = null;
        if (m.charge) {
          const ex = await one(
            db
              .insert(extraCharge)
              .values({ workOrderId: w.id, chargeType: 'MATERIAL', title: mat.name, quantity: m.qty, amount: mat.sale * m.qty, reason: '고객 요청으로 교체', customerAgreed: true, agreedMethod: 'SIGNATURE', agreedAt: addMin(startAt, 20), signatureFileId: await newAttachment(c, 'signature', 'EXTRA_CHARGE', null, { type: 'TECHNICIAN', id: techId }, addMin(startAt, 20)), approvalStatus: 'NOT_REQUIRED', createdAt: addMin(startAt, 18), createdBy: techId })
              .returning({ id: extraCharge.id }),
          );
          extraId = ex.id;
        }
        await db.insert(materialUsage).values({ workOrderId: w.id, materialId: c.materialId[m.code]!, quantity: m.qty, unitCost: mat.cost, chargeToCustomer: m.charge, saleAmount: m.charge ? mat.sale * m.qty : 0, extraChargeId: extraId, createdAt: finishAt, createdBy: techId });
      }
      // 고객 서명
      const sig = await newAttachment(c, 'signature', 'SIGNATURE', w.id, { type: 'TECHNICIAN', id: techId }, finishAt);
      await db.update(workOrder).set({ customerSignatureFileId: sig }).where(eq(workOrder.id, w.id));
      await notify(c, 'WORK_DONE', { type: 'CUSTOMER', id: cu.id, phone: cu.phone }, { type: 'ORDER', id: ord.id }, addMin(finishAt, 1));
    }
  }

  // 결제
  const pgPay = async (stage: string, method: string, amount: number, at: Date, ok = true) =>
    one(
      db
        .insert(payment)
        .values((() => {
          const no = newPaymentNo(at);
          return {
            paymentNo: no,
            orderId: ord.id,
            customerId: cu.id,
            paymentStage: stage,
            method,
            amount,
            status: ok ? 'APPROVED' : 'FAILED',
            pgProvider: ['CASH', 'BANK_TRANSFER'].includes(method) ? null : 'MOCK',
            pgTid: ['CASH', 'BANK_TRANSFER'].includes(method) ? null : `mock-${no}`,
            approvedAt: ok ? at : null,
            failReason: ok ? null : '카드 한도 초과(테스트)',
            collectedByTechId: ['CASH', 'BANK_TRANSFER'].includes(method) ? techId : null,
            createdAt: at,
            createdBy: ['CASH', 'BANK_TRANSFER'].includes(method) ? techId : cu.id,
          };
        })())
        .returning({ id: payment.id }),
    );
  let paymentId: number | null = null;
  if (s.pay === 'PREPAY') {
    paymentId = (await pgPay('PREPAY', 'CARD', totalBase, addMin(createdAtSafe, 3))).id;
    if (extraAmount > 0 && s.status === 'COMPLETED') await pgPay('ONSITE', 'ONSITE_CARD', extraAmount, addMin(finishAt, 5));
    if (s.status === 'CANCELED') {
      await db.insert(refund).values({ paymentId, amount: totalBase, reasonCode: 'CUSTOMER_CANCEL', reasonDetail: '고객 앱 취소', cancelFee: 0, status: 'DONE', pgCancelTid: `mock-cancel-${paymentId}`, requestedBy: 'CUSTOMER', refundedAt: timeOf('CANCELED'), createdAt: timeOf('CANCELED') });
    }
  } else if (s.status === 'COMPLETED') {
    const at = addMin(finishAt, 5);
    if (s.pay === 'CASH') paymentId = (await pgPay('ONSITE', 'CASH', total, at)).id;
    else if (s.pay === 'TRANSFER') paymentId = (await pgPay('ONSITE', 'BANK_TRANSFER', total, at)).id;
    else if (s.pay === 'EASY') {
      await pgPay('POSTPAY', 'EASY_PAY', total, addMin(at, -2), false);
      paymentId = (await pgPay('POSTPAY', 'EASY_PAY', total, at)).id;
    } else paymentId = (await pgPay('ONSITE', 'ONSITE_CARD', total, at)).id;
    await notify(c, 'PAYMENT_DONE', { type: 'CUSTOMER', id: cu.id, phone: cu.phone }, { type: 'ORDER', id: ord.id }, addMin(at, 1));
  } else if (s.status === 'WORK_DONE') {
    await notify(c, 'PAYMENT_REQUEST', { type: 'CUSTOMER', id: cu.id, phone: cu.phone }, { type: 'ORDER', id: ord.id }, addMin(finishAt, 2));
  }
  // 증빙 (현금 → 현금영수증 발행, 사업자 → 세금계산서 요청)
  if (paymentId && s.status === 'COMPLETED') {
    if (s.pay === 'CASH' || s.pay === 'TRANSFER') {
      assertTaxDocTransition('REQUESTED', 'ISSUED');
      await db.insert(taxDocument).values({ paymentId, docType: 'CASH_RECEIPT_INCOME', identityNo: c.enc(cu.phone), supplyAmount: Math.round(total / 1.1), vatAmount: total - Math.round(total / 1.1), totalAmount: total, issueStatus: 'ISSUED', issuedNo: `TEST${ord.id}${pad(c.stat.orders, 4)}`, issuedAt: addMin(finishAt, 6), requestedBy: 'TECHNICIAN', createdAt: addMin(finishAt, 6), createdBy: techId });
    }
    if (cu.type === 'BUSINESS') {
      await db.insert(taxDocument).values({ paymentId, docType: 'TAX_INVOICE', identityNo: c.enc('0000000000'), supplyAmount: Math.round(total / 1.1), vatAmount: total - Math.round(total / 1.1), totalAmount: total, issueStatus: 'REQUESTED', requestedBy: 'CUSTOMER', createdAt: addMin(finishAt, 60), createdBy: cu.id });
    }
  }

  // 후기 (BR-090)
  if (s.review && s.status === 'COMPLETED' && techId) {
    const at = addMin(finishAt, 60 * 5);
    await notify(c, 'REVIEW_REQUEST', { type: 'CUSTOMER', id: cu.id, phone: cu.phone }, { type: 'ORDER', id: ord.id }, addMin(finishAt, 120));
    await db.insert(review).values({ orderId: ord.id, customerId: cu.id, technicianId: techId, branchId, rating: s.review.rating, npsScore: s.review.nps ?? (s.review.rating >= 4 ? 9 : 4), tags: s.review.tags, content: s.review.content, isPublic: !s.review.hidden, adminReply: s.review.reply ?? null, repliedAt: s.review.reply ? addMin(at, 60 * 24) : null, isHidden: Boolean(s.review.hidden), createdAt: at, createdBy: cu.id });
  }

  return {
    id: ord.id,
    orderNo: ord.orderNo,
    customerId: cu.id,
    branchId,
    addressId,
    workOrderId,
    totalAmount: total,
    extraAmount,
    promisedAt,
    duration,
    units,
    techId,
    assignmentId,
    completedAt,
    itemIds: itemRows,
    spec: s,
    cashCollected,
  };
}

/* ====================================================================== */
/* 3. 지난 이력                                                            */
/* ====================================================================== */

async function seedHistory(c: Ctx) {
  const { db, clock } = c;
  const W = (n: number) => clock.workday(n);
  const note = (s: string) => `${DEMO_TAG} ${s}`;
  const wall = (q = 1, lvl: 'BASIC' | 'FULL' = 'FULL') => ({ deviceType: 'WALL', cleanLevel: lvl, quantity: q });
  const stand = (q = 1, lvl: 'BASIC' | 'FULL' = 'FULL') => ({ deviceType: 'STAND', cleanLevel: lvl, quantity: q });

  /* ---- 완료 주문 (지난 5주) ---- */
  const done: MadeOrder[] = [];
  const P = async (s: OrderSpec) => {
    const m = await makeOrder(c, s);
    done.push(m);
    return m;
  };
  const hongOld = await P({ cust: 'hong', day: W(-33), hour: 10, lines: [wall(2), stand(1)], status: 'COMPLETED', tech: 'kang', pay: 'PREPAY', review: { rating: 5, tags: 'KIND,CAREFUL,EXPLAIN', content: '세 대 모두 꼼꼼하게 분해 세척해 주셨어요. 냄새가 싹 사라졌습니다.', reply: '소중한 후기 감사합니다. 다음에도 꼼꼼히 관리해 드릴게요!' }, note: note('완료 · 선결제 · 5점 후기(답글)') });
  await P({ cust: 'kim', day: W(-31), hour: 13, lines: [wall(1)], status: 'COMPLETED', tech: 'seo', pay: 'CARD', review: { rating: 4, tags: 'ON_TIME,TIDY', content: '시간 맞춰 와 주셨고 깔끔했어요.' }, note: note('완료 · 현장 카드') });
  await P({ cust: 'park', day: W(-29), hour: 10, lines: [{ deviceType: 'CEILING_4WAY', cleanLevel: 'FULL', quantity: 3 }], status: 'COMPLETED', tech: 'kang', pay: 'TRANSFER', extras: [{ rule: 'HIGH_PLACE', qty: 3, reason: '천장고 3m, 사다리 작업' }], channel: 'PHONE', note: note('완료 · 사업자 천장형 3대 · 계좌이체(기사 수금) · 고소작업 추가요금 · 세금계산서 요청') });
  await P({ cust: 'yim', day: W(-28), hour: 11, lines: [stand(1), wall(1)], status: 'COMPLETED', tech: 'jang', pay: 'PREPAY', review: { rating: 5, tags: 'KIND,EXPLAIN', content: '설명을 자세히 해 주셔서 좋았습니다.' }, note: note('분당 · 완료') });
  await P({ cust: 'jung', day: W(-26), hour: 15, lines: [wall(1, 'BASIC')], status: 'COMPLETED', tech: 'moon', pay: 'CASH', note: note('완료 · 현금(기사 수금) · 현금영수증') });
  await P({ cust: 'han', day: W(-24), hour: 9, lines: [{ deviceType: 'TWO_IN_ONE', cleanLevel: 'FULL', quantity: 1 }], options: [{ code: 'OPT-ANTIBAC', qty: 2 }], status: 'COMPLETED', tech: 'seo', pay: 'EASY', review: { rating: 4, tags: 'CAREFUL', content: '2in1 세트 세척 만족합니다.' }, note: note('완료 · 간편결제(1회 실패 후 성공) · 항균 옵션') });
  await P({ cust: 'jo', day: W(-22), hour: 10, lines: [{ deviceType: 'SYSTEM', cleanLevel: 'FULL', quantity: 2 }], status: 'COMPLETED', tech: 'jang', support: 'lim', pay: 'CARD', review: { rating: 5, tags: 'KIND,TIDY', content: '두 분이 오셔서 빠르게 끝났어요.' }, note: note('분당 · 시스템 에어컨 2인 작업(지원 기사)') });
  await P({ cust: 'song', day: W(-20), hour: 14, lines: [wall(1)], status: 'COMPLETED', tech: 'moon', pay: 'CARD', dirt: 'HIGH', extras: [{ rule: 'HEAVY_DIRT', qty: 1, reason: '열교환기 곰팡이 심함(사진 첨부)' }], note: note('완료 · 오염 심함 추가요금') });
  const hong2 = await P({ cust: 'hong', addr: 1, day: W(-19), hour: 10, lines: [wall(1)], status: 'COMPLETED', tech: 'kang', accompany: 'shin', pay: 'PREPAY', coupon: 'REVISIT7000', materials: [{ code: 'M-FILTER', qty: 1, charge: true }, { code: 'M-CLEANER', qty: 1, charge: false }], review: { rating: 5, tags: 'KIND,ON_TIME', content: '부모님 댁도 잘 해 주셨어요. 필터도 새로 바꿨습니다.' }, note: note('완료 · 쿠폰 사용 · 필터 교체(자재 청구) · 견습 동행') });
  await P({ cust: 'seo', day: W(-17), hour: 11, lines: [stand(1)], status: 'COMPLETED', tech: 'seo', pay: 'CARD', note: note('완료 · 이후 AS 요청 대상') });
  await P({ cust: 'kim', day: W(-15), hour: 16, lines: [wall(1, 'BASIC')], status: 'COMPLETED', tech: 'kang', pay: 'CASH', review: { rating: 4, tags: 'ON_TIME', content: '빠르고 좋았어요.' }, note: note('완료 · 현금') });
  const jungLow = await P({ cust: 'jung', day: W(-13), hour: 10, lines: [stand(1, 'BASIC')], status: 'COMPLETED', tech: 'seo', pay: 'CARD', review: { rating: 2, tags: 'LATE,ROUGH', content: '약속 시간보다 40분 늦게 오셨고 바닥에 물이 떨어졌어요.', nps: 3 }, note: note('완료 · 2점 후기 → VOC 자동 생성') });
  await P({ cust: 'yim', day: W(-12), hour: 14, lines: [wall(2)], status: 'COMPLETED', tech: 'lim', pay: 'CARD', note: note('분당 · 완료') });
  await P({ cust: 'park', day: W(-11), hour: 10, lines: [{ deviceType: 'CEILING_1WAY', cleanLevel: 'FULL', quantity: 2 }], status: 'COMPLETED', tech: 'kang', pay: 'CARD', channel: 'PHONE', review: { rating: 5, tags: 'EXPLAIN,TIDY', content: '사무실 영업에 지장 없이 진행해 주셨습니다.' }, note: note('완료 · 사업자 천장형 1way') });
  await P({ cust: 'han', day: W(-9), hour: 13, lines: [wall(1)], status: 'COMPLETED', tech: 'moon', pay: 'CARD', inspection: 'REJECTED', note: note('완료 · 검수 반려(재작업 요청, 정산 제외)') });
  await P({ cust: 'oh', day: W(-8), hour: 10, lines: [wall(1), { deviceType: 'WINDOW', cleanLevel: 'BASIC', quantity: 1 }], status: 'COMPLETED', tech: 'moon', pay: 'CARD', extras: [{ rule: 'NO_PARKING', qty: 1, reason: '골목 주차 불가, 유료 주차' }], note: note('완료 · 주차 불가 추가요금 · 이후 안전사고 접수') });
  await P({ cust: 'song', day: W(-6), hour: 15, lines: [stand(1)], status: 'COMPLETED', tech: 'kang', pay: 'PREPAY', review: { rating: 5, tags: 'KIND', content: '친절하셨어요.', hidden: false }, note: note('완료') });
  await P({ cust: 'lee', day: W(-5), hour: 10, lines: [wall(1)], status: 'COMPLETED', tech: 'seo', pay: 'CASH', channel: 'PHONE', note: note('전화 접수 · 완료 · 현금') });
  await P({ cust: 'jo', day: W(-4), hour: 11, lines: [wall(1, 'BASIC')], status: 'COMPLETED', tech: 'lim', pay: 'CARD', inspection: 'NONE', note: note('분당 · 완료 · 검수 대기') });
  await P({ cust: 'kim', day: W(-3), hour: 14, lines: [{ deviceType: 'WALL', cleanLevel: 'OUTDOOR', quantity: 1 }], status: 'COMPLETED', tech: 'kang', pay: 'CARD', inspection: 'NONE', note: note('완료 · 실외기 세척 · 검수 대기') });
  await P({ cust: 'hong', day: W(-2), hour: 10, lines: [stand(1, 'BASIC')], status: 'COMPLETED', tech: 'seo', pay: 'CARD', inspection: 'NONE', review: { rating: 4, tags: 'TIDY', content: '깔끔했어요.' }, note: note('완료 · 검수 대기') });

  /* ---- 그 밖의 지난 주문 상태 ---- */
  // 미수금: 작업완료 후 미결제 (RECEIVABLE) → 미수금 관리 · 기사 미수 메모
  const recv = await makeOrder(c, { cust: 'oh', day: W(-10), hour: 15, lines: [wall(1)], status: 'WORK_DONE', tech: 'seo', pay: 'RECEIVABLE', note: note('작업완료 · 미수금(고객 결제 미루는 중)') });
  // 장기 미처리: 3일 전 고객 연기 (PENDING 48시간 경과 → overdue48h)
  await makeOrder(c, { cust: 'lee', day: W(-3), hour: 11, lines: [stand(1)], status: 'PENDING', tech: 'moon', pendingReason: 'POSTPONED_CUSTOMER', channel: 'PHONE', note: note('미처리(고객 연기) · 48시간 경과') });
  // 취소: 선결제 후 고객 취소(환불 완료) / 기사 부족으로 운영 취소
  await makeOrder(c, { cust: 'seo', day: W(-14), hour: 10, lines: [wall(1)], status: 'CANCELED', cancelReason: 'CUSTOMER_REQUEST', pay: 'PREPAY', note: note('고객 취소 · 선결제 환불 완료') });
  await makeOrder(c, { cust: 'han', day: W(-7), hour: 17, lines: [stand(1)], status: 'CANCELED', cancelFrom: 'ASSIGNED', tech: 'seo', cancelReason: 'NO_TECH', note: note('운영 취소(기사 부족) · 배정 취소') });

  /* ---- 결제 대기 미수 메모 (단계 6 [미수금] 메모) ---- */
  await db.insert(memo).values([
    { ownerType: 'TECHNICIAN', ownerId: c.techId.seo!, headerCode: 'RECEIVABLE', content: `[미수금] ${recv.orderNo} 고객이 다음 주 입금 약속`, relatedOrderId: recv.id, startDate: clock.day(-9), endDate: clock.day(3), prioritySource: 'SELF', createdBy: c.techId.seo! },
    { ownerType: 'ADMIN', ownerId: adm(c, 'demo-fin') ?? 0, headerCode: 'RECEIVABLE', content: `[미수금] ${recv.orderNo} 독촉 문자 2회 발송`, relatedOrderId: recv.id, startDate: clock.day(-5), endDate: clock.day(2), prioritySource: 'ADMIN', createdBy: adm(c, 'demo-fin') },
  ]);

  /* ---- 상담·통화 (상담 콘솔) ---- */
  const consult = async (v: { cust: CustKey | null; phone: string; channel?: string; type: string; sub?: string | null; status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'TRANSFERRED'; content: string; daysAgo: number; order?: number | null; reply?: string; agent?: string }) => {
    const at = clock.at(-v.daysAgo, 10 + (v.daysAgo % 7), 15);
    const cu = v.cust ? c.cust[v.cust]! : null;
    let callId: number | null = null;
    if ((v.channel ?? 'PHONE') === 'PHONE') {
      const call = await one(
        db
          .insert(callLog)
          .values({ direction: 'INBOUND', callerPhone: c.enc(v.phone), callerPhoneHash: c.ph(v.phone), customerId: cu?.id ?? null, agentAdminId: adm(c, v.agent ?? 'demo-cs'), ivrPath: '1-2', waitSeconds: 25 + v.daysAgo, startedAt: at, endedAt: addMin(at, 6), createdAt: at, createdBy: adm(c, v.agent ?? 'demo-cs') })
          .returning({ id: callLog.id }),
      );
      callId = call.id;
    }
    assertConsultTransition(null, v.status === 'DONE' ? 'DONE' : 'OPEN');
    if (v.status === 'IN_PROGRESS' || v.status === 'TRANSFERRED') assertConsultTransition('OPEN', v.status);
    const row = await one(
      db
        .insert(consultation)
        .values({
          consultNo: await newConsultNo(c, at),
          customerId: cu?.id ?? null,
          callLogId: callId,
          channel: v.channel ?? 'PHONE',
          consultType: v.type,
          subType: v.sub ?? null,
          relatedOrderId: v.order ?? null,
          content: v.content,
          status: v.status,
          agentAdminId: (v.channel ?? 'PHONE') === 'PHONE' ? adm(c, v.agent ?? 'demo-cs') : null,
          completedAt: v.status === 'DONE' ? addMin(at, 8) : null,
          replyContent: v.reply ?? null,
          repliedAt: v.reply ? addMin(at, 60 * 3) : null,
          repliedBy: v.reply ? adm(c, 'demo-cs') : null,
          createdAt: at,
          createdBy: (v.channel ?? 'PHONE') === 'PHONE' ? adm(c, v.agent ?? 'demo-cs') : (cu?.id ?? null),
          updatedAt: at,
        })
        .returning({ id: consultation.id }),
    );
    return row.id;
  };
  await consult({ cust: 'lee', phone: '01000000003', type: 'ORDER', sub: 'REGULAR_CLEAN', status: 'DONE', content: '벽걸이 1대 정기 세척 문의 → 전화 출장접수 완료', daysAgo: 8 });
  await consult({ cust: 'park', phone: '01000000004', type: 'INQUIRY', sub: 'PRICE', status: 'DONE', content: '천장형 4way 대수 할인·세금계산서 발행 문의 안내', daysAgo: 30 });
  await consult({ cust: null, phone: '01000000099', type: 'INQUIRY', sub: 'SCHEDULE', status: 'DONE', content: '비회원: 이번 주 토요일 방문 가능 여부 문의(가능 시간 안내)', daysAgo: 2 });
  await consult({ cust: 'oh', phone: '01000000007', type: 'CLAIM', sub: 'EXTRA_CHARGE', status: 'IN_PROGRESS', content: '주차비 추가요금이 사전 안내와 달랐다는 항의. 거점 확인 후 회신 예정', daysAgo: 6, order: done.find((d) => d.spec.cust === 'oh')?.id ?? null });
  await consult({ cust: 'han', phone: '01000000006', type: 'CHANGE', sub: null, status: 'OPEN', content: '예약 일정 변경 문의 — 콜백 요청', daysAgo: 0 });
  const followConsult = await consult({ cust: 'lee', phone: '01000000003', type: 'FOLLOWUP', sub: null, status: 'IN_PROGRESS', content: '연기된 방문 일정 언제 다시 잡히는지 독촉', daysAgo: 1 });
  // 1:1 문의 (앱) — 답변 완료 1건, 미답변 1건
  await consult({ cust: 'song', phone: '01000000009', channel: 'APP_CHAT', type: 'INQUIRY', sub: 'SERVICE', status: 'DONE', content: '실외기도 같이 세척할 수 있나요?', daysAgo: 4, reply: '네, 실외기 세척 상품(40,000원)을 함께 예약하시면 같은 날 진행해 드려요.' });
  await consult({ cust: 'kim', phone: '01000000002', channel: 'APP_CHAT', type: 'INQUIRY', sub: 'PRICE', status: 'OPEN', content: '스탠드 2대를 예약하면 대수 할인이 되나요?', daysAgo: 0 });
  // 상담 FAQ 원천 (A-CNT-020 상담 → FAQ)
  await db.insert(faq).values([
    { category: 'SERVICE', audience: 'TECHNICIAN', question: '고객이 부재중이면 어떻게 하나요?', answer: '현관에서 30분 대기하며 2회 통화 후 [미처리 저장] → 사유 "고객부재"를 고르세요. 고객에게 부재 안내가 자동 발송됩니다.', isPublished: true, sortOrder: 1 },
    { category: 'ETC', audience: 'TECHNICIAN', question: '추가요금은 언제 청구할 수 있나요?', answer: '현장에서 사진과 사유를 남기고 고객 동의(앱 또는 서명)를 받은 금액만 청구됩니다(BR-040). 기타 항목은 관리자 승인 후 고객 동의를 받습니다.', isPublished: true, sortOrder: 2 },
  ]);

  /* ---- 독촉·전달 → 기사 앱 T-NTF-020 ---- */
  const pendingLee = await db.select({ id: serviceOrder.id }).from(serviceOrder).where(and(eq(serviceOrder.customerId, c.cust.lee!.id), eq(serviceOrder.status, 'PENDING')));
  await db.insert(followupRequest).values([
    { consultationId: followConsult, targetType: 'ORDER', targetOrderId: pendingLee[0]?.id ?? null, branchId: c.branchId.EP01!, followupCount: 1, followupType: 'SCHEDULE_DELAY', cause: 'CUSTOMER_CHANGE', message: '고객이 재방문 일정 회신을 기다립니다. 오늘 중 통화 부탁드립니다.', receiverTechId: c.techId.moon!, status: 'SENT', createdAt: clock.at(-1, 11), createdBy: adm(c, 'demo-cs') },
    { consultationId: followConsult, targetType: 'ORDER', targetOrderId: done[0]!.id, branchId: c.branchId.EP01!, followupCount: 1, followupType: 'MESSAGE_DELIVERY', cause: 'ETC', message: '고객이 지난번 작업 후 필터 구매처를 문의합니다.', receiverTechId: c.techId.kang!, status: 'REPLIED', reply: '통화로 안내 완료했습니다.', readAt: clock.at(-20, 13), repliedAt: clock.at(-20, 14), createdAt: clock.at(-20, 12), createdBy: adm(c, 'demo-cs') },
  ]);
  await notify(c, 'FOLLOWUP_SENT', { type: 'TECHNICIAN', id: c.techId.moon! }, { type: 'ORDER', id: pendingLee[0]?.id ?? done[0]!.id }, clock.at(-1, 11));

  /* ---- VOC (저평점 자동 · 전화 불만 · 칭찬) ---- */
  const vocRow = async (v: { cust: CustKey; order: MadeOrder | null; tech: TechKey | null; channel: string; type: string; l: string | null; m: string | null; title: string; content: string; severity: string; path: ('RECEIVED' | 'CONFIRMING' | 'PROCESSING' | 'DONE')[]; daysAgo: number; root?: string; action?: string }) => {
    const at = clock.at(-v.daysAgo, 15);
    const row = await one(
      db
        .insert(voc)
        .values({
          vocNo: await newAfterNo(c, 'V', at),
          customerId: c.cust[v.cust]!.id,
          orderId: v.order?.id ?? null,
          technicianId: v.tech ? c.techId[v.tech]! : null,
          branchId: v.order?.branchId ?? c.cust[v.cust]!.branchId,
          channel: v.channel,
          vocType: v.type,
          categoryL: v.l,
          categoryM: v.m,
          title: v.title,
          content: v.content,
          severity: v.severity,
          isAlert: v.severity === 'HIGH',
          status: v.path[v.path.length - 1]!,
          handlerAdminId: v.path.length > 1 ? adm(c, 'demo-cs') : null,
          rootCause: v.root ?? null,
          customerAction: v.action ?? null,
          closedAt: v.path.includes('DONE') ? addMin(at, 60 * 24 * 2) : null,
          createdAt: at,
          createdBy: v.channel === 'REVIEW' ? null : adm(c, 'demo-cs'),
        })
        .returning({ id: voc.id }),
    );
    let prev: string | null = null;
    for (const [i, st] of v.path.entries()) {
      if (prev) assertVocTransition(prev, st);
      await db.insert(vocHistory).values({ vocId: row.id, fromStatus: prev, toStatus: st, memo: i === 0 ? '접수' : st === 'DONE' ? '처리 완료' : '담당 확인', actorType: i === 0 && v.channel === 'REVIEW' ? 'SYSTEM' : 'ADMIN', actorId: i === 0 && v.channel === 'REVIEW' ? null : adm(c, 'demo-cs'), createdAt: addMin(at, i * 60 * 12) });
      prev = st;
    }
    return row.id;
  };
  const lowVoc = await vocRow({ cust: 'jung', order: jungLow, tech: 'seo', channel: 'REVIEW', type: 'COMPLAINT', l: 'SCHEDULE', m: 'SCHEDULE_DELAY', title: `저평점 후기(2점) ${jungLow.orderNo}`, content: '약속 시간보다 40분 늦게 오셨고 바닥에 물이 떨어졌어요.', severity: 'HIGH', path: ['RECEIVED'], daysAgo: W(-13) * -1 - 0 });
  await db.update(review).set({ vocId: lowVoc }).where(eq(review.orderId, jungLow.id));
  await vocRow({ cust: 'oh', order: done.find((d) => d.spec.cust === 'oh') ?? null, tech: 'moon', channel: 'PHONE_IN', type: 'COMPLAINT', l: 'PRICE', m: 'PRICE_EXTRA', title: '주차비 추가요금 사전 안내 미흡', content: '예약 때 주차비 이야기를 못 들었다는 항의', severity: 'MID', path: ['RECEIVED', 'CONFIRMING', 'PROCESSING'], daysAgo: 6 });
  await vocRow({ cust: 'hong', order: hongOld, tech: 'kang', channel: 'APP', type: 'PRAISE', l: 'ETC', m: 'ETC', title: '강팀장님 칭찬합니다', content: '설명도 친절하고 작업이 정말 꼼꼼했어요.', severity: 'LOW', path: ['RECEIVED', 'DONE'], daysAgo: 30, root: '해당 없음(칭찬)', action: '기사에게 칭찬 전달' });
  await vocRow({ cust: 'kim', order: null, tech: null, channel: 'SNS', type: 'SUGGESTION', l: 'ETC', m: 'ETC', title: '저녁 시간대 예약 확대 요청', content: '퇴근 후 19시 이후 예약이 더 있었으면 좋겠어요.', severity: 'LOW', path: ['RECEIVED', 'CONFIRMING'], daysAgo: 12 });
  await db.update(technician).set({ vocCount: 2 }).where(eq(technician.id, c.techId.seo!));

  /* ---- AS (고객 요청 대기 · 승인 후 재방문 예약) ---- */
  const seoDone = done.find((d) => d.spec.cust === 'seo')!;
  assertAsTransition('REQUESTED', 'ACCEPTED');
  await db.insert(asRequest).values({ asNo: await newAfterNo(c, 'A', clock.at(-1, 20)), originalOrderId: seoDone.id, customerId: seoDone.customerId, branchId: seoDone.branchId, reason: 'ODOR', content: '세척 후 2주 만에 다시 냄새가 나요.', isWarranty: true, warrantyUntil: kstDateOf(new Date(seoDone.completedAt!.getTime() + 30 * DAY_MS)), responsibleTechId: c.techId.seo!, status: 'REQUESTED', createdAt: clock.at(-1, 20), createdBy: seoDone.customerId });
  await notify(c, 'AS_RECEIVED', { type: 'CUSTOMER', id: seoDone.customerId, phone: c.cust.seo!.phone }, { type: 'ORDER', id: seoDone.id }, clock.at(-1, 20, 1));
  const songDone = done.find((d) => d.spec.cust === 'song' && d.spec.extras)!;
  const asAt = clock.at(-3, 9);
  const asOrder = await makeOrder(c, { cust: 'song', day: W(2), hour: 10, lines: [wall(1)], status: 'ASSIGNED', tech: 'moon', channel: 'AS', orderType: 'AS', free: true, parentOrderId: songDone.id, createdDaysBefore: 3, note: note('보증 AS 재방문(무상)') });
  assertAsTransition('ACCEPTED', 'SCHEDULED');
  await db.insert(asRequest).values({ asNo: await newAfterNo(c, 'A', asAt), originalOrderId: songDone.id, newOrderId: asOrder.id, customerId: songDone.customerId, branchId: songDone.branchId, reason: 'LEAK', content: '세척 후 실내기에서 물이 떨어져요.', isWarranty: true, warrantyUntil: kstDateOf(new Date(songDone.completedAt!.getTime() + 30 * DAY_MS)), responsibleTechId: c.techId.moon!, status: 'SCHEDULED', handledBy: adm(c, 'demo-ops'), handleNote: '보증 기간 내 무상 재방문 배정', createdAt: asAt, createdBy: songDone.customerId });
  await notify(c, 'AS_SCHEDULED', { type: 'CUSTOMER', id: songDone.customerId, phone: c.cust.song!.phone }, { type: 'ORDER', id: asOrder.id }, addMin(asAt, 120));

  /* ---- 안전사고 (BR-060·061) ---- */
  const ohDone = done.find((d) => d.spec.cust === 'oh')!;
  const incAt = clock.at(-7, 18);
  assertIncidentTransition('REPORTED', 'INVESTIGATING');
  const inc = await one(
    db
      .insert(safetyIncident)
      .values({ incidentNo: await newAfterNo(c, 'S', incAt), customerId: ohDone.customerId, orderId: ohDone.id, technicianId: c.techId.moon!, branchId: ohDone.branchId, damageType: 'WATER_LEAK', occurredAt: addMin(incAt, -300), circumstance: '세척 후 배수 호스 연결부에서 누수 발생(가상 사례)', damageDetail: '거실 벽지 일부 얼룩', customerDemand: '벽지 부분 도배 요청', responseAction: '거점장 현장 방문 예정, 보험 접수 검토', mediaFlags: 'INSURANCE', isEscalated: false, status: 'INVESTIGATING', createdAt: incAt, createdBy: adm(c, 'demo-cs') })
      .returning({ id: safetyIncident.id }),
  );
  await db.insert(incidentRecipient).values([
    { incidentId: inc.id, recipientType: 'BRANCH_MANAGER', adminUserId: adm(c, 'demo-ep'), name: '박거점', org: '은평거점', notifiedAt: addMin(incAt, 1), notifyResult: 'SENT' },
    { incidentId: inc.id, recipientType: 'MANUAL', name: '보험사 담당(가상)', org: '테스트손해보험', phone: c.enc('01000008001'), email: 'claim@example.com', notifiedAt: addMin(incAt, 30), notifyResult: 'SENT' },
  ]);
  await notify(c, 'SAFETY_INCIDENT', { type: 'ADMIN', id: adm(c, 'demo-ep') }, null, addMin(incAt, 1));

  /* ---- 정산 (지난 2주: 지급 완료 회차 · 계산 완료 회차) ---- */
  await seedSettlements(c, done);

  /* ---- 결제 실패 · 증빙 실패 사례 (결제 관리) ---- */
  const failTax = done.find((d) => d.spec.pay === 'CASH' && d.spec.cust === 'kim');
  if (failTax) {
    const [p] = await db.select({ id: payment.id }).from(payment).where(eq(payment.orderId, failTax.id));
    if (p) {
      await db.update(taxDocument).set({ issueStatus: 'FAILED', issuedNo: null, issuedAt: null, failReason: '국세청 응답 지연(테스트) — 재발행 필요' }).where(eq(taxDocument.paymentId, p.id));
    }
  }

  /* ---- 고객 쿠폰·보유 기기 ---- */
  await db
    .insert(customerCoupon)
    .values([
      { couponId: c.couponId.WELCOME5000!, customerId: c.cust.kim!.id, status: 'ISSUED', issuedAt: clock.at(-20, 9), issuedBy: adm(c, 'demo-mkt') },
      { couponId: c.couponId.WINTER10!, customerId: c.cust.kim!.id, status: 'ISSUED', issuedAt: clock.at(-5, 9), issuedBy: adm(c, 'demo-mkt') },
      { couponId: c.couponId.WINTER10!, customerId: c.cust.hong!.id, status: 'ISSUED', issuedAt: clock.at(-5, 9), issuedBy: adm(c, 'demo-mkt') },
      { couponId: c.couponId.WELCOME5000!, customerId: c.cust.jung!.id, status: 'ISSUED', issuedAt: clock.at(-40, 9) },
      { couponId: c.couponId.SUMMER2026!, customerId: c.cust.song!.id, status: 'ISSUED', issuedAt: clock.at(-150, 9), issuedBy: adm(c, 'demo-mkt') },
    ])
    .onConflictDoNothing();
  await db.insert(customerDevice).values({ customerId: c.cust.hong!.id, addressId: c.cust.hong!.addressIds[0]!, deviceType: 'WINDOW', brand: 'ETC', modelName: '창문형(직접 등록)', installYear: 2022, locationInHouse: '작은방', lastCleanedAt: clock.day(-400), lastCleanLevel: 'BASIC', recommendMonths: 12, createdAt: clock.at(-60, 20), createdBy: c.cust.hong!.id });

  /* ---- 비회원 견적 · 만료 견적 · 오픈 알림 신청 ---- */
  const guestQuote = async (code: string, status: 'ISSUED' | 'EXPIRED', daysAgo: number) => {
    const area = c.areaByCode.get(code)!;
    const at = clock.at(-daysAgo, 21);
    const calc = calculateQuote({ area: { legalDongCode: code, branchId: area.branchId, isServiceable: true, travelFee: area.travelFee }, lines: [wall(2)], options: [], customerType: 'PERSONAL', priceDate: kstDateOf(at), visit: null, holidays: c.holidays, catalog: c.catalog, settings: { siteSurveyMinUnits: 4 } });
    if (!calc.ok) return;
    const q = await one(db.insert(quote).values({ quoteNo: await newQuoteNo(c, at), guestPhoneHash: c.ph('01000000098'), channel: 'APP', legalDongCode: code, branchId: area.branchId, isServiceable: true, subtotalAmount: calc.subtotalAmount, discountAmount: calc.discountAmount, surchargeAmount: calc.surchargeAmount, totalAmount: calc.totalAmount, estimatedDurationMin: calc.estimatedDurationMin, status, expiresAt: new Date(at.getTime() + 7 * DAY_MS), priceSnapshotJson: calc.snapshot, createdAt: at, updatedAt: at }).returning({ id: quote.id }));
    await db.insert(quoteItem).values(calc.items.map((i) => ({ quoteId: q.id, itemType: i.itemType, productId: i.productId, optionId: i.optionId, surchargeRuleId: i.surchargeRuleId, quantity: i.quantity, unitPrice: i.unitPrice, amount: i.amount })));
  };
  await guestQuote('1138010600', 'ISSUED', 1);
  await guestQuote('1138010300', 'EXPIRED', 20);
  await db.insert(areaOpenRequest).values([
    { legalDongCode: '2635010500', sido: '부산광역시', sigungu: '해운대구', eupmyeondong: '우동', phone: c.enc('01000000097'), phoneHash: c.ph('01000000097'), privacyAgreedAt: clock.at(-12, 20), status: 'WAITING', branchId: c.branchId.BS01!, createdAt: clock.at(-12, 20) },
    { legalDongCode: '2635010500', sido: '부산광역시', sigungu: '해운대구', eupmyeondong: '우동', phone: c.enc('01000000096'), phoneHash: c.ph('01000000096'), privacyAgreedAt: clock.at(-3, 21), status: 'WAITING', branchId: c.branchId.BS01!, notifyFailCount: 1, lastFailReason: '알림톡 발송 실패(테스트)', createdAt: clock.at(-3, 21) },
    { legalDongCode: '2823710100', sido: '인천광역시', sigungu: '부평구', eupmyeondong: '부평동', phone: c.enc('01000000095'), phoneHash: c.ph('01000000095'), privacyAgreedAt: clock.at(-8, 19), status: 'WAITING', createdAt: clock.at(-8, 19) },
    { legalDongCode: '4113510900', sido: '경기도', sigungu: '성남시 분당구', eupmyeondong: '삼평동', phone: null, phoneHash: null, privacyAgreedAt: clock.at(-200, 19), status: 'NOTIFIED', branchId: c.branchId.BD01!, notifiedAt: clock.at(-178, 10), notifyChannel: 'ALIMTALK', createdAt: clock.at(-200, 19) },
  ]).onConflictDoNothing();

  /* ---- CRM: 캠페인 ---- */
  await seedCampaigns(c, done);

  /* ---- 콘텐츠: 공지·기술자료·메모·퀵메뉴 ---- */
  await seedContent(c);

  /* ---- 교육·지원서·자재 요청 ---- */
  await seedTraining(c);

  /* ---- 기사 이동거리 집계 (지난 7일) ---- */
  const distRows: (typeof technicianDailyDistance.$inferInsert)[] = [];
  for (const k of ['kang', 'seo', 'moon', 'jang', 'lim'] as const) {
    for (let n = -7; n <= -1; n++) {
      if (clock.dow(clock.day(n)) === 0) continue;
      distRows.push({ technicianId: c.techId[k]!, workDate: clock.day(n), distanceM: 18000 + ((n * 37 + k.length * 1000) % 9000 + 9000) % 9000, pointCount: 300 + n * -5 });
    }
  }
  await db.insert(technicianDailyDistance).values(distRows).onConflictDoNothing();

  /* ---- 감사 로그 (개인정보 열람·엑셀) ---- */
  await db.insert(auditLog).values([
    { actorType: 'ADMIN', actorId: adm(c, 'demo-cs'), action: 'VIEW_PII', targetTable: 'customer', targetId: String(c.cust.hong!.id), ipAddress: '127.0.0.1', detailJson: { field: 'phone1', screen: 'A-CUS-020' }, createdAt: clock.at(-2, 11) },
    { actorType: 'ADMIN', actorId: adm(c, 'demo-ops'), action: 'EXPORT', targetTable: 'service_order', targetId: null, ipAddress: '127.0.0.1', detailJson: { screen: 'A-ORD-010', rows: 21 }, createdAt: clock.at(-1, 17) },
    { actorType: 'TECHNICIAN', actorId: c.techId.kang!, action: 'VIEW_PII', targetTable: 'service_order', targetId: String(done[0]!.id), detailJson: { screen: 'T-JOB-020' }, createdAt: clock.at(-33, 8) },
  ]);

  // 고객 누적 집계(최근 서비스일·완료 건수)
  for (const k of Object.values(c.cust)) {
    await db.execute(sql`UPDATE customer SET total_order_count = (SELECT count(*) FROM service_order WHERE customer_id = ${k!.id} AND status = 'COMPLETED'),
      last_service_date = (SELECT max((completed_at AT TIME ZONE 'Asia/Seoul')::date) FROM service_order WHERE customer_id = ${k!.id} AND status = 'COMPLETED')
      WHERE id = ${k!.id}`);
  }
  void hong2;
}

async function seedSettlements(c: Ctx, done: MadeOrder[]) {
  const { db, clock } = c;
  const policies = (await db.select().from(commissionPolicy).where(isNull(commissionPolicy.deletedAt))).map(
    (p): CommissionPolicyLike => ({
      id: p.id,
      policyName: p.policyName,
      techGrade: p.techGrade,
      contractType: p.contractType,
      branchId: p.branchId,
      calcType: p.calcType,
      techShareRate: p.techShareRate === null ? null : Number(p.techShareRate),
      perUnitAmount: p.perUnitAmount,
      extraChargeShareRate: p.extraChargeShareRate === null ? null : Number(p.extraChargeShareRate),
      supportRoleRate: p.supportRoleRate === null ? null : Number(p.supportRoleRate),
      withholdingRate: p.withholdingRate === null ? null : Number(p.withholdingRate),
      validFrom: p.validFrom,
      validTo: p.validTo,
    }),
  );
  if (!policies.length) return;
  const weeks = [weekOf(clock.day(-14)), weekOf(clock.day(-7))];
  const payDay = (await db.select().from(systemSetting).where(eq(systemSetting.settingKey, 'SETTLEMENT_WEEKDAY')))[0]?.settingValue ?? 'WED';
  const keyOf = (k: TechKey) => k;
  for (const [wi, wk] of weeks.entries()) {
    const batchNo = batchNoOf(wk.periodStart);
    const [exists] = await db.select({ id: settlementBatch.id }).from(settlementBatch).where(eq(settlementBatch.batchNo, batchNo));
    if (exists) continue;
    const jobs = done.filter((d) => d.workOrderId && d.completedAt && kstDateOf(d.completedAt) >= wk.periodStart && kstDateOf(d.completedAt) <= wk.periodEnd && d.spec.inspection !== 'REJECTED');
    if (!jobs.length) continue;
    const paid = wi === 0;
    const batchPath = paid ? (['DRAFT', 'CALCULATED', 'CONFIRMED', 'PAID'] as const) : (['DRAFT', 'CALCULATED'] as const);
    for (let i = 1; i < batchPath.length; i++) assertBatchTransition(batchPath[i - 1]!, batchPath[i]!);
    const calcAt = new Date(`${clock.day(0) > wk.periodEnd ? wk.periodEnd : clock.day(0)}T10:00:00+09:00`);
    const calcAtReal = addMin(calcAt, 60 * 24);
    const b = await one(
      db
        .insert(settlementBatch)
        .values({ batchNo, periodStart: wk.periodStart, periodEnd: wk.periodEnd, status: batchPath[batchPath.length - 1]!, scheduledPayDate: scheduledPayDateOf(wk.periodEnd, payDay), confirmedBy: paid ? adm(c, 'demo-fin') : null, confirmedAt: paid ? addMin(calcAtReal, 60 * 24) : null, createdAt: calcAtReal, createdBy: adm(c, 'demo-fin') })
        .returning({ id: settlementBatch.id }),
    );
    let prev: string | null = null;
    for (const [i, st] of batchPath.entries()) {
      await db.insert(settlementStatusHistory).values({ batchId: b.id, fromStatus: prev, toStatus: st, actorType: 'ADMIN', actorId: adm(c, 'demo-fin'), createdAt: addMin(calcAtReal, i * 60 * 24) });
      prev = st;
    }
    // 작업 → 기사별 항목
    const perTech = new Map<number, { items: ReturnType<typeof calcJobShares>[number] & { workOrderId: number; orderId: number }[]; cash: number }>();
    const itemsByTech = new Map<number, (ReturnType<typeof calcJobShares>[number] & { workOrderId: number; orderId: number })[]>();
    const cashByTech = new Map<number, number>();
    for (const j of jobs) {
      const mainKey = (Object.entries(c.techId).find(([, id]) => id === j.techId)?.[0] ?? 'kang') as TechKey;
      const meta = c.techMeta[keyOf(mainKey)]!;
      const pol = selectCommissionPolicy(policies, { grade: meta.grade, contractType: meta.contract, branchId: meta.branchId }, kstDateOf(j.completedAt!));
      if (!pol) continue;
      const shares = calcJobShares(
        {
          totalAmount: j.totalAmount,
          extraAmount: j.extraAmount,
          units: j.units,
          mainTechnicianId: j.techId!,
          supportTechnicianIds: j.spec.support ? [c.techId[j.spec.support]!] : [],
          accompanyTechnicianIds: j.spec.accompany ? [c.techId[j.spec.accompany]!] : [],
        },
        pol,
      );
      for (const s of shares) {
        if (!itemsByTech.has(s.technicianId)) itemsByTech.set(s.technicianId, []);
        itemsByTech.get(s.technicianId)!.push({ ...s, workOrderId: j.workOrderId!, orderId: j.id });
      }
      if (j.cashCollected) cashByTech.set(j.techId!, (cashByTech.get(j.techId!) ?? 0) + j.cashCollected);
    }
    void perTech;
    let totalPay = 0;
    for (const [techId, items] of itemsByTech) {
      const key = (Object.entries(c.techId).find(([, id]) => id === techId)?.[0] ?? 'kang') as TechKey;
      const meta = c.techMeta[key]!;
      const pol = selectCommissionPolicy(policies, { grade: meta.grade, contractType: meta.contract, branchId: meta.branchId }, wk.periodEnd);
      const sum = summarizeSettlement(
        items.map((i) => ({ itemType: i.itemType, role: i.role, workOrderId: i.workOrderId, salesAmount: i.salesAmount, payAmount: i.payAmount })),
        { cashCollected: cashByTech.get(techId) ?? 0, contractType: meta.contract, withholdingRate: pol?.withholdingRate ?? null },
      );
      // 기사별 상태: 지급 회차는 PAID, 계산 회차는 기사마다 다르게(확인·이의·미응답)
      const tPath: string[] = paid ? ['CALCULATED', 'TECH_CONFIRMED', 'CONFIRMED', 'PAID'] : key === 'seo' ? ['CALCULATED', 'DISPUTED'] : key === 'kang' ? ['CALCULATED', 'TECH_CONFIRMED'] : ['CALCULATED'];
      for (let i = 1; i < tPath.length; i++) assertSettlementTransition(tPath[i - 1]!, tPath[i] as never);
      const st = await one(
        db
          .insert(settlement)
          .values({ batchId: b.id, technicianId: techId, ...sum, status: 'CALCULATED', createdAt: calcAtReal, createdBy: adm(c, 'demo-fin') })
          .returning({ id: settlement.id }),
      );
      totalPay += sum.netPay;
      // 계산 때 항목을 넣고(CALCULATED), 그 뒤 기사 확인·회차 확정·지급 순서로 상태만 바꾼다(BR-084 확정 후 항목 추가 금지)
      await db.insert(settlementItem).values(items.map((i) => ({ settlementId: st.id, workOrderId: i.workOrderId, orderId: i.orderId, role: i.role, salesAmount: i.salesAmount, shareRate: i.shareRate === null ? null : i.shareRate.toFixed(2), payAmount: i.payAmount, itemType: i.itemType, memo: i.memo, createdAt: calcAtReal, createdBy: adm(c, 'demo-fin') })));
      await db
        .update(settlement)
        .set({ status: tPath[tPath.length - 1]!, disputeNote: key === 'seo' && !paid ? '간편결제 건 금액이 빠진 것 같습니다. 확인 부탁드립니다.' : null, paidAt: paid ? addMin(calcAtReal, 60 * 24 * 3) : null, transferRef: paid ? `TEST-TRANSFER-${b.id}-${techId}` : null, updatedAt: addMin(calcAtReal, 60 * 24 * 3), updatedBy: adm(c, 'demo-fin') })
        .where(eq(settlement.id, st.id));
      let sp: string | null = null;
      for (const [i, s] of tPath.entries()) {
        await db.insert(settlementStatusHistory).values({ batchId: b.id, settlementId: st.id, fromStatus: sp, toStatus: s, actorType: s === 'TECH_CONFIRMED' || s === 'DISPUTED' ? 'TECHNICIAN' : 'ADMIN', actorId: s === 'TECH_CONFIRMED' || s === 'DISPUTED' ? techId : adm(c, 'demo-fin'), memo: s === 'DISPUTED' ? '간편결제 건 금액 확인 요청' : null, createdAt: addMin(calcAtReal, i * 60 * 12) });
        sp = s;
      }
      await notify(c, 'STL_CONFIRM_REQUEST', { type: 'TECHNICIAN', id: techId }, { type: 'SETTLEMENT', id: st.id }, calcAtReal);
      if (paid) await notify(c, 'STL_PAID', { type: 'TECHNICIAN', id: techId }, { type: 'SETTLEMENT', id: st.id }, addMin(calcAtReal, 60 * 24 * 3));
    }
    await db.update(settlementBatch).set({ totalPayAmount: totalPay }).where(eq(settlementBatch.id, b.id));
  }
}

async function seedCampaigns(c: Ctx, done: MadeOrder[]) {
  const { db, clock } = c;
  const mk = adm(c, 'demo-mkt');
  // 자동 재방문(REVISIT_AUTO)은 RUNNING/STOPPED 만 쓴다
  const [revisit] = await db.select({ id: campaign.id }).from(campaign).where(eq(campaign.campaignType, 'REVISIT_AUTO'));
  if (!revisit) {
    assertCampaignTransition('DRAFT', 'RUNNING');
    await db.insert(campaign).values({ name: '11개월 재방문 자동 안내', campaignType: 'REVISIT_AUTO', targetRuleJson: { months: 11 }, templateId: c.templateId.REVISIT_11M ?? null, couponId: c.couponId.REVISIT7000!, scheduleType: 'DAILY_AUTO', status: 'RUNNING', createdAt: clock.at(-90, 10), createdBy: mk });
  }
  assertCampaignTransition('DRAFT', 'SCHEDULED');
  assertCampaignTransition('SCHEDULED', 'RUNNING');
  assertCampaignTransition('RUNNING', 'DONE');
  const season = await one(
    db
      .insert(campaign)
      .values({ name: `${DEMO_TAG} 겨울 비수기 10% 할인`, campaignType: 'SEASON', targetRuleJson: { marketingAgree: true, lastServiceBeforeDays: 0 }, templateId: c.templateId.CAMPAIGN_MESSAGE ?? null, couponId: c.couponId.WINTER10!, scheduleType: 'ONCE', sendAt: clock.at(-5, 10), status: 'DONE', createdAt: clock.at(-8, 15), createdBy: mk })
      .returning({ id: campaign.id }),
  );
  const conv = done.find((d) => d.spec.cust === 'hong' && d.completedAt && d.completedAt > clock.at(-5, 10));
  await db.insert(campaignTarget).values(
    (['hong', 'kim', 'jung', 'seo', 'song', 'yim'] as const).map((k, i) => ({
      campaignId: season.id,
      customerId: c.cust[k]!.id,
      sentAt: clock.at(-5, 10, i),
      openedAt: i % 2 === 0 ? clock.at(-5, 12, i) : null,
      convertedOrderId: k === 'hong' && conv ? conv.id : null,
      status: k === 'hong' && conv ? 'CONVERTED' : k === 'seo' ? 'FAILED' : 'SENT',
      createdAt: clock.at(-5, 10, i),
    })),
  );
  await db.insert(campaign).values([
    { name: `${DEMO_TAG} 연말 감사 쿠폰(예약)`, campaignType: 'WINBACK', targetRuleJson: { inactiveMonths: 6 }, templateId: c.templateId.COUPON_ISSUED ?? null, couponId: c.couponId.REVISIT7000!, scheduleType: 'ONCE', sendAt: clock.at(10, 10), status: 'SCHEDULED', createdAt: clock.at(-1, 16), createdBy: mk },
    { name: `${DEMO_TAG} 실외기 세척 교차 판매(작성중)`, campaignType: 'CROSS_SELL', targetRuleJson: { deviceType: 'WALL' }, templateId: c.templateId.CAMPAIGN_MESSAGE ?? null, scheduleType: 'ONCE', status: 'DRAFT', createdAt: clock.at(0, 9), createdBy: mk },
  ]);
}

async function seedContent(c: Ctx) {
  const { db, clock } = c;
  const author = adm(c, 'demo-super');
  const notices = await db
    .insert(notice)
    .values([
      { noticeType: 'ALL', targetAudience: 'TECHNICIAN', title: `${DEMO_TAG} 12월 비수기 운영 안내`, content: '12월은 비수기로 오전 근무 위주로 편성합니다. 근무표를 확인해 주세요.', isPinned: true, isPopup: false, publishFrom: clock.at(-3, 9), authorAdminId: author, createdBy: author },
      { noticeType: 'SAFETY', targetAudience: 'TECHNICIAN', title: `${DEMO_TAG} [필독] 고소 작업 안전 수칙`, content: '2.5m 이상 작업은 반드시 2인 1조, 안전모·안전대를 착용하고 작업 시작 전 안전 체크리스트를 저장하세요.', isPinned: true, isPopup: true, publishFrom: clock.at(-10, 9), authorAdminId: author, createdBy: author },
      { noticeType: 'BRANCH', targetAudience: 'TECHNICIAN', branchId: c.branchId.EP01!, title: `${DEMO_TAG} 은평거점 자재 수령 시간 변경`, content: '자재 수령은 평일 08:00~08:40에 거점에서 가능합니다.', publishFrom: clock.at(-5, 9), authorAdminId: adm(c, 'demo-ep'), createdBy: adm(c, 'demo-ep') },
      { noticeType: 'ALL', targetAudience: 'ADMIN', title: `${DEMO_TAG} 상담 스크립트 개정`, content: '야간·휴일 방문 안내 멘트가 바뀌었습니다. 상담 스크립트를 확인하세요.', publishFrom: clock.at(-2, 9), authorAdminId: author, createdBy: author },
      { noticeType: 'CUSTOMER', targetAudience: 'CUSTOMER', title: `${DEMO_TAG} 겨울철 에어컨 관리 팁`, content: '겨울에는 송풍 운전으로 내부를 말린 뒤 커버를 씌워 주세요.', isPinned: false, publishFrom: clock.at(-7, 9), authorAdminId: author, createdBy: author },
    ])
    .returning({ id: notice.id });
  await db.insert(noticeRead).values([
    { noticeId: notices[1]!.id, readerType: 'TECHNICIAN', readerId: c.techId.kang!, readAt: clock.at(-9, 8) },
    { noticeId: notices[0]!.id, readerType: 'TECHNICIAN', readerId: c.techId.kang!, readAt: clock.at(-2, 8) },
    { noticeId: notices[1]!.id, readerType: 'TECHNICIAN', readerId: c.techId.jang!, readAt: clock.at(-8, 8) },
  ]).onConflictDoNothing();

  await db.insert(techDocument).values([
    { docType: 'SOP', deviceType: 'WALL', title: `${DEMO_TAG} 벽걸이 완전분해 세척 표준 절차`, content: '1) 전원 차단 2) 방수 커버 설치 3) 패널·필터 분리 4) 열교환기 세정제 도포 5) 고압 세척 6) 건조·조립 7) 시운전', version: 2, isRequiredRead: true, createdBy: adm(c, 'demo-ops') },
    { docType: 'TECH_GUIDE', deviceType: 'CEILING_4WAY', title: `${DEMO_TAG} 천장형 드레인펌프 점검 가이드`, content: '드레인펌프 동작음과 배수 상태를 확인하고, 플로트 스위치 이물질을 제거합니다.', createdBy: adm(c, 'demo-ops') },
    { docType: 'CS_TIP', deviceType: null, title: `${DEMO_TAG} 추가요금 안내 화법`, content: '사진을 먼저 보여 드리고, 금액과 이유를 한 문장으로 설명한 뒤 동의를 받습니다.', createdBy: adm(c, 'demo-cs') },
    { docType: 'SAFETY', deviceType: null, title: `${DEMO_TAG} 전기 안전 체크리스트`, content: '누전 차단기 확인 · 젖은 손 금지 · 콘센트 방수 처리', isRequiredRead: true, createdBy: adm(c, 'demo-ops') },
    { docType: 'HANDBOOK', deviceType: null, title: `${DEMO_TAG} 신입 기사 핸드북`, content: '복장·인사·작업 순서·앱 사용법을 정리했습니다.', createdBy: adm(c, 'demo-ops') },
  ]);

  const kang = c.techId.kang!;
  const seo = c.techId.seo!;
  await db.insert(memo).values([
    { ownerType: 'TECHNICIAN', ownerId: kang, headerCode: 'MANUAL', content: '차량 정기 점검 예약', startDate: clock.day(2), endDate: clock.day(2), isAllDay: true, prioritySource: 'SELF', createdBy: kang },
    { ownerType: 'TECHNICIAN', ownerId: kang, headerCode: 'REVISIT', content: '홍길동 고객 부모님댁 내년 여름 재방문 제안', startDate: clock.day(5), endDate: clock.day(5), popupEnabled: true, popupTime: '08:30', prioritySource: 'SELF', createdBy: kang },
    { ownerType: 'TECHNICIAN', ownerId: kang, headerCode: 'CUSTOMER_CONTACT', content: '매주 월요일 자재 재고 확인', startDate: clock.day(-14), endDate: clock.day(60), repeatType: 'WEEKLY', prioritySource: 'SELF', createdBy: kang },
  ]);
  const assigned = await one(
    db
      .insert(memo)
      .values({ ownerType: 'ADMIN', ownerId: adm(c, 'demo-ep') ?? 0, headerCode: 'MANUAL', content: '내일 오전 거점 안전교육(30분) 참석 바랍니다.', startDate: clock.day(1), endDate: clock.day(1), isShared: true, popupEnabled: true, popupTime: '08:00', prioritySource: 'BRANCH_MANAGER', createdBy: adm(c, 'demo-ep') })
      .returning({ id: memo.id }),
  );
  await db.insert(memoRecipient).values([
    { memoId: assigned.id, receiverType: 'TECHNICIAN', receiverId: kang, readAt: clock.at(0, 7, 50) },
    { memoId: assigned.id, receiverType: 'TECHNICIAN', receiverId: seo },
    { memoId: assigned.id, receiverType: 'TECHNICIAN', receiverId: c.techId.moon! },
  ]);
  await notify(c, 'TECH_MEMO_ASSIGNED', { type: 'TECHNICIAN', id: seo }, null, clock.at(-1, 17));

  await db
    .insert(quickMenu)
    .values([
      { userType: 'TECHNICIAN', userId: kang, menuCode: 'T-RTE-010', sortOrder: 1 },
      { userType: 'TECHNICIAN', userId: kang, menuCode: 'T-CAL-010', sortOrder: 2 },
      { userType: 'TECHNICIAN', userId: kang, menuCode: 'T-MAT-010', sortOrder: 3 },
      { userType: 'TECHNICIAN', userId: kang, menuCode: 'T-STL-010', sortOrder: 4 },
      { userType: 'TECHNICIAN', userId: seo, menuCode: 'T-PAY-010', sortOrder: 1 },
    ])
    .onConflictDoNothing();
}

async function seedTraining(c: Ctx) {
  const { db, clock } = c;
  const ep = c.branchId.EP01!;
  const ops = adm(c, 'demo-ops');
  const yy = c.clock.today.slice(2, 4);
  const course = async (v: { code: string; name: string; type: string; status: 'RECRUITING' | 'IN_PROGRESS' | 'FINISHED'; start: number; end: number; hours: number; fee: number; cap: number }) => {
    if (v.status !== 'RECRUITING') assertCourseTransition('RECRUITING', 'IN_PROGRESS');
    if (v.status === 'FINISHED') assertCourseTransition('IN_PROGRESS', 'FINISHED');
    await db.insert(trainingCourse).values({ courseCode: v.code, name: v.name, courseType: v.type, fee: v.fee, totalHours: v.hours, passCriteria: '출석 80% 이상 · 실습 80점 이상', branchId: ep, startDate: clock.day(v.start), endDate: clock.day(v.end), capacity: v.cap, status: v.status, createdBy: ops }).onConflictDoNothing();
    return (await db.select({ id: trainingCourse.id }).from(trainingCourse).where(eq(trainingCourse.courseCode, v.code)))[0]!.id;
  };
  const basicOld = await course({ code: `DEMO-B${yy}-1`, name: `${DEMO_TAG} 기본과정 1기`, type: 'BASIC', status: 'FINISHED', start: -260, end: -250, hours: 40, fee: 0, cap: 10 });
  const basicNow = await course({ code: `DEMO-B${yy}-2`, name: `${DEMO_TAG} 기본과정 2기`, type: 'BASIC', status: 'IN_PROGRESS', start: -14, end: 10, hours: 40, fee: 0, cap: 8 });
  const safety = await course({ code: `DEMO-S${yy}-1`, name: `${DEMO_TAG} 고소작업 안전교육`, type: 'SAFETY', status: 'FINISHED', start: -40, end: -40, hours: 4, fee: 0, cap: 20 });
  await course({ code: `DEMO-L${yy}-1`, name: `${DEMO_TAG} 팀장 양성과정`, type: 'LEADER', status: 'RECRUITING', start: 20, end: 34, hours: 24, fee: 100000, cap: 6 });
  const enroll = (courseId: number, k: TechKey, result: 'ENROLLED' | 'PASSED' | 'FAILED', att: number | null, score: number | null, cert: string | null, done: number | null) =>
    db.insert(trainingEnrollment).values({ courseId, technicianId: c.techId[k]!, attendanceRate: att, practicalScore: score, result, completedAt: done === null ? null : clock.day(done), certificateNo: cert, createdBy: ops }).onConflictDoNothing();
  await enroll(basicOld, 'seo', 'PASSED', 100, 92, `DEMO-B${yy}-1-${c.clock.today.slice(0, 4)}-001`, -250);
  await enroll(basicOld, 'ryu', 'PASSED', 95, 85, `DEMO-B${yy}-1-${c.clock.today.slice(0, 4)}-002`, -250);
  await enroll(basicNow, 'shin', 'ENROLLED', 60, null, null, null);
  await enroll(safety, 'kang', 'PASSED', 100, 95, `DEMO-S${yy}-1-${c.clock.today.slice(0, 4)}-001`, -40);
  await enroll(safety, 'moon', 'PASSED', 100, 88, `DEMO-S${yy}-1-${c.clock.today.slice(0, 4)}-002`, -40);
  await enroll(safety, 'seo', 'FAILED', 50, 60, null, -40);
  await notify(c, 'TRAINING_PASSED', { type: 'TECHNICIAN', id: c.techId.kang! }, null, clock.at(-40, 18));

  // 지원서 (상시 모집)
  const app = (name: string, phone: string, status: 'APPLIED' | 'INTERVIEW' | 'ACCEPTED' | 'REJECTED', source: string, age: string, days: number, techKey?: TechKey) => {
    if (status === 'INTERVIEW' || status === 'REJECTED') assertApplicationTransition('APPLIED', status);
    if (status === 'ACCEPTED') assertApplicationTransition('INTERVIEW', 'ACCEPTED');
    return { branchId: ep, name, phone: c.enc(phone), phoneHash: c.ph(phone), ageGroup: age, region: '서울 은평구', experienceYears: status === 'REJECTED' ? 0 : 2, licenses: null, source, supportTargetFlag: source === 'GOV_PROGRAM', status, note: status === 'REJECTED' ? '근무 지역 불일치' : status === 'INTERVIEW' ? `면접 ${clock.day(3)} 14:00` : null, technicianId: techKey ? c.techId[techKey]! : null, createdAt: clock.at(-days, 13), createdBy: null };
  };
  const [hasApp] = await db.select({ id: technicianApplication.id }).from(technicianApplication).where(eq(technicianApplication.phoneHash, c.ph('01000003001')));
  if (!hasApp) {
    await db.insert(technicianApplication).values([
      app('지원가람', '01000003001', 'APPLIED', 'SNS', '30S', 2),
      app('지원나래', '01000003002', 'INTERVIEW', 'JOB_SITE', '40S', 6),
      app('지원다솜', '01000003003', 'REJECTED', 'REFERRAL', '20S', 15),
      app('신견습', '01000001004', 'ACCEPTED', 'GOV_PROGRAM', '30S', 25, 'shin'),
    ]);
  }

  // 자재 요청 (REQUESTED · RECEIVED · CANCELED)
  assertMaterialRequestTransition('REQUESTED', 'RECEIVED');
  assertMaterialRequestTransition('REQUESTED', 'CANCELED');
  await db.insert(materialRequest).values([
    { technicianId: c.techId.seo!, materialId: c.materialId['M-FILTER']!, quantity: 10, neededDate: clock.day(2), status: 'REQUESTED', createdAt: clock.at(-1, 18), createdBy: c.techId.seo! },
    { technicianId: c.techId.kang!, materialId: c.materialId['M-CLEANER']!, quantity: 5, neededDate: clock.day(-6), status: 'RECEIVED', receivedAt: clock.at(-6, 8, 20), handledBy: adm(c, 'demo-ep'), createdAt: clock.at(-8, 17), createdBy: c.techId.kang! },
    { technicianId: c.techId.moon!, materialId: c.materialId['M-DRAIN']!, quantity: 3, neededDate: clock.day(-2), status: 'CANCELED', createdAt: clock.at(-4, 17), createdBy: c.techId.moon! },
  ]);
}

/* ====================================================================== */
/* 4. 오늘·다가오는 일정 (한국 날짜마다 한 번)                              */
/* ====================================================================== */

async function seedToday(c: Ctx, tag: string) {
  const { db, clock } = c;
  const note = (s: string) => `${tag} ${s}`;
  const W = (n: number) => clock.workday(n);
  const d0 = clock.dow(clock.today) === 0 ? 1 : 0; // 오늘이 일요일이면 "오늘 작업"은 월요일로
  const wall = (q = 1, lvl: 'BASIC' | 'FULL' = 'FULL') => ({ deviceType: 'WALL', cleanLevel: lvl, quantity: q });
  const stand = (q = 1) => ({ deviceType: 'STAND', cleanLevel: 'FULL', quantity: q });
  const hourNow = Number(new Date(clock.now.getTime() + 9 * 3600_000).toISOString().slice(11, 13));
  // 오늘 작업은 진행 상황이 자연스럽도록 현재 시각 기준으로 시간대를 정한다(이른 아침·밤 실행도 고려)
  const base = d0 === 0 ? Math.min(Math.max(hourNow - 2, 8), 13) : 9;

  /* 강팀장: 완료 → 작업중(추가요금 동의 대기) → 출발 전 2건 */
  const k1 = await makeOrder(c, { cust: 'hong', day: d0, hour: base, lines: [wall(1)], status: 'COMPLETED', tech: 'kang', pay: 'PREPAY', inspection: 'NONE', createdDaysBefore: 4, request: '주차는 지하 2층에 해 주세요.', note: note('오늘 완료') });
  const k2 = await makeOrder(c, { cust: 'kim', day: d0, hour: base + 2, lines: [wall(2)], status: 'IN_PROGRESS', tech: 'kang', createdDaysBefore: 5, dirt: 'HIGH', note: note('오늘 작업중 · 추가요금 고객 동의 대기') });
  const k3 = await makeOrder(c, { cust: 'lee', day: d0, hour: base + 4, lines: [stand(1)], status: 'ASSIGNED', tech: 'kang', channel: 'PHONE', createdDaysBefore: 2, request: '방문 30분 전에 전화 주세요.', note: note('오늘 방문 예정(전화 접수)') });
  const k4 = await makeOrder(c, { cust: 'jung', day: d0, hour: Math.min(base + 6, 18), lines: [wall(1, 'BASIC')], options: [{ code: 'OPT-DEODOR', qty: 1 }], status: 'ASSIGNED', tech: 'kang', pay: 'PREPAY', createdDaysBefore: 6, note: note('오늘 방문 예정 · 선결제') });
  // 작업중 주문의 현장 추가요금: 오염 심함(고객 동의 대기) + 기타(관리자 승인 대기)
  if (k2.workOrderId) {
    const ev = await newAttachment(c, 'issue', 'EXTRA_CHARGE', null, { type: 'TECHNICIAN', id: k2.techId }, addMin(k2.promisedAt, 15));
    await db.insert(extraCharge).values([
      { workOrderId: k2.workOrderId, surchargeRuleId: c.ruleId.HEAVY_DIRT!, chargeType: 'RULE', title: '오염 심함', quantity: 2, amount: 40000, reason: '열교환기·드레인판 곰팡이 심함(사진 첨부)', evidenceFileId: ev, approvalStatus: 'NOT_REQUIRED', createdAt: addMin(k2.promisedAt, 16), createdBy: k2.techId },
      { workOrderId: k2.workOrderId, chargeType: 'ETC', title: '실외기 앵글 녹 제거', quantity: 1, amount: 25000, reason: '고객 요청으로 실외기 거치대 녹 제거 작업', approvalStatus: 'REQUESTED', createdAt: addMin(k2.promisedAt, 20), createdBy: k2.techId },
    ]);
    await notify(c, 'EXTRA_CHARGE_REQUEST', { type: 'CUSTOMER', id: k2.customerId, phone: c.cust.kim!.phone }, { type: 'ORDER', id: k2.id }, addMin(k2.promisedAt, 17));
    await notify(c, 'EXTRA_APPROVAL_REQUESTED', { type: 'ADMIN', id: adm(c, 'demo-ops') }, { type: 'ORDER', id: k2.id }, addMin(k2.promisedAt, 21));
  }

  /* 서기사: 작업완료(결제 대기) → 미처리(고객부재) → 이동중 */
  const s1 = await makeOrder(c, { cust: 'han', day: d0, hour: base, lines: [stand(1)], status: 'WORK_DONE', tech: 'seo', pay: 'NONE', createdDaysBefore: 3, note: note('오늘 작업완료 · 결제 대기(작업 후 결제)') });
  const s2 = await makeOrder(c, { cust: 'oh', day: d0, hour: base + 2, lines: [wall(1)], status: 'PENDING', tech: 'seo', pendingReason: 'CUSTOMER_ABSENT', createdDaysBefore: 4, note: note('오늘 미처리(고객부재)') });
  const s3 = await makeOrder(c, { cust: 'seo', day: d0, hour: base + 4, lines: [wall(1), { deviceType: 'WALL', cleanLevel: 'OUTDOOR', quantity: 1 }], status: 'ON_THE_WAY', tech: 'seo', createdDaysBefore: 7, note: note('오늘 기사 이동중') });

  /* 문기사: 이관 요청 중인 오늘 작업 + 다른 1건 */
  const m1 = await makeOrder(c, { cust: 'song', day: d0, hour: Math.min(base + 3, 17), lines: [stand(1)], status: 'ASSIGNED', tech: 'moon', assign: 'TRANSFER_REQUESTED', pay: 'PREPAY', createdDaysBefore: 5, note: note('오늘 방문 · 기사 이관 요청 중(운영자 승인 대기)') });
  const m2 = await makeOrder(c, { cust: 'oh', day: d0, hour: Math.min(base + 5, 18), lines: [{ deviceType: 'WINDOW', cleanLevel: 'BASIC', quantity: 1 }], status: 'ASSIGNED', tech: 'moon', createdDaysBefore: 2, note: note('오늘 방문 예정') });

  /* 분당: 장분당 오늘 작업중, 임분당 다가오는 */
  const j1 = await makeOrder(c, { cust: 'yim', day: d0, hour: base + 1, lines: [wall(1), stand(1)], status: 'IN_PROGRESS', tech: 'jang', createdDaysBefore: 4, note: note('분당 · 오늘 작업중') });

  /* 다가오는 예약 */
  const nx = W(d0 + 1);
  const nx2 = W(nx + 1);
  const u1 = await makeOrder(c, { cust: 'hong', addr: 1, day: nx, hour: 10, lines: [wall(1)], status: 'ASSIGNED', tech: 'kang', pay: 'PREPAY', createdDaysBefore: 3, note: note('다가오는 예약 · 배정 완료') });
  const u2 = await makeOrder(c, { cust: 'park', day: nx, hour: 13, lines: [{ deviceType: 'CEILING_4WAY', cleanLevel: 'FULL', quantity: 3 }], status: 'ASSIGNED', tech: 'kang', channel: 'PHONE', createdDaysBefore: 2, note: note('다가오는 예약 · 사업자 천장형 3대(사업자 단가)') });
  await makeOrder(c, { cust: 'kim', day: nx2, hour: 11, lines: [stand(2)], status: 'RECEIVED', createdDaysBefore: 1, request: '아이가 있어 친환경 세정제 부탁드려요.', note: note('미배정 접수(배정 보드)') });
  await makeOrder(c, { cust: 'jung', day: W(d0 + 2), hour: 15, lines: [wall(1)], status: 'ASSIGN_WAIT', orderType: 'URGENT', createdDaysBefore: 0, note: note('긴급 · 기사 미지정 대기') });
  await makeOrder(c, { cust: 'seo', day: W(d0 + 4), hour: 14, lines: [stand(1)], status: 'RECEIVED', tech: 'seo', assign: 'SELF_REQUESTED', assignMethod: 'SELF', createdDaysBefore: 1, note: note('기사 자가 배정 요청(승인 대기)') });
  const chg = await makeOrder(c, { cust: 'han', day: W(d0 + 3), hour: 10, lines: [wall(1)], status: 'ASSIGNED', tech: 'seo', createdDaysBefore: 2, note: note('고객 일정 변경 요청') });
  const cxl = await makeOrder(c, { cust: 'oh', day: W(d0 + 5), hour: 16, lines: [wall(1, 'BASIC')], status: 'RECEIVED', createdDaysBefore: 1, note: note('고객 취소 요청') });
  await makeOrder(c, { cust: 'song', day: W(d0 + 6), hour: 11, lines: [{ deviceType: 'TWO_IN_ONE', cleanLevel: 'FULL', quantity: 1 }], options: [{ code: 'OPT-ANTIBAC', qty: 1 }], status: 'RECEIVED', pay: 'PREPAY', createdDaysBefore: 0, note: note('선결제 완료 · 미배정') });
  await makeOrder(c, { cust: 'yim', day: W(d0 + 3), hour: 14, lines: [wall(2)], status: 'ASSIGNED', tech: 'lim', pay: 'PREPAY', createdDaysBefore: 2, note: note('분당 · 다가오는 예약') });
  await makeOrder(c, { cust: 'jo', day: W(d0 + 2), hour: 10, lines: [{ deviceType: 'SYSTEM', cleanLevel: 'FULL', quantity: 1 }], status: 'RECEIVED', createdDaysBefore: 1, note: note('분당 · 시스템 에어컨(2인) 미배정') });
  // 야간 방문(평일 19시) — 야간 할증 시험
  const nightDay = (() => {
    for (let n = d0 + 1; n < d0 + 10; n++) {
      const dw = clock.dow(clock.day(n));
      if (dw >= 1 && dw <= 5) return n;
    }
    return d0 + 1;
  })();
  await makeOrder(c, { cust: 'kim', day: nightDay, hour: 19, lines: [wall(1, 'BASIC')], status: 'RECEIVED', createdDaysBefore: 0, note: note('야간 방문(할증)') });

  await db.insert(orderChangeRequest).values([
    { orderId: chg.id, requestType: 'RESCHEDULE', requestedDate: clock.day(W(d0 + 5)), requestedTime: '14:00', reason: '회사 일정이 생겨 날짜를 바꾸고 싶어요.', status: 'REQUESTED', createdAt: addMin(clock.now, -90), createdBy: chg.customerId },
    { orderId: cxl.id, requestType: 'CANCEL', reason: '이사 일정이 당겨져 취소합니다.', status: 'REQUESTED', createdAt: addMin(clock.now, -45), createdBy: cxl.customerId },
  ]);

  /* 코스 (오늘: 진행중/확정, 다음 근무일: 초안) */
  const plan = async (techKey: TechKey, date: string, status: 'DRAFT' | 'CONFIRMED' | 'IN_PROGRESS', jobs: MadeOrder[], changeReq = false) => {
    const techId = c.techId[techKey]!;
    const path = status === 'DRAFT' ? ['DRAFT'] : status === 'CONFIRMED' ? ['DRAFT', 'CONFIRMED'] : ['DRAFT', 'CONFIRMED', 'IN_PROGRESS'];
    for (let i = 1; i < path.length; i++) assertRouteTransition(path[i - 1]!, path[i] as never);
    const home = c.areaByCode.get(DEMO_TECHS.find((t) => t.key === techKey)!.dongs[0] ?? '1138010400')!;
    const prevDay = new Date(`${date}T18:00:00+09:00`).getTime() - DAY_MS;
    const rows = await db
      .insert(routePlan)
      .values({
        technicianId: techId,
        planDate: date,
        status,
        startPointType: 'HOME',
        startLat: home.lat.toFixed(7),
        startLng: home.lng.toFixed(7),
        endPointType: 'HOME',
        totalJobs: jobs.length,
        totalDistanceM: 4200 * jobs.length,
        totalTravelMin: 15 * jobs.length,
        totalWorkMin: jobs.reduce((n, j) => n + j.duration, 0),
        optimizeMethod: 'AUTO',
        optimizedAt: new Date(prevDay - 3 * 3600_000),
        confirmedAt: status === 'DRAFT' ? null : new Date(prevDay - 2 * 3600_000),
        confirmDeadline: new Date(prevDay),
        changeRequestStatus: changeReq ? 'REQUESTED' : null,
        changeRequestNote: changeReq ? '오후 고객 요청으로 3번·4번 순서를 바꾸고 싶습니다.' : null,
        changeRequestedAt: changeReq ? addMin(clock.now, -60) : null,
        createdBy: techId,
      })
      .onConflictDoNothing()
      .returning({ id: routePlan.id });
    if (!rows[0]) return null;
    const ordered = [...jobs].sort((a, b) => a.promisedAt.getTime() - b.promisedAt.getTime());
    for (const [i, j] of ordered.entries()) {
      const [addr] = await db.select({ lat: customerAddress.lat, lng: customerAddress.lng }).from(customerAddress).where(eq(customerAddress.id, j.addressId));
      const st = j.spec.status;
      const stopStatus = ['WORK_DONE', 'COMPLETED'].includes(st) ? 'DONE' : st === 'IN_PROGRESS' ? 'ARRIVED' : st === 'PENDING' ? 'SKIPPED' : 'PLANNED';
      await db.insert(routeStop).values({
        routePlanId: rows[0].id,
        stopSeq: i + 1,
        stopType: 'JOB',
        assignmentId: j.assignmentId,
        orderId: j.id,
        lat: addr!.lat ?? home.lat.toFixed(7),
        lng: addr!.lng ?? home.lng.toFixed(7),
        windowStart: j.promisedAt,
        windowEnd: addMin(j.promisedAt, 120),
        plannedArrival: j.promisedAt,
        plannedDeparture: addMin(j.promisedAt, j.duration),
        notifiedArrival: status === 'DRAFT' ? null : j.promisedAt,
        workMin: j.duration,
        travelMinFromPrev: i === 0 ? 20 : 15,
        distanceMFromPrev: i === 0 ? 5200 : 3800,
        eta: ['PLANNED', 'ARRIVED'].includes(stopStatus) ? addMin(j.promisedAt, 5) : null,
        etaUpdatedAt: ['PLANNED', 'ARRIVED'].includes(stopStatus) && status === 'IN_PROGRESS' ? addMin(clock.now, -5) : null,
        actualArrival: ['DONE', 'ARRIVED'].includes(stopStatus) ? addMin(j.promisedAt, -2) : null,
        actualDeparture: stopStatus === 'DONE' ? addMin(j.promisedAt, j.duration + 10) : null,
        status: stopStatus,
        createdBy: techId,
      });
      if (status !== 'DRAFT') await notify(c, 'VISIT_TIME_NOTICE', { type: 'CUSTOMER', id: j.customerId }, { type: 'ORDER', id: j.id }, new Date(prevDay - 2 * 3600_000 + 60_000));
    }
    if (status === 'DRAFT') await notify(c, 'ROUTE_DRAFT_READY', { type: 'TECHNICIAN', id: techId }, null, addMin(clock.now, -30));
    return rows[0].id;
  };
  const today = clock.day(d0);
  const kangRoute = await plan('kang', today, 'IN_PROGRESS', [k1, k2, k3, k4]);
  const seoRoute = await plan('seo', today, 'IN_PROGRESS', [s1, s2, s3]);
  await plan('moon', today, 'CONFIRMED', [m1, m2], true);
  await plan('jang', today, 'IN_PROGRESS', [j1]);
  await plan('kang', clock.day(nx), 'DRAFT', [u1, u2]);
  if (seoRoute) await notify(c, 'ROUTE_CHANGE_REQUESTED', { type: 'ADMIN', id: adm(c, 'demo-ops') }, null, addMin(clock.now, -60));

  /* 근무 중 기사: 근무 시작 시각 + 오늘 위치 기록 (BR-115 동의 후 근무 중에만) */
  if (d0 === 0) {
    for (const [k, routeId, orders] of [['kang', kangRoute, [k1, k2]], ['seo', seoRoute, [s1, s2, s3]], ['jang', null, [j1]]] as const) {
      const techId = c.techId[k]!;
      const start = clock.at(0, Math.max(base - 1, 7), 30);
      if (start > clock.now) continue;
      await db.update(technician).set({ dutyStartedAt: start }).where(eq(technician.id, techId));
      const home = c.areaByCode.get(DEMO_TECHS.find((t) => t.key === k)!.dongs[0]!)!;
      const target = orders[orders.length - 1]!;
      const [addr] = await db.select({ lat: customerAddress.lat, lng: customerAddress.lng }).from(customerAddress).where(eq(customerAddress.id, target.addressId));
      const tLat = Number(addr!.lat ?? home.lat);
      const tLng = Number(addr!.lng ?? home.lng);
      const pts: (typeof technicianLocation.$inferInsert)[] = [];
      const steps = 12;
      for (let i = 0; i <= steps; i++) {
        const at = new Date(start.getTime() + ((clock.now.getTime() - start.getTime()) * i) / steps);
        pts.push({ technicianId: techId, lat: (home.lat + ((tLat - home.lat) * i) / steps).toFixed(7), lng: (home.lng + ((tLng - home.lng) * i) / steps).toFixed(7), accuracyM: 15, speedKmh: i === steps ? '0.0' : '22.5', routePlanId: routeId, recordedAt: at });
      }
      await db.insert(technicianLocation).values(pts);
    }
  }

  /* 기사 알림: 배정 변경·자가 배정 승인 등 */
  await notify(c, 'TECH_JOB_CHANGED', { type: 'TECHNICIAN', id: c.techId.kang! }, { type: 'ORDER', id: u1.id }, addMin(clock.now, -120));
  await notify(c, 'UNASSIGNED_WARNING', { type: 'ADMIN', id: adm(c, 'demo-ops') }, null, addMin(clock.now, -20));
  void s1;
}
