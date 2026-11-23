import 'server-only';
/**
 * 상담 콘솔 서버 서비스 (02 F-ADM-CSL-01~10·13~16, 03 §4.3 A-CSL-010).
 * 호출하는 서버 액션·페이지가 먼저 requirePermission/requireScreen 으로 화면 권한을 확인하고, 거점 범위(BR-102)는 여기서 branchFilter 로 적용한다.
 * - 견적 금액은 공용 견적 모듈(computeQuote → @aircon/domain calculateQuote) 하나로 계산한다(BR-010~015, 고객 견적·시뮬레이터와 같은 결과).
 * - 주문 상태는 도메인 전이표를 거쳐 order_status_history 에 1행씩 남긴다(BR-024 경로: phoneOrderStatusPath).
 * - 슬롯 차감은 같은 트랜잭션의 조건부 UPDATE(bookSlots, BR-021).
 * - 🔒 연락처·이름·상세주소는 암호화 저장, 목록·헤더는 마스킹(BR-100). 원문 열람은 호출한 쪽이 감사 로그를 남긴다.
 */
import type { PhoneOrderInput, consentAnswerInput, consoleCustomerInput, consoleCustomerUpdateInput, consultRecordInput, z } from '@aircon/contracts';
import {
  adminUser,
  assignment,
  assignmentHistory,
  bookSlots,
  branch,
  callLog,
  consentHistory,
  consultScript,
  consultation,
  customer,
  customerAddress,
  customerTag,
  holiday,
  orderItem,
  orderStatusHistory,
  serviceArea,
  serviceOrder,
  technician,
  timeSlot,
  workSchedule,
} from '@aircon/db';
import {
  type BranchFilter,
  type ConsultStatus,
  type TechBusy,
  ACTIVE_ASSIGN_STATUSES,
  ACTIVE_ORDER_STATUSES,
  OPEN_CONSULT_STATUSES,
  SETTING_KEYS,
  assertConsultTransition,
  availableTechnicians,
  buildTimeTable,
  consentAnswerToStatus,
  consoleAlerts,
  formatConsultNo,
  hourToTime,
  kstDate,
  kstYymmdd,
  maskName,
  maskPhone,
  needsConsentPrompt,
  onCallTechnicians,
  orderStatusHistoryRow,
  phoneOrderStatusPath,
  slotHoursFor,
  slotsNeeded,
  timeTableDates,
  validatePromisedAt,
  visitSurchargeNotice,
} from '@aircon/domain';
import { and, asc, desc, eq, gte, inArray, isNull, like, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { UserError } from './action-result';
import { createCustomer, findCustomerByPhone } from './customers';
import { getDb } from './db';
import { notifyOrder } from './notify';
import { type Actor, type Tx, isUniqueViolation, itemNames, nextOrderNo, scheduleColumns } from './orders';
import { findDuplicateReservations } from './orders';
import { decrypt, encrypt, phoneHash } from './pii';
import { computeQuote, findServiceArea } from './quote';
import { getSettingNumber, getSettingString } from './settings';

type Db = ReturnType<typeof getDb>;

const LIVE_STATUSES = ['ACTIVE', 'DORMANT'];
/** 한국 시각의 시(0~23) */
const kstHour = (d: Date) => (d.getUTCHours() + 9) % 24;

/* ---------- 거점 범위 (BR-102) ---------- */

/** 고객이 관리자 거점 범위 안인지: 전체 범위이거나 그 거점 관할 주소가 있거나, 아직 주소가 하나도 없는 신규 고객 */
export function customerScopeCond(filter: BranchFilter): SQL | undefined {
  if (filter.kind === 'ALL') return undefined;
  if (filter.kind === 'NONE') return sql`false`;
  return sql`(exists (select 1 from customer_address ca where ca.customer_id = ${customer.id} and ca.deleted_at is null and ca.branch_id = ${filter.branchId})
    or not exists (select 1 from customer_address ca where ca.customer_id = ${customer.id} and ca.deleted_at is null))`;
}

export async function assertCustomerInScope(customerId: number, filter: BranchFilter) {
  const [c] = await getDb()
    .select({ id: customer.id })
    .from(customer)
    .where(and(eq(customer.id, customerId), isNull(customer.deletedAt), customerScopeCond(filter)));
  if (!c) throw new UserError('고객을 찾을 수 없거나 조회 권한이 없습니다.');
}

/* ---------- F-ADM-CSL-01 전화번호 고객 조회 (A-CSL-011) ---------- */

export interface ConsoleCustomerMatch {
  id: number;
  customerNo: string;
  nameMasked: string;
  phoneMasked: string;
  phone2Masked: string;
  roadAddress: string | null;
  grade: string;
  privacyAgreeStatus: string;
  lastServiceDate: string | null;
  joinChannel: string;
}

/** 전화1(해시)로 일치 고객 목록. 다른 거점 고객은 개수만 알려 준다 */
export async function searchConsoleCustomers(phone: string, filter: BranchFilter) {
  const db = getDb();
  const base = and(eq(customer.phone1Hash, phoneHash(phone)), inArray(customer.status, LIVE_STATUSES), isNull(customer.deletedAt));
  const rows = await db.select().from(customer).where(and(base, customerScopeCond(filter))).orderBy(asc(customer.id)).limit(50);
  const [all] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(customer).where(base);
  const addrs = rows.length
    ? await db
        .select()
        .from(customerAddress)
        .where(and(inArray(customerAddress.customerId, rows.map((r) => r.id)), isNull(customerAddress.deletedAt)))
        .orderBy(desc(customerAddress.isDefault), desc(customerAddress.updatedAt))
    : [];
  const matches: ConsoleCustomerMatch[] = rows.map((c) => ({
    id: c.id,
    customerNo: c.customerNo,
    nameMasked: maskName(decrypt(c.name)),
    phoneMasked: maskPhone(decrypt(c.phone1)),
    phone2Masked: maskPhone(decrypt(c.phone2)),
    roadAddress: addrs.find((a) => a.customerId === c.id)?.roadAddress ?? null,
    grade: c.grade,
    privacyAgreeStatus: c.privacyAgreeStatus,
    lastServiceDate: c.lastServiceDate,
    joinChannel: c.joinChannel,
  }));
  return { matches, hiddenCount: Math.max((all?.n ?? 0) - matches.length, 0) };
}

/** CTI 연동 전 수기 통화 기록 (01 §2.6.1): 고객을 확정하면 인입 통화 1행 */
export async function startCall(customerId: number, phone: string, actor: Actor, now = new Date()) {
  const [row] = await getDb()
    .insert(callLog)
    .values({
      direction: 'INBOUND',
      callerPhone: encrypt(phone)!,
      callerPhoneHash: phoneHash(phone),
      customerId,
      agentAdminId: actor.id,
      startedAt: now,
      createdBy: actor.id,
      updatedBy: actor.id,
    })
    .returning({ id: callLog.id });
  return row!.id;
}

/* ---------- 고객 확정 → 콘솔 상단·하단 (A-CSL-010, F-ADM-CSL-03·04·14) ---------- */

export async function getConsoleCustomer(customerId: number, filter: BranchFilter, now = new Date()) {
  const db = getDb();
  const [c] = await db
    .select()
    .from(customer)
    .where(and(eq(customer.id, customerId), isNull(customer.deletedAt), customerScopeCond(filter)));
  if (!c) throw new UserError('고객을 찾을 수 없거나 조회 권한이 없습니다.');
  const todayStart = new Date(`${kstDate(now)}T00:00:00+09:00`);
  const [addresses, tags, lastConsent, consults, orders, reaskMonths] = await Promise.all([
    db
      .select({ a: customerAddress, branchName: branch.name })
      .from(customerAddress)
      .leftJoin(branch, eq(branch.id, customerAddress.branchId))
      .where(and(eq(customerAddress.customerId, customerId), isNull(customerAddress.deletedAt)))
      .orderBy(desc(customerAddress.isDefault), desc(customerAddress.updatedAt)),
    db.select({ tagCode: customerTag.tagCode }).from(customerTag).where(eq(customerTag.customerId, customerId)),
    db
      .select({ createdAt: consentHistory.createdAt })
      .from(consentHistory)
      .where(and(eq(consentHistory.customerId, customerId), eq(consentHistory.consentType, 'PRIVACY_REQUIRED'), inArray(consentHistory.action, ['AGREE', 'DISAGREE', 'WITHDRAW'])))
      .orderBy(desc(consentHistory.createdAt))
      .limit(1),
    db.select().from(consultation).where(eq(consultation.customerId, customerId)).orderBy(desc(consultation.createdAt)).limit(200),
    customerOrders(customerId),
    getSettingNumber(SETTING_KEYS.PRIVACY_REASK_MONTHS),
  ]);
  const open = consults.filter((x) => (OPEN_CONSULT_STATUSES as readonly string[]).includes(x.status));
  const claims = consults.filter((x) => x.consultType === 'CLAIM');
  return {
    customer: {
      id: c.id,
      customerNo: c.customerNo,
      customerType: c.customerType,
      nameMasked: maskName(decrypt(c.name)),
      phoneMasked: maskPhone(decrypt(c.phone1)),
      phone2Masked: maskPhone(decrypt(c.phone2)),
      grade: c.grade,
      tags: tags.map((t) => t.tagCode),
      privacyAgreeStatus: c.privacyAgreeStatus,
      happycallReject: c.happycallReject,
      lastServiceDate: c.lastServiceDate,
      joinChannel: c.joinChannel,
      hasAppLogin: c.authProvider !== null,
      memo: c.memo,
    },
    addresses: addresses.map(({ a, branchName }) => ({
      id: a.id,
      roadAddress: a.roadAddress,
      jibunAddress: a.jibunAddress,
      zipcode: a.zipcode,
      legalDongCode: a.legalDongCode,
      branchId: a.branchId,
      branchName,
      housingType: a.housingType,
      hasElevator: a.hasElevator,
      parkingNote: a.parkingNote,
      isDefault: a.isDefault,
    })),
    needsConsent: needsConsentPrompt({ status: c.privacyAgreeStatus, lastAnsweredAt: lastConsent[0]?.createdAt ?? null, now, reaskMonths }),
    alerts: consoleAlerts({
      openConsults: open.filter((x) => x.consultType !== 'CLAIM').length,
      openClaims: open.filter((x) => x.consultType === 'CLAIM').length,
      todayConsults: consults.filter((x) => x.createdAt >= todayStart).length,
    }),
    orders,
    claims: claims.map(consultRow),
  };
}

const consultRow = (x: typeof consultation.$inferSelect) => ({
  id: x.id,
  consultNo: x.consultNo,
  consultType: x.consultType,
  subType: x.subType,
  status: x.status,
  content: x.content,
  relatedOrderId: x.relatedOrderId,
  createdAt: x.createdAt,
  completedAt: x.completedAt,
});

/** F-ADM-CSL-14 작업이력: 고객 주문 + 담당 기사 + 기기 요약 */
async function customerOrders(customerId: number) {
  const db = getDb();
  const orders = await db
    .select()
    .from(serviceOrder)
    .where(and(eq(serviceOrder.customerId, customerId), isNull(serviceOrder.deletedAt)))
    .orderBy(desc(serviceOrder.createdAt))
    .limit(100);
  if (orders.length === 0) return [];
  const ids = orders.map((o) => o.id);
  const [items, techs] = await Promise.all([
    db.select().from(orderItem).where(and(inArray(orderItem.orderId, ids), eq(orderItem.itemType, 'PRODUCT'))),
    db
      .select({ orderId: assignment.orderId, name: technician.name })
      .from(assignment)
      .innerJoin(technician, eq(technician.id, assignment.technicianId))
      .where(and(inArray(assignment.orderId, ids), eq(assignment.role, 'MAIN'), inArray(assignment.status, ['ACCEPTED', 'PROPOSED', 'TRANSFER_REQUESTED']))),
  ]);
  const nameOf = await itemNames(null);
  return orders.map((o) => ({
    id: o.id,
    orderNo: o.orderNo,
    status: o.status,
    orderType: o.orderType,
    channel: o.channel,
    promisedAt: o.promisedAt,
    completedAt: o.completedAt,
    pendingReason: o.pendingReason,
    totalAmount: o.totalAmount,
    devices: items
      .filter((i) => i.orderId === o.id)
      .map((i) => `${nameOf(i)} ${i.quantity}대`)
      .join(', '),
    technicianName: techs.find((t) => t.orderId === o.id)?.name ?? null,
    customerRequest: o.customerRequest,
    internalNote: o.internalNote,
  }));
}

/** [보기] 원문 (호출 전 감사 로그) */
export async function revealConsoleCustomer(customerId: number, filter: BranchFilter) {
  const [c] = await getDb()
    .select({ name: customer.name, phone1: customer.phone1, phone2: customer.phone2 })
    .from(customer)
    .where(and(eq(customer.id, customerId), customerScopeCond(filter)));
  if (!c) throw new UserError('고객을 찾을 수 없거나 조회 권한이 없습니다.');
  return { name: decrypt(c.name) ?? '', phone1: decrypt(c.phone1) ?? '', phone2: decrypt(c.phone2) ?? '' };
}

/* ---------- F-ADM-CSL-02 신규 고객 등록 (A-CSL-012) · F-ADM-CSL-15 고객정보 수정 (A-CSL-014) ---------- */

type AddressIn = z.output<typeof consoleCustomerInput>['address'] & {
  detailAddress: string;
  housingType: string | null;
  hasElevator: boolean;
  parkingNote: string | null;
};

/** 주소 정제 결과 저장: 법정동 → 관할 거점 자동 매핑(BR-001). 비서비스 지역 주소도 저장은 한다(접수 시 막힘) */
async function insertAddress(tx: Tx | Db, customerId: number, a: AddressIn, isDefault: boolean, actorId: number | null) {
  const area = await findServiceArea(a.legalDongCode);
  const [row] = await tx
    .insert(customerAddress)
    .values({
      customerId,
      zipcode: a.zipcode,
      roadAddress: a.roadAddress,
      jibunAddress: a.jibunAddress,
      detailAddress: encrypt(a.detailAddress),
      legalDongCode: a.legalDongCode,
      housingType: a.housingType,
      hasElevator: a.hasElevator,
      parkingNote: a.parkingNote,
      branchId: area.serviceable ? area.branchId : null,
      isDefault,
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning({ id: customerAddress.id });
  return row!.id;
}

/** A-CSL-012 주소정제 단계: 관할 확인 (서비스 가능 여부·거점) */
export async function refineAddress(legalDongCode: string, filter: BranchFilter) {
  const area = await findServiceArea(legalDongCode);
  const db = getDb();
  const [b] = area.branchId ? await db.select({ name: branch.name }).from(branch).where(eq(branch.id, area.branchId)) : [];
  const outOfScope = filter.kind === 'NONE' || (filter.kind === 'BRANCH' && area.branchId !== null && filter.branchId !== area.branchId);
  return { serviceable: area.serviceable, branchName: b?.name ?? null, outOfScope };
}

export async function registerConsoleCustomer(input: z.output<typeof consoleCustomerInput>, filter: BranchFilter, actor: Actor) {
  if (await findCustomerByPhone(input.phone1)) throw new UserError('같은 전화번호의 고객이 이미 있습니다. 고객 목록에서 선택해 주세요.');
  const ref = await refineAddress(input.address.legalDongCode, filter);
  if (ref.outOfScope) throw new UserError('다른 거점 관할 주소의 고객은 등록할 수 없습니다.');
  const customerId = await createCustomer({
    name: input.name,
    phone: input.phone1,
    joinChannel: 'PHONE',
    authProvider: null,
    authProviderKey: null,
    consents: null, // 개인정보 동의는 A-CSL-013 팝업에서 구두로 받는다(BR-023)
    customerType: input.customerType,
    actorId: actor.id,
  });
  const db = getDb();
  await db.transaction(async (tx) => {
    if (input.phone2) await tx.update(customer).set({ phone2: encrypt(input.phone2) }).where(eq(customer.id, customerId));
    await insertAddress(tx, customerId, { ...input.address, ...input }, true, actor.id);
  });
  return customerId;
}

export async function updateConsoleCustomer(input: z.output<typeof consoleCustomerUpdateInput>, filter: BranchFilter, actor: Actor) {
  await assertCustomerInScope(input.customerId, filter);
  const other = await findCustomerByPhone(input.phone1);
  if (other && other.id !== input.customerId) throw new UserError('같은 전화번호의 다른 고객이 있어 바꿀 수 없습니다.');
  if (input.newAddress) {
    const ref = await refineAddress(input.newAddress.address.legalDongCode, filter);
    if (ref.outOfScope) throw new UserError('다른 거점 관할 주소는 등록할 수 없습니다.');
  }
  await getDb().transaction(async (tx) => {
    await tx
      .update(customer)
      .set({
        name: encrypt(input.name)!,
        phone1: encrypt(input.phone1)!,
        phone1Hash: phoneHash(input.phone1),
        phone2: encrypt(input.phone2),
        happycallReject: input.happycallReject,
        updatedAt: new Date(),
        updatedBy: actor.id,
      })
      .where(eq(customer.id, input.customerId));
    if (input.newAddress) {
      await tx.update(customerAddress).set({ isDefault: false }).where(eq(customerAddress.customerId, input.customerId));
      await insertAddress(tx, input.customerId, { ...input.newAddress.address, ...input.newAddress }, true, actor.id);
    }
  });
}

/* ---------- F-ADM-CSL-03 개인정보 동의 (A-CSL-013, BR-023) ---------- */

export async function recordPrivacyConsent(input: z.output<typeof consentAnswerInput>, filter: BranchFilter, actor: Actor) {
  await assertCustomerInScope(input.customerId, filter);
  const db = getDb();
  const [c] = await db.select({ status: customer.privacyAgreeStatus }).from(customer).where(eq(customer.id, input.customerId));
  if (input.action === 'WITHDRAW' && c?.status !== 'AGREED') throw new UserError('동의한 고객만 철회할 수 있습니다.');
  const termsVersion = await getSettingString(SETTING_KEYS.TERMS_VERSION);
  const status = consentAnswerToStatus(input.action);
  await db.transaction(async (tx) => {
    // consent_history 는 INSERT ONLY (CLAUDE.md §5)
    await tx.insert(consentHistory).values({
      customerId: input.customerId,
      consentType: 'PRIVACY_REQUIRED',
      action: input.action,
      channel: 'PHONE',
      termsVersion,
      agentAdminId: actor.id,
      callLogId: input.callLogId,
    });
    await tx
      .update(customer)
      .set({
        privacyAgreeStatus: status,
        // ERD §6 철회 시 마케팅 발송 즉시 중단
        ...(input.action === 'WITHDRAW' ? { marketingAgree: false } : {}),
        updatedAt: new Date(),
        updatedBy: actor.id,
      })
      .where(eq(customer.id, input.customerId));
  });
  return status;
}

/* ---------- F-ADM-CSL-16 상담 스크립트 ---------- */

export async function activeScripts() {
  return getDb()
    .select({ scriptCode: consultScript.scriptCode, title: consultScript.title, content: consultScript.content, triggerPoint: consultScript.triggerPoint })
    .from(consultScript)
    .where(eq(consultScript.isActive, true))
    .orderBy(asc(consultScript.scriptCode));
}

/* ---------- ③ 거점·지역 현황 ---------- */

export async function branchStatus(branchId: number, now = new Date()) {
  const db = getDb();
  const today = kstDate(now);
  const [[b], [areas], counts, techs, schedules] = await Promise.all([
    db.select({ id: branch.id, name: branch.name }).from(branch).where(eq(branch.id, branchId)),
    db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(serviceArea)
      .where(and(eq(serviceArea.branchId, branchId), eq(serviceArea.isServiceable, true))),
    db
      .select({ status: serviceOrder.status, n: sql<number>`count(*)`.mapWith(Number) })
      .from(serviceOrder)
      .where(and(eq(serviceOrder.branchId, branchId), inArray(serviceOrder.status, ['ASSIGN_WAIT', 'PENDING']), isNull(serviceOrder.deletedAt)))
      .groupBy(serviceOrder.status),
    branchTechs(branchId),
    db
      .select()
      .from(workSchedule)
      .innerJoin(technician, eq(technician.id, workSchedule.technicianId))
      .where(and(eq(technician.branchId, branchId), eq(workSchedule.workDate, today))),
  ]);
  if (!b) throw new UserError('거점을 찾을 수 없습니다.');
  const sch = schedules.map((r) => r.work_schedule);
  const working = new Set(sch.filter((s) => ['WORK', 'HALF_AM', 'HALF_PM'].includes(s.scheduleType)).map((s) => s.technicianId));
  return {
    branchId: b.id,
    branchName: b.name,
    areaCount: areas?.n ?? 0,
    assignWait: counts.find((c) => c.status === 'ASSIGN_WAIT')?.n ?? 0,
    pending: counts.find((c) => c.status === 'PENDING')?.n ?? 0,
    onCallToday: onCallTechnicians(techs, sch, today).length,
    workingToday: techs.filter((t) => working.has(t.id)).length,
  };
}

async function branchTechs(branchId: number) {
  return getDb()
    .select({ id: technician.id, name: technician.name, grade: technician.grade })
    .from(technician)
    .where(and(eq(technician.branchId, branchId), eq(technician.status, 'ACTIVE'), isNull(technician.deletedAt)))
    .orderBy(asc(technician.name));
}

/* ---------- F-ADM-CSL-06 Time Table (A-CSL-021) ---------- */

export async function loadTimeTable(branchId: number, start: string, now = new Date()) {
  const db = getDb();
  const dates = timeTableDates(start);
  const [slots, hol] = await Promise.all([
    db
      .select()
      .from(timeSlot)
      .where(and(eq(timeSlot.branchId, branchId), gte(timeSlot.slotDate, dates[0]!), lte(timeSlot.slotDate, dates[6]!))),
    db
      .select({ d: holiday.holidayDate })
      .from(holiday)
      .where(and(gte(holiday.holidayDate, dates[0]!), lte(holiday.holidayDate, dates[6]!))),
  ]);
  return buildTimeTable({ dates, slots, holidays: hol.map((h) => h.d), now });
}

/* ---------- F-ADM-CSL-07 출장 가능 기사 (A-CSL-022) · F-ADM-CSL-08 휴일 근무 기사 (A-CSL-023) ---------- */

/** 그날 기사별 약속(배정) 시간 */
async function busyOn(tx: Tx | Db, techIds: number[], date: string): Promise<TechBusy[]> {
  if (techIds.length === 0) return [];
  const from = new Date(`${date}T00:00:00+09:00`);
  const to = new Date(from.getTime() + 24 * 3600_000);
  const rows = await tx
    .select({ technicianId: assignment.technicianId, start: assignment.scheduledStart, end: assignment.scheduledEnd })
    .from(assignment)
    .innerJoin(serviceOrder, eq(serviceOrder.id, assignment.orderId))
    .where(
      and(
        inArray(assignment.technicianId, techIds),
        inArray(assignment.status, [...ACTIVE_ASSIGN_STATUSES]),
        inArray(serviceOrder.status, [...ACTIVE_ORDER_STATUSES]),
        gte(assignment.scheduledStart, from),
        lt(assignment.scheduledStart, to),
      ),
    );
  return rows
    .filter((r) => r.technicianId !== null && r.start !== null)
    .map((r) => {
      const fromHour = kstHour(r.start!);
      const toHour = r.end ? Math.max(Math.ceil((r.end.getTime() - r.start!.getTime()) / 3600_000), 1) + fromHour : fromHour + 1;
      return { technicianId: r.technicianId!, fromHour, toHour };
    });
}

async function slotDefaults() {
  const [defaultStart, defaultEnd] = await Promise.all([
    getSettingString(SETTING_KEYS.WORK_DEFAULT_START),
    getSettingString(SETTING_KEYS.WORK_DEFAULT_END),
  ]);
  return { defaultStart, defaultEnd };
}

export async function listAvailableTechs(branchId: number, date: string, hour: number, needHours: number, tx: Tx | Db = getDb()) {
  const techs = await branchTechs(branchId);
  const ids = techs.map((t) => t.id);
  const [schedules, busy, defaults] = await Promise.all([
    ids.length ? tx.select().from(workSchedule).where(and(inArray(workSchedule.technicianId, ids), eq(workSchedule.workDate, date))) : Promise.resolve([]),
    busyOn(tx, ids, date),
    slotDefaults(),
  ]);
  return availableTechnicians({ techs, schedules, busy, startHour: hour, needHours, defaults });
}

export async function listOnCallTechs(branchId: number, date: string) {
  const techs = await branchTechs(branchId);
  const ids = techs.map((t) => t.id);
  const schedules = ids.length
    ? await getDb().select().from(workSchedule).where(and(inArray(workSchedule.technicianId, ids), eq(workSchedule.workDate, date)))
    : [];
  return onCallTechnicians(techs, schedules, date).map((t) => {
    const s = schedules.find((x) => x.technicianId === t.id)!;
    return { ...t, startTime: s.startTime, endTime: s.endTime, note: s.note };
  });
}

/* ---------- F-ADM-CSL-05 출장접수 (A-CSL-020) ---------- */

async function loadVisitAddress(customerId: number, addressId: number) {
  const [a] = await getDb()
    .select()
    .from(customerAddress)
    .where(and(eq(customerAddress.id, addressId), eq(customerAddress.customerId, customerId), isNull(customerAddress.deletedAt)));
  if (!a) throw new UserError('방문 주소를 찾을 수 없습니다.');
  if (!a.legalDongCode) throw new UserError('주소 정제가 끝나지 않은 주소입니다. 고객정보 수정에서 주소를 다시 등록해 주세요.');
  const area = await findServiceArea(a.legalDongCode);
  if (!area.serviceable || !area.branchId) throw new UserError('서비스 지역이 아닙니다.');
  return { address: a, branchId: area.branchId };
}

function assertBranchScope(filter: BranchFilter, branchId: number) {
  if (filter.kind === 'NONE' || (filter.kind === 'BRANCH' && filter.branchId !== branchId)) throw new UserError('다른 거점 관할 주소는 접수할 수 없습니다.');
}

const quoteFailure = (reason: string) =>
  reason === 'NO_LINES' ? '기기 형태는 필수 입력값입니다.' : reason === 'NOT_SERVICEABLE' ? '서비스 지역이 아닙니다.' : '견적을 산출할 수 없습니다. 상품·가격 등록을 확인하세요.';

/** 자동 견적(공용 모듈) + 약속일시 할증 안내(BR-011·012). 약속일시가 없으면 할증 없이 */
export async function previewPhoneOrder(
  input: { customerId: number; addressId: number; lines: PhoneOrderInput['lines']; options: PhoneOrderInput['options']; slotDate: string | null; slotHour: number | null },
  filter: BranchFilter,
  now = new Date(),
) {
  await assertCustomerInScope(input.customerId, filter);
  const { address, branchId } = await loadVisitAddress(input.customerId, input.addressId);
  assertBranchScope(filter, branchId);
  const [c] = await getDb().select({ t: customer.customerType }).from(customer).where(eq(customer.id, input.customerId));
  const visit = input.slotDate && input.slotHour !== null ? { date: input.slotDate, time: hourToTime(input.slotHour) } : null;
  const r = await computeQuote(
    { legalDongCode: address.legalDongCode!, lines: input.lines, options: input.options, customerType: (c?.t ?? 'PERSONAL') as 'PERSONAL' | 'BUSINESS', visit },
    now,
  );
  if (!r.ok) throw new UserError(quoteFailure(r.reason));
  const time = r.snapshot.items.find((i) => i.itemType === 'SURCHARGE' && (i.ruleCode === 'NIGHT' || i.ruleCode === 'HOLIDAY'));
  return {
    branchId,
    subtotalAmount: r.subtotalAmount,
    discountAmount: r.discountAmount,
    surchargeAmount: r.surchargeAmount,
    totalAmount: r.totalAmount,
    durationMin: r.estimatedDurationMin,
    needHours: slotsNeeded(r.estimatedDurationMin),
    items: r.items.map((i, k) => ({ name: r.snapshot.items[k]?.name ?? i.itemType, itemType: i.itemType, quantity: i.quantity, amount: i.amount })),
    visitType: time?.ruleCode ?? 'IN_HOURS',
    surchargeNotice: visitSurchargeNotice(time ? { ruleCode: time.ruleCode!, amount: time.amount } : null),
  };
}

/** F-ADM-CSL-10 이중접수 고객 리스트 (A-CSL-024): 같은 전화번호·같은 주소·같은 고객의 미완료 주문 (BR-020) */
export async function findPhoneDuplicates(customerId: number, addressId: number) {
  const db = getDb();
  const [c] = await db.select({ phone: customer.phone1 }).from(customer).where(eq(customer.id, customerId));
  const [a] = await db.select().from(customerAddress).where(eq(customerAddress.id, addressId));
  if (!c || !a) return [];
  const dup = await findDuplicateReservations({
    customerId,
    phone: decrypt(c.phone),
    roadAddress: a.roadAddress,
    detailAddress: decrypt(a.detailAddress),
  });
  if (dup.length === 0) return [];
  const rows = await db
    .select({ orderNo: serviceOrder.orderNo, status: serviceOrder.status, promisedAt: serviceOrder.promisedAt, channel: serviceOrder.channel, roadAddress: customerAddress.roadAddress, createdAt: serviceOrder.createdAt })
    .from(serviceOrder)
    .innerJoin(customerAddress, eq(customerAddress.id, serviceOrder.addressId))
    .where(inArray(serviceOrder.orderNo, dup.map((d) => d.orderNo)))
    .orderBy(desc(serviceOrder.createdAt));
  return rows;
}

/** 그날 다음 상담 번호 (J + YYMMDD + 4자리) */
async function nextConsultNo(tx: Tx, now: Date, bump = 0) {
  const prefix = `J${kstYymmdd(now)}`;
  const [last] = await tx
    .select({ no: consultation.consultNo })
    .from(consultation)
    .where(like(consultation.consultNo, `${prefix}%`))
    .orderBy(desc(consultation.consultNo))
    .limit(1);
  return formatConsultNo(now, (last ? Number(last.no.slice(prefix.length)) : 0) + 1 + bump);
}

async function insertConsultation(
  tx: Tx,
  now: Date,
  bump: number,
  v: { customerId: number; callLogId: number | null; consultType: string; subType: string | null; relatedOrderId: number | null; content: string | null; status: ConsultStatus },
  actor: Actor,
) {
  assertConsultTransition(null, v.status);
  const consultNo = await nextConsultNo(tx, now, bump);
  const [row] = await tx
    .insert(consultation)
    .values({
      consultNo,
      customerId: v.customerId,
      callLogId: v.callLogId,
      channel: 'PHONE',
      consultType: v.consultType,
      subType: v.subType,
      relatedOrderId: v.relatedOrderId,
      content: v.content,
      status: v.status,
      agentAdminId: actor.id,
      completedAt: v.status === 'DONE' ? now : null,
      createdBy: actor.id,
      updatedBy: actor.id,
    })
    .returning({ id: consultation.id });
  return { id: row!.id, consultNo };
}

export type PhoneOrderResult =
  | { ok: true; orderId: number; orderNo: string; status: string }
  | { ok: false; duplicates: Awaited<ReturnType<typeof findPhoneDuplicates>> };

/**
 * F-ADM-CSL-05 출장접수 저장: 견적(공용) → 상담(ORDER, 완료) + 주문(channel=PHONE, consultation_id) + 항목 + 상태 이력(BR-024 경로)
 * → 슬롯 차감(BR-021, 필요 인원만큼) → 기사 선택 시 배정(MANUAL)·배정 이력 → 접수 알림.
 * 이중접수(BR-020)는 duplicateConfirmed=false 면 먼저 리스트를 돌려준다(A-CSL-024 [접수저장]이면 true 로 다시 호출).
 */
export async function createPhoneOrder(input: PhoneOrderInput, filter: BranchFilter, actor: Actor, now = new Date()): Promise<PhoneOrderResult> {
  await assertCustomerInScope(input.customerId, filter);
  const past = validatePromisedAt(input.slotDate, input.slotHour, now);
  if (past) throw new UserError(past);
  const { address, branchId } = await loadVisitAddress(input.customerId, input.addressId);
  assertBranchScope(filter, branchId);
  if (!input.duplicateConfirmed) {
    const duplicates = await findPhoneDuplicates(input.customerId, input.addressId);
    if (duplicates.length) return { ok: false, duplicates };
  }
  const db = getDb();
  const [c] = await db.select({ t: customer.customerType }).from(customer).where(eq(customer.id, input.customerId));
  const r = await computeQuote(
    {
      legalDongCode: address.legalDongCode!,
      lines: input.lines,
      options: input.options,
      customerType: (c?.t ?? 'PERSONAL') as 'PERSONAL' | 'BUSINESS',
      visit: { date: input.slotDate, time: hourToTime(input.slotHour) },
    },
    now,
  );
  if (!r.ok) throw new UserError(quoteFailure(r.reason));
  const requiredTechCount = input.twoPerson ? 2 : 1;
  const needHours = slotsNeeded(r.estimatedDurationMin);
  if (input.technicianId) {
    const t = (await listAvailableTechs(branchId, input.slotDate, input.slotHour, needHours)).find((x) => x.id === input.technicianId);
    if (!t) throw new UserError('선택한 기사는 이 거점에서 그날 근무하지 않습니다.');
    if (!t.available) throw new UserError('선택한 기사는 그 시간에 출장할 수 없습니다. 다른 기사를 고르거나 미지정으로 저장하세요.');
  }
  const timeRule = r.snapshot.items.find((i) => i.itemType === 'SURCHARGE' && (i.ruleCode === 'NIGHT' || i.ruleCode === 'HOLIDAY'));
  const sched = scheduleColumns(input.slotDate, input.slotHour, r.estimatedDurationMin);
  const hours = slotHoursFor(input.slotHour, r.estimatedDurationMin);
  const path = phoneOrderStatusPath({ technicianSelected: input.technicianId !== null, requiredTechCount });
  const content = [
    input.brand || input.modelName ? `[기기] ${[input.brand, input.modelName].filter(Boolean).join(' ')}` : null,
    input.requestedDate ? `[요구일시] ${input.requestedDate}${input.requestedTime ? ` ${input.requestedTime}` : ''}` : null,
    input.customerRequest ? `[요청사항] ${input.customerRequest}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  for (let attempt = 0; ; attempt++) {
    try {
      const out = await db.transaction(async (tx) => {
        const cons = await insertConsultation(
          tx,
          now,
          attempt,
          { customerId: input.customerId, callLogId: input.callLogId, consultType: 'ORDER', subType: input.symptom, relatedOrderId: null, content: content || null, status: 'DONE' },
          actor,
        );
        const orderNo = await nextOrderNo(tx, now, attempt);
        const [o] = await tx
          .insert(serviceOrder)
          .values({
            orderNo,
            customerId: input.customerId,
            addressId: input.addressId,
            branchId,
            consultationId: cons.id,
            channel: 'PHONE',
            orderType: input.orderType,
            status: path[0]!,
            ...sched,
            visitType: timeRule?.ruleCode ?? 'IN_HOURS',
            requiredTechCount,
            customerRequest: input.customerRequest,
            internalNote: input.internalNote,
            subtotalAmount: r.subtotalAmount,
            discountAmount: r.discountAmount,
            surchargeAmount: r.surchargeAmount,
            totalAmount: r.totalAmount,
            paymentStatus: 'UNPAID',
            isDuplicateChecked: true,
            createdBy: actor.id,
            updatedBy: actor.id,
          })
          .returning({ id: serviceOrder.id });
        const orderId = o!.id;
        await tx.update(consultation).set({ relatedOrderId: orderId }).where(eq(consultation.id, cons.id));
        await tx.insert(orderItem).values(r.items.map((i) => ({ ...i, orderId })));
        // 상태 이력: 경로의 각 단계마다 1행 (도메인 전이표 검사 포함)
        let from: string | null = null;
        for (const to of path) {
          await tx.insert(orderStatusHistory).values(
            orderStatusHistoryRow({ orderId, from, to, actorType: actor.type, actorId: actor.id, reasonCode: null, memo: from === null ? '전화 접수(상담 콘솔)' : '상담원 기사 선택' }),
          );
          from = to;
        }
        if (!(await bookSlots(tx, { branchId, slotDate: input.slotDate, hours, units: requiredTechCount }))) {
          throw new UserError('선택한 시간에 남은 자리가 없습니다. Time Table에서 다른 시간을 골라 주세요.');
        }
        if (input.technicianId) {
          // 같은 시각에 다른 상담원이 먼저 배정했는지 트랜잭션 안에서 다시 확인
          const again = (await listAvailableTechs(branchId, input.slotDate, input.slotHour, needHours, tx)).find((x) => x.id === input.technicianId);
          if (!again?.available) throw new UserError('방금 다른 접수에 배정된 기사입니다. 다른 기사를 고르거나 미지정으로 저장하세요.');
          const [slot] = await tx
            .select({ id: timeSlot.id })
            .from(timeSlot)
            .where(and(eq(timeSlot.branchId, branchId), eq(timeSlot.slotDate, input.slotDate), eq(timeSlot.slotHour, input.slotHour), eq(timeSlot.slotKind, 'NORMAL')));
          await tx.insert(assignment).values({
            orderId,
            technicianId: input.technicianId,
            role: 'MAIN',
            timeSlotId: slot?.id ?? null,
            scheduledStart: sched.promisedAt,
            scheduledEnd: new Date(sched.promisedAt.getTime() + needHours * 3600_000),
            assignMethod: 'MANUAL',
            status: 'ACCEPTED',
            assignedBy: actor.id,
            createdBy: actor.id,
            updatedBy: actor.id,
          });
          await tx.insert(assignmentHistory).values({ orderId, fromTechnicianId: null, toTechnicianId: input.technicianId, action: 'ASSIGN', reason: '상담 콘솔 출장접수', actorType: actor.type, actorId: actor.id });
        }
        if (input.frequent) {
          await tx
            .insert(customerTag)
            .values({ customerId: input.customerId, tagCode: 'FREQUENT', createdBy: actor.id, updatedBy: actor.id })
            .onConflictDoNothing();
        }
        if (input.callLogId) await tx.update(callLog).set({ endedAt: now, updatedAt: now, updatedBy: actor.id }).where(eq(callLog.id, input.callLogId));
        return { orderId, orderNo, status: path[path.length - 1]! };
      });
      await notifyOrder('ORDER_CONFIRMED', out.orderId);
      return { ok: true, ...out };
    } catch (e) {
      if (isUniqueViolation(e) && attempt < 4) continue;
      throw e;
    }
  }
}

/* ---------- F-ADM-CSL-13 일반문의·클레임 (A-CSL-050) ---------- */

/**
 * 상담 내용 기록. 일반문의는 [처리 완료]면 DONE, 아니면 OPEN. 클레임은 OPEN 으로 남겨 다음 통화 때 Alert(BR-022)한다.
 * VOC 테이블(01 §2.6.6)·VOC 생성은 단계 8에서 붙인다.
 */
export async function recordConsult(input: z.output<typeof consultRecordInput>, filter: BranchFilter, actor: Actor, now = new Date()) {
  await assertCustomerInScope(input.customerId, filter);
  if (input.relatedOrderId) {
    const [o] = await getDb()
      .select({ id: serviceOrder.id })
      .from(serviceOrder)
      .where(and(eq(serviceOrder.id, input.relatedOrderId), eq(serviceOrder.customerId, input.customerId)));
    if (!o) throw new UserError('관련 주문을 찾을 수 없습니다.');
  }
  const status: ConsultStatus = input.consultType === 'INQUIRY' && input.done ? 'DONE' : 'OPEN';
  for (let attempt = 0; ; attempt++) {
    try {
      return await getDb().transaction(async (tx) => {
        const r = await insertConsultation(
          tx,
          now,
          attempt,
          { customerId: input.customerId, callLogId: input.callLogId, consultType: input.consultType, subType: input.subType, relatedOrderId: input.relatedOrderId, content: input.content, status },
          actor,
        );
        if (input.callLogId) await tx.update(callLog).set({ endedAt: now, updatedAt: now, updatedBy: actor.id }).where(eq(callLog.id, input.callLogId));
        return r;
      });
    } catch (e) {
      if (isUniqueViolation(e) && attempt < 4) continue;
      throw e;
    }
  }
}

/* ---------- A-CSL-070 상담 이력 조회 ---------- */

export interface ConsultListQuery {
  dateFrom: string | null;
  dateTo: string | null;
  consultType: string | null;
  status: string | null;
  agentId: number | null;
  keyword: string | null;
}

export async function listConsultations(filter: BranchFilter, q: ConsultListQuery, limit = 500) {
  const kw = q.keyword?.replace(/\s/g, '') ?? '';
  const digits = kw.replace(/-/g, '');
  const kwCond =
    kw === ''
      ? undefined
      : /^0\d{8,10}$/.test(digits)
        ? eq(customer.phone1Hash, phoneHash(digits))
        : or(like(consultation.consultNo, `%${kw.toUpperCase()}%`), like(customer.customerNo, `%${kw.toUpperCase()}%`), like(serviceOrder.orderNo, `%${kw.toUpperCase()}%`));
  const rows = await getDb()
    .select({
      c: consultation,
      customerNo: customer.customerNo,
      name: customer.name,
      orderNo: serviceOrder.orderNo,
      agentName: adminUser.name,
    })
    .from(consultation)
    .leftJoin(customer, eq(customer.id, consultation.customerId))
    .leftJoin(serviceOrder, eq(serviceOrder.id, consultation.relatedOrderId))
    .leftJoin(adminUser, eq(adminUser.id, consultation.agentAdminId))
    .where(
      and(
        filter.kind === 'ALL' ? undefined : customerScopeCond(filter),
        q.dateFrom ? gte(consultation.createdAt, new Date(`${q.dateFrom}T00:00:00+09:00`)) : undefined,
        q.dateTo ? lt(consultation.createdAt, new Date(new Date(`${q.dateTo}T00:00:00+09:00`).getTime() + 24 * 3600_000)) : undefined,
        q.consultType ? eq(consultation.consultType, q.consultType) : undefined,
        q.status ? eq(consultation.status, q.status) : undefined,
        q.agentId ? eq(consultation.agentAdminId, q.agentId) : undefined,
        kwCond,
      ),
    )
    .orderBy(desc(consultation.createdAt))
    .limit(limit);
  // 목록은 항상 마스킹 (BR-100)
  return rows.map((r) => ({
    ...consultRow(r.c),
    customerId: r.c.customerId,
    customerNo: r.customerNo,
    customerName: maskName(decrypt(r.name)),
    orderNo: r.orderNo,
    agentName: r.agentName,
  }));
}

/** 미완료 상담 완료 처리 (01 §3.5 OPEN/IN_PROGRESS → DONE) */
export async function completeConsultation(id: number, filter: BranchFilter, actor: Actor, now = new Date()) {
  const db = getDb();
  const [c] = await db.select().from(consultation).where(eq(consultation.id, id));
  if (!c) throw new UserError('상담을 찾을 수 없습니다.');
  if (c.customerId) await assertCustomerInScope(c.customerId, filter);
  assertConsultTransition(c.status, 'DONE');
  const done = await db
    .update(consultation)
    .set({ status: 'DONE', completedAt: now, updatedAt: now, updatedBy: actor.id })
    .where(and(eq(consultation.id, id), eq(consultation.status, c.status)))
    .returning({ id: consultation.id });
  if (done.length === 0) throw new UserError('다른 곳에서 먼저 처리된 상담입니다.');
}

/** 상담원 목록 (A-CSL-070 검색 조건) */
export async function consultAgents() {
  return getDb().select({ id: adminUser.id, name: adminUser.name }).from(adminUser).where(isNull(adminUser.deletedAt)).orderBy(asc(adminUser.name));
}
