import 'server-only';
/**
 * 기사 앱 데이터 (단계 4-1: F-TEC-HOM-02 오늘의 약속, F-TEC-JOB-01·02, F-TEC-MY-01, F-TEC-NTF-01).
 * - 기사는 자기에게 확정된 배정(ACCEPTED·TRANSFER_REQUESTED)의 주문만 본다.
 * - 목록은 고객 이름 마스킹·짧은 주소(BR-100). 상세에서 [연락처·상세주소 보기]를 누르면 원문을 보여 주고 감사 로그를 남긴다.
 */
import {
  assignment,
  branch,
  customer,
  customerAddress,
  notificationLog,
  notificationTemplate,
  orderItem,
  orderStatusHistory,
  serviceArea,
  serviceOrder,
  serviceProduct,
  technician,
  technicianArea,
  technicianSkill,
} from '@aircon/db';
import { CONFIRMED_ASSIGN_STATUSES, elapsedMinutes, kstDate, maskName, maskPhone, shortAddress, sortTechJobs, techJobTab } from '@aircon/domain';
import { and, desc, eq, gte, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import { UserError } from './action-result';
import { writeAudit } from './audit';
import { getDb } from './db';
import { decrypt } from './pii';

const DAY = 24 * 3600_000;

async function devicesOf(orderIds: number[]) {
  const out = new Map<number, { name: string; quantity: number; deviceType: string }[]>();
  if (orderIds.length === 0) return out;
  const rows = await getDb()
    .select({ orderId: orderItem.orderId, name: serviceProduct.name, quantity: orderItem.quantity, deviceType: serviceProduct.deviceType })
    .from(orderItem)
    .innerJoin(serviceProduct, eq(serviceProduct.id, orderItem.productId))
    .where(and(inArray(orderItem.orderId, orderIds), eq(orderItem.itemType, 'PRODUCT')));
  for (const r of rows) out.set(r.orderId, [...(out.get(r.orderId) ?? []), { name: r.name, quantity: r.quantity, deviceType: r.deviceType }]);
  return out;
}

export type TechJob = Awaited<ReturnType<typeof listTechJobs>>[number];

/** 내 작업: 약속 ±30일 + 미처리 전부. 정렬은 미처리 → 진행 → 처리완료 */
export async function listTechJobs(techId: number, now = new Date()) {
  const rows = await getDb()
    .select({
      orderId: serviceOrder.id,
      orderNo: serviceOrder.orderNo,
      status: serviceOrder.status,
      promisedAt: serviceOrder.promisedAt,
      requestedTimeTo: serviceOrder.requestedTimeTo,
      requiredTechCount: serviceOrder.requiredTechCount,
      role: assignment.role,
      assignStatus: assignment.status,
      name: customer.name,
      roadAddress: customerAddress.roadAddress,
    })
    .from(assignment)
    .innerJoin(serviceOrder, eq(serviceOrder.id, assignment.orderId))
    .innerJoin(customer, eq(customer.id, serviceOrder.customerId))
    .innerJoin(customerAddress, eq(customerAddress.id, serviceOrder.addressId))
    .where(
      and(
        eq(assignment.technicianId, techId),
        inArray(assignment.status, [...CONFIRMED_ASSIGN_STATUSES]),
        isNull(serviceOrder.deletedAt),
        or(
          eq(serviceOrder.status, 'PENDING'),
          and(gte(serviceOrder.promisedAt, new Date(now.getTime() - 30 * DAY)), lt(serviceOrder.promisedAt, new Date(now.getTime() + 31 * DAY))),
        ),
      ),
    );
  const devices = await devicesOf(rows.map((r) => r.orderId));
  return sortTechJobs(
    rows.map((r) => ({
      orderNo: r.orderNo,
      status: r.status,
      promisedAt: r.promisedAt,
      date: r.promisedAt ? kstDate(r.promisedAt) : null,
      timeTo: r.requestedTimeTo?.slice(0, 5) ?? null,
      role: r.role,
      transferRequested: r.assignStatus === 'TRANSFER_REQUESTED',
      customerName: maskName(decrypt(r.name)),
      address: shortAddress(r.roadAddress),
      devices: devices.get(r.orderId) ?? [],
      tab: techJobTab(r, now),
      elapsedMin: elapsedMinutes(r, now),
    })),
  );
}

/** F-TEC-HOM-02 오늘의 약속 (미처리 우선) — 남은 n / 전체 N */
export async function todayAppointments(techId: number, now = new Date()) {
  const today = kstDate(now);
  const jobs = (await listTechJobs(techId, now)).filter((j) => j.status === 'PENDING' || j.date === today);
  const remaining = jobs.filter((j) => !['WORK_DONE', 'COMPLETED', 'CANCELED'].includes(j.status)).length;
  return { jobs, remaining, total: jobs.length };
}

async function myAssignment(techId: number, orderNo: string) {
  const [row] = await getDb()
    .select({ a: assignment, o: serviceOrder })
    .from(assignment)
    .innerJoin(serviceOrder, eq(serviceOrder.id, assignment.orderId))
    .where(and(eq(serviceOrder.orderNo, orderNo), eq(assignment.technicianId, techId), inArray(assignment.status, [...CONFIRMED_ASSIGN_STATUSES]), isNull(serviceOrder.deletedAt)));
  if (!row) return null;
  return row;
}

/** F-TEC-JOB-02 작업 상세 (원문 연락처 제외) */
export async function getTechJob(techId: number, orderNo: string) {
  const mine = await myAssignment(techId, orderNo);
  if (!mine) return null;
  const db = getDb();
  const o = mine.o;
  const [[c], [addr], [b], devices, team, history, past] = await Promise.all([
    db.select({ name: customer.name, phone: customer.phone1 }).from(customer).where(eq(customer.id, o.customerId)),
    db.select().from(customerAddress).where(eq(customerAddress.id, o.addressId)),
    db.select({ name: branch.name, phone: branch.phone }).from(branch).where(eq(branch.id, o.branchId)),
    devicesOf([o.id]),
    db
      .select({ role: assignment.role, name: technician.name, displayName: technician.displayName, technicianId: assignment.technicianId })
      .from(assignment)
      .innerJoin(technician, eq(technician.id, assignment.technicianId))
      .where(and(eq(assignment.orderId, o.id), inArray(assignment.status, [...CONFIRMED_ASSIGN_STATUSES]))),
    db.select().from(orderStatusHistory).where(eq(orderStatusHistory.orderId, o.id)).orderBy(orderStatusHistory.createdAt),
    db
      .select({ id: serviceOrder.id, orderNo: serviceOrder.orderNo, status: serviceOrder.status, promisedAt: serviceOrder.promisedAt })
      .from(serviceOrder)
      .where(and(eq(serviceOrder.customerId, o.customerId), ne(serviceOrder.id, o.id), isNull(serviceOrder.deletedAt)))
      .orderBy(desc(serviceOrder.promisedAt))
      .limit(5),
  ]);
  const pastDevices = await devicesOf(past.map((p) => p.id));
  return {
    orderNo: o.orderNo,
    status: o.status,
    promisedAt: o.promisedAt,
    timeTo: o.requestedTimeTo?.slice(0, 5) ?? null,
    orderType: o.orderType,
    requiredTechCount: o.requiredTechCount,
    role: mine.a.role,
    transferRequested: mine.a.status === 'TRANSFER_REQUESTED',
    transferReason: mine.a.status === 'TRANSFER_REQUESTED' ? mine.a.rejectReason : null,
    customerName: maskName(decrypt(c?.name ?? null)),
    phoneMasked: maskPhone(decrypt(c?.phone ?? null)),
    roadAddress: addr?.roadAddress ?? '',
    housingType: addr?.housingType ?? null,
    parkingNote: addr?.parkingNote ?? null,
    hasElevator: addr?.hasElevator ?? null,
    devices: devices.get(o.id) ?? [],
    customerRequest: o.customerRequest,
    internalNote: o.internalNote,
    branchName: b?.name ?? '',
    branchPhone: b?.phone ?? null,
    team: team.filter((t) => t.technicianId !== techId).map((t) => ({ role: t.role, name: t.displayName || t.name })),
    history: history.map((h) => ({ id: h.id, toStatus: h.toStatus, createdAt: h.createdAt })),
    past: past.map((p) => ({ orderNo: p.orderNo, status: p.status, promisedAt: p.promisedAt, devices: pastDevices.get(p.id) ?? [] })),
  };
}

/** [연락처·상세주소 보기] 원문 + 감사 로그(VIEW_PII, 기사) — BR-100 */
export async function revealTechJobContact(techId: number, orderNo: string) {
  const mine = await myAssignment(techId, orderNo);
  if (!mine) throw new UserError('내 작업이 아닙니다.');
  const db = getDb();
  const [[c], [addr]] = await Promise.all([
    db.select({ name: customer.name, phone: customer.phone1 }).from(customer).where(eq(customer.id, mine.o.customerId)),
    db.select({ detail: customerAddress.detailAddress }).from(customerAddress).where(eq(customerAddress.id, mine.o.addressId)),
  ]);
  await writeAudit({ actorType: 'TECHNICIAN', actorId: techId, action: 'VIEW_PII', targetTable: 'service_order', targetId: mine.o.id, detail: { fields: ['name', 'phone1', 'detail_address'] } });
  return { name: decrypt(c?.name ?? null) ?? '', phone: decrypt(c?.phone ?? null) ?? '', detailAddress: decrypt(addr?.detail ?? null) ?? '' };
}

/* ---------- T-NTF-010 알림 ---------- */

export async function listTechNotifications(techId: number) {
  return getDb()
    .select({
      id: notificationLog.id,
      title: notificationTemplate.title,
      templateCode: notificationTemplate.templateCode,
      status: notificationLog.status,
      createdAt: notificationLog.createdAt,
      orderNo: serviceOrder.orderNo,
      promisedAt: serviceOrder.promisedAt,
    })
    .from(notificationLog)
    .leftJoin(notificationTemplate, eq(notificationTemplate.id, notificationLog.templateId))
    .leftJoin(serviceOrder, and(eq(notificationLog.relatedType, 'ORDER'), eq(serviceOrder.id, notificationLog.relatedId)))
    .where(and(eq(notificationLog.receiverType, 'TECHNICIAN'), eq(notificationLog.receiverId, techId)))
    .orderBy(desc(notificationLog.createdAt))
    .limit(100);
}

/* ---------- T-MY-010 내 정보 ---------- */

export async function getTechProfile(techId: number) {
  const db = getDb();
  const [t] = await db.select().from(technician).where(eq(technician.id, techId));
  if (!t) return null;
  const [areas, skills, [b]] = await Promise.all([
    db
      .select({ code: technicianArea.legalDongCode, priority: technicianArea.priority, sigungu: serviceArea.sigungu, dong: serviceArea.eupmyeondong })
      .from(technicianArea)
      .leftJoin(serviceArea, eq(serviceArea.legalDongCode, technicianArea.legalDongCode))
      .where(eq(technicianArea.technicianId, techId)),
    db.select().from(technicianSkill).where(eq(technicianSkill.technicianId, techId)),
    db.select({ name: branch.name }).from(branch).where(eq(branch.id, t.branchId)),
  ]);
  const account = decrypt(t.bankAccount);
  return {
    techCode: t.techCode,
    name: t.name,
    displayName: t.displayName,
    grade: t.grade,
    status: t.status,
    branchName: b?.name ?? '',
    phoneMasked: maskPhone(decrypt(t.phone)),
    intro: t.intro,
    profilePhotoId: t.profilePhotoId,
    bankCode: t.bankCode,
    bankAccountMasked: account ? `${'*'.repeat(Math.max(account.length - 4, 0))}${account.slice(-4)}` : null,
    accountHolder: t.accountHolder,
    accompanyDone: t.accompanyDoneCount,
    accompanyRequired: t.accompanyRequiredCount,
    hasPassword: Boolean(t.passwordHash),
    areas: areas.map((a) => ({ code: a.code, priority: a.priority, label: a.dong ? `${a.sigungu} ${a.dong}` : a.code })),
    skills: skills.map((s) => ({ deviceType: s.deviceType, skillLevel: s.skillLevel })),
  };
}

export async function updateTechIntro(techId: number, intro: string | null) {
  await getDb().update(technician).set({ intro, updatedAt: new Date(), updatedBy: techId }).where(eq(technician.id, techId));
}
