import 'server-only';
/**
 * 기사 상세·등록 (A-TEC-020, F-ADM-TEC-02·03). 탭 [기본·계약 | 숙련·지역 | 등급이력 | 작업통계 | 정산 | VOC].
 * - 연락처·계좌는 🔒 암호화 저장, 화면은 마스킹, 원문은 [보기] + 감사 로그(BR-100).
 * - 로그인 ID(login_id) = 휴대폰 번호 검색용 해시. 연락처를 바꾸면 함께 바꾼다(F-TEC-AUTH-01).
 * - 등급 변경은 technician.grade 수정 + technician_grade_history 1행(INSERT ONLY)을 한 트랜잭션으로.
 * 거점 범위(BR-102)는 기사 소속 거점으로 확인한다.
 */
import {
  adminUser,
  assignment,
  branch,
  serviceArea,
  serviceOrder,
  technician,
  technicianArea,
  technicianGradeHistory,
  technicianSkill,
} from '@aircon/db';
import { type AdminPrincipal, CONFIRMED_ASSIGN_STATUSES, canAccessBranch, kstDate, maskPhone, validateGradeChange } from '@aircon/domain';
import { and, asc, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { UserError } from './action-result';
import { writeAudit } from './audit';
import { ForbiddenError } from './auth';
import { getDb } from './db';
import { decrypt, encrypt, phoneHash } from './pii';

async function techInScope(id: number, admin: AdminPrincipal) {
  const [t] = await getDb().select().from(technician).where(and(eq(technician.id, id), isNull(technician.deletedAt)));
  if (!t) return null;
  if (!canAccessBranch(admin, t.branchId)) throw new ForbiddenError('다른 거점의 기사는 볼 수 없습니다.');
  return t;
}

const maskAccount = (v: string | null) => (v ? `${'*'.repeat(Math.max(v.length - 4, 0))}${v.slice(-4)}` : null);

export async function getTechnicianDetail(id: number, admin: AdminPrincipal, now = new Date()) {
  const t = await techInScope(id, admin);
  if (!t) return null;
  const db = getDb();
  const monthStart = new Date(`${kstDate(now).slice(0, 7)}-01T00:00:00+09:00`);
  const [skills, areas, grades, [b], branchAreas, stats] = await Promise.all([
    db.select().from(technicianSkill).where(eq(technicianSkill.technicianId, id)).orderBy(asc(technicianSkill.deviceType)),
    db.select().from(technicianArea).where(eq(technicianArea.technicianId, id)),
    db
      .select({ h: technicianGradeHistory, approver: adminUser.name })
      .from(technicianGradeHistory)
      .leftJoin(adminUser, eq(adminUser.id, technicianGradeHistory.approvedBy))
      .where(eq(technicianGradeHistory.technicianId, id))
      .orderBy(desc(technicianGradeHistory.createdAt)),
    db.select({ name: branch.name }).from(branch).where(eq(branch.id, t.branchId)),
    db
      .select({ code: serviceArea.legalDongCode, sido: serviceArea.sido, sigungu: serviceArea.sigungu, dong: serviceArea.eupmyeondong })
      .from(serviceArea)
      .where(and(eq(serviceArea.branchId, t.branchId), eq(serviceArea.isServiceable, true)))
      .orderBy(asc(serviceArea.sigungu), asc(serviceArea.eupmyeondong)),
    db
      .select({
        total: sql<number>`count(*)`.mapWith(Number),
        month: sql<number>`count(*) filter (where ${serviceOrder.promisedAt} >= ${monthStart.toISOString()}::timestamptz)`.mapWith(Number),
        completed: sql<number>`count(*) filter (where ${serviceOrder.status} in ('WORK_DONE','COMPLETED'))`.mapWith(Number),
        upcoming: sql<number>`count(*) filter (where ${serviceOrder.status} = 'ASSIGNED')`.mapWith(Number),
        pending: sql<number>`count(*) filter (where ${serviceOrder.status} = 'PENDING')`.mapWith(Number),
      })
      .from(assignment)
      .innerJoin(serviceOrder, eq(serviceOrder.id, assignment.orderId))
      .where(and(eq(assignment.technicianId, id), inArray(assignment.status, [...CONFIRMED_ASSIGN_STATUSES]))),
  ]);
  return {
    tech: {
      id: t.id,
      techCode: t.techCode,
      name: t.name,
      displayName: t.displayName,
      phoneMasked: maskPhone(decrypt(t.phone)),
      branchId: t.branchId,
      branchName: b?.name ?? '',
      grade: t.grade,
      contractType: t.contractType,
      status: t.status,
      joinedAt: t.joinedAt,
      leftAt: t.leftAt,
      leaveReason: t.leaveReason,
      bizRegNo: t.bizRegNo,
      licenses: t.licenses,
      bankCode: t.bankCode,
      bankAccountMasked: maskAccount(decrypt(t.bankAccount)),
      accountHolder: t.accountHolder,
      hasVehicle: t.hasVehicle ?? false,
      vehicleNo: t.vehicleNo,
      insuranceJoined: t.insuranceJoined ?? false,
      intro: t.intro,
      accompanyRequiredCount: t.accompanyRequiredCount,
      accompanyDoneCount: t.accompanyDoneCount,
      ratingAvg: t.ratingAvg,
      vocCount: t.vocCount,
      hasPassword: Boolean(t.passwordHash),
      locked: t.loginFailCount > 0,
    },
    skills: skills.map((s) => ({ deviceType: s.deviceType, skillLevel: s.skillLevel, certifiedAt: s.certifiedAt })),
    areas: areas.map((a) => ({ legalDongCode: a.legalDongCode, priority: a.priority })),
    branchAreas: branchAreas.filter((a): a is typeof a & { code: string } => a.code !== null).map((a) => ({ code: a.code, label: `${a.sigungu} ${a.dong}` })),
    grades: grades.map((g) => ({ id: g.h.id, fromGrade: g.h.fromGrade, toGrade: g.h.toGrade, reason: g.h.reason, effectiveDate: g.h.effectiveDate, approver: g.approver, createdAt: g.h.createdAt })),
    stats: stats[0] ?? { total: 0, month: 0, completed: 0, upcoming: 0, pending: 0 },
  };
}

/** [보기] 연락처·계좌 원문 (감사 로그 VIEW_PII) */
export async function revealTechnicianPii(id: number, admin: AdminPrincipal) {
  const t = await techInScope(id, admin);
  if (!t) throw new UserError('기사를 찾을 수 없습니다.');
  await writeAudit({ actorId: admin.adminId, action: 'VIEW_PII', targetTable: 'technician', targetId: id, detail: { fields: ['phone', 'bank_account'] } });
  return { phone: decrypt(t.phone) ?? '', bankAccount: decrypt(t.bankAccount) ?? '' };
}

/** 기본·계약 탭 저장 (등급은 등급 변경으로만) */
export async function saveTechnicianProfile(
  id: number,
  v: {
    name: string;
    displayName: string | null;
    phone: string;
    branchId: number;
    contractType: string;
    status: string;
    joinedAt: string | null;
    leftAt: string | null;
    leaveReason: string | null;
    bizRegNo: string | null;
    licenses: string | null;
    bankCode: string | null;
    bankAccount: string | null;
    accountHolder: string | null;
    hasVehicle: boolean;
    vehicleNo: string | null;
    insuranceJoined: boolean;
    intro: string | null;
    accompanyRequiredCount: number;
  },
  admin: AdminPrincipal,
) {
  const t = await techInScope(id, admin);
  if (!t) throw new UserError('기사를 찾을 수 없습니다.');
  if (!canAccessBranch(admin, v.branchId)) throw new ForbiddenError('다른 거점 소속으로 바꿀 수 없습니다.');
  const { bankAccount, phone, ...rest } = v;
  await getDb()
    .update(technician)
    .set({
      ...rest,
      phone: encrypt(phone)!,
      loginId: phoneHash(phone),
      ...(bankAccount ? { bankAccount: encrypt(bankAccount.replace(/[^0-9-]/g, '')) } : {}),
      updatedAt: new Date(),
      updatedBy: admin.adminId,
    })
    .where(eq(technician.id, id));
}

/** 숙련 탭 저장 (기기 유형별 1행으로 통째로 바꾼다) — BR-072 기준 데이터 */
export async function saveTechnicianSkills(id: number, skills: { deviceType: string; skillLevel: string }[], admin: AdminPrincipal) {
  if (!(await techInScope(id, admin))) throw new UserError('기사를 찾을 수 없습니다.');
  const uniq = new Map(skills.map((s) => [s.deviceType, s.skillLevel]));
  const today = kstDate(new Date());
  await getDb().transaction(async (tx) => {
    const before = await tx.select().from(technicianSkill).where(eq(technicianSkill.technicianId, id));
    await tx.delete(technicianSkill).where(eq(technicianSkill.technicianId, id));
    if (uniq.size) {
      await tx.insert(technicianSkill).values(
        [...uniq].map(([deviceType, skillLevel]) => {
          const prev = before.find((b) => b.deviceType === deviceType);
          const same = prev?.skillLevel === skillLevel;
          return {
            technicianId: id,
            deviceType,
            skillLevel,
            certifiedAt: same ? prev!.certifiedAt : today,
            certifiedBy: same ? prev!.certifiedBy : admin.adminId,
            createdBy: admin.adminId,
            updatedBy: admin.adminId,
          };
        }),
      );
    }
  });
}

/** 활동지역 탭 저장: 소속 거점의 서비스 지역 안에서만 */
export async function saveTechnicianAreas(id: number, areas: { legalDongCode: string; priority: number }[], admin: AdminPrincipal) {
  const t = await techInScope(id, admin);
  if (!t) throw new UserError('기사를 찾을 수 없습니다.');
  const codes = [...new Set(areas.map((a) => a.legalDongCode))];
  if (codes.length) {
    const ok = await getDb()
      .select({ code: serviceArea.legalDongCode })
      .from(serviceArea)
      .where(and(eq(serviceArea.branchId, t.branchId), inArray(serviceArea.legalDongCode, codes)));
    if (ok.length !== codes.length) throw new UserError('소속 거점의 관할 지역만 활동지역으로 지정할 수 있습니다.');
  }
  await getDb().transaction(async (tx) => {
    await tx.delete(technicianArea).where(eq(technicianArea.technicianId, id));
    if (codes.length) {
      await tx.insert(technicianArea).values(
        codes.map((c) => ({
          technicianId: id,
          legalDongCode: c,
          priority: areas.find((a) => a.legalDongCode === c)!.priority,
          createdBy: admin.adminId,
          updatedBy: admin.adminId,
        })),
      );
    }
  });
}

/** F-ADM-TEC-03 등급 변경 (사유·적용일, 이력 INSERT ONLY) */
export async function changeTechnicianGrade(input: { technicianId: number; toGrade: string; reason: string; effectiveDate: string }, admin: AdminPrincipal) {
  const t = await techInScope(input.technicianId, admin);
  if (!t) throw new UserError('기사를 찾을 수 없습니다.');
  const err = validateGradeChange(t.grade, input.toGrade, input.reason);
  if (err) throw new UserError(err);
  await getDb().transaction(async (tx) => {
    const rows = await tx
      .update(technician)
      .set({ grade: input.toGrade, updatedAt: new Date(), updatedBy: admin.adminId })
      .where(and(eq(technician.id, t.id), eq(technician.grade, t.grade)))
      .returning({ id: technician.id });
    if (!rows.length) throw new UserError('다른 곳에서 먼저 등급이 바뀌었습니다. 새로고침 후 다시 확인해 주세요.');
    await tx.insert(technicianGradeHistory).values({
      technicianId: t.id,
      fromGrade: t.grade,
      toGrade: input.toGrade,
      reason: input.reason,
      approvedBy: admin.adminId,
      effectiveDate: input.effectiveDate,
    });
  });
}

/** 비밀번호 잠금 해제 (기사가 인증번호로 로그인해도 풀린다) */
export async function unlockTechnicianLogin(id: number, admin: AdminPrincipal) {
  if (!(await techInScope(id, admin))) throw new UserError('기사를 찾을 수 없습니다.');
  await getDb().update(technician).set({ loginFailCount: 0, updatedAt: new Date(), updatedBy: admin.adminId }).where(eq(technician.id, id));
}

/** 최근 배정 (작업통계 탭) */
export async function recentTechnicianJobs(id: number) {
  return getDb()
    .select({ orderId: serviceOrder.id, orderNo: serviceOrder.orderNo, status: serviceOrder.status, promisedAt: serviceOrder.promisedAt, role: assignment.role })
    .from(assignment)
    .innerJoin(serviceOrder, eq(serviceOrder.id, assignment.orderId))
    .where(and(eq(assignment.technicianId, id), inArray(assignment.status, [...CONFIRMED_ASSIGN_STATUSES]), gte(serviceOrder.promisedAt, new Date(Date.now() - 90 * 86400_000))))
    .orderBy(desc(serviceOrder.promisedAt))
    .limit(30);
}
