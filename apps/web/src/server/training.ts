import 'server-only';
/**
 * 기사 모집·교육·정착 서버 서비스 (단계 10):
 * - 지원자 F-ADM-TEC-04 (A-TEC-030): 지원서 등록·수정, 면접·불합격, 합격 = 기사 계정 생성(교육중·견습, 등급 이력 1행) + 합격 안내(APPLICANT_ACCEPTED)
 * - 교육 과정 F-ADM-TEC-05 (A-TEC-040): 과정·기수·정원·수강료·수료 기준, 상태 모집중 → 진행중 → 종료
 * - 수강·수료 F-ADM-TEC-06 (A-TEC-041): 수강 등록, 출석률·실습 점수, 판정(TRAINING_PASS_*), 수료증 번호, 기본과정 수료 시 기사 활동(ACTIVE)
 * - 정착·이탈 F-ADM-TEC-07 (A-TEC-050): 코호트 6개월 정착률, 이탈 사유 분석, 이탈 처리
 * 상태 변경은 domain training-rules 전이표를 거친다. 거점 범위(BR-102)는 지원서·과정·기사 소속 거점으로 확인한다.
 * 연락처는 🔒 암호화 + 검색 해시, 목록은 마스킹, 원문은 [보기] + 감사 로그(BR-100).
 */
import type { applicationAcceptInput, applicationInput, applicationStatusInput, enrollmentAddInput, enrollmentScoreInput, techLeaveInput, trainingCourseInput, z } from '@aircon/contracts';
import { branch, technician, technicianApplication, technicianGradeHistory, trainingCourse, trainingEnrollment } from '@aircon/db';
import {
  type AdminPrincipal,
  type BranchFilter,
  MSG,
  NEW_TECH_FROM_APPLICATION,
  SETTING_KEYS,
  assertApplicationTransition,
  assertCourseTransition,
  assertEnrollmentTransition,
  assertTechStatusTransition,
  canAccessBranch,
  canEnroll,
  checkAcceptInput,
  checkCourseInput,
  checkLeaveInput,
  cohortRetention,
  formatCertificateNo,
  judgeEnrollment,
  kstDate,
  leaveReasonStats,
  maskName,
  maskPhone,
  techStatusAfterPass,
} from '@aircon/domain';
import { and, asc, desc, eq, inArray, isNull, like, ne, sql } from 'drizzle-orm';
import { UserError, ValidationFailed } from './action-result';
import { writeAudit } from './audit';
import { ForbiddenError } from './auth';
import { getDb } from './db';
import { notifyPhone, notifyStaffWith } from './notify';
import { decrypt, encrypt, phoneHash } from './pii';
import { getSettingNumber } from './settings';

const branchCond = (col: typeof technician.branchId | typeof technicianApplication.branchId, filter: BranchFilter) =>
  filter.kind === 'ALL' ? undefined : filter.kind === 'NONE' ? sql`false` : eq(col, filter.branchId);

function guard(admin: AdminPrincipal, branchId: number | null) {
  if (branchId !== null && !canAccessBranch(admin, branchId)) throw new ForbiddenError('다른 거점의 데이터는 처리할 수 없습니다.');
}

function transition(fn: () => void, message: string) {
  try {
    fn();
  } catch {
    throw new UserError(message);
  }
}

/* ---------- 지원자 (A-TEC-030) ---------- */

export async function listApplications(filter: BranchFilter) {
  const rows = await getDb()
    .select({ a: technicianApplication, branchName: branch.name, techCode: technician.techCode })
    .from(technicianApplication)
    .innerJoin(branch, eq(branch.id, technicianApplication.branchId))
    .leftJoin(technician, eq(technician.id, technicianApplication.technicianId))
    .where(and(isNull(technicianApplication.deletedAt), branchCond(technicianApplication.branchId, filter)))
    .orderBy(desc(technicianApplication.createdAt))
    .limit(500);
  return rows.map((r) => ({
    id: r.a.id,
    branchId: r.a.branchId,
    branchName: r.branchName,
    name: maskName(r.a.name),
    phone: maskPhone(decrypt(r.a.phone)),
    ageGroup: r.a.ageGroup,
    region: r.a.region,
    experienceYears: r.a.experienceYears,
    licenses: r.a.licenses,
    source: r.a.source,
    supportTargetFlag: r.a.supportTargetFlag,
    status: r.a.status,
    note: r.a.note,
    techCode: r.techCode,
    appliedAt: kstDate(r.a.createdAt),
  }));
}

async function applicationInScope(id: number, admin: AdminPrincipal) {
  const [a] = await getDb().select().from(technicianApplication).where(and(eq(technicianApplication.id, id), isNull(technicianApplication.deletedAt)));
  if (!a) throw new UserError('지원서를 찾을 수 없습니다.');
  guard(admin, a.branchId);
  return a;
}

/** 수정 창: 이름·연락처 원문 (감사 로그 VIEW_PII) */
export async function applicationDetail(id: number, admin: AdminPrincipal) {
  const a = await applicationInScope(id, admin);
  await writeAudit({ actorId: admin.adminId, action: 'VIEW_PII', targetTable: 'technician_application', targetId: id, detail: { field: 'name,phone' } });
  return { ...a, phone: decrypt(a.phone) ?? '' };
}

export async function saveApplication(input: z.output<typeof applicationInput>, admin: AdminPrincipal, now = new Date()) {
  guard(admin, input.branchId);
  const values = {
    branchId: input.branchId,
    name: input.name,
    phone: encrypt(input.phone)!,
    phoneHash: phoneHash(input.phone),
    ageGroup: input.ageGroup,
    region: input.region,
    experienceYears: input.experienceYears,
    licenses: input.licenses,
    source: input.source,
    supportTargetFlag: input.supportTargetFlag,
    note: input.note,
    updatedAt: now,
    updatedBy: admin.adminId,
  };
  const db = getDb();
  if (input.id) {
    const a = await applicationInScope(input.id, admin);
    if (a.status === 'ACCEPTED') throw new UserError('합격 처리된 지원서는 고칠 수 없습니다. 기사 상세에서 고쳐 주세요.');
    await db.update(technicianApplication).set(values).where(eq(technicianApplication.id, a.id));
    return a.id;
  }
  const [dup] = await db
    .select({ id: technicianApplication.id })
    .from(technicianApplication)
    .where(and(eq(technicianApplication.phoneHash, values.phoneHash), inArray(technicianApplication.status, ['APPLIED', 'INTERVIEW']), isNull(technicianApplication.deletedAt)));
  if (dup) throw new UserError('같은 연락처로 진행 중인 지원서가 있습니다.');
  const [row] = await db
    .insert(technicianApplication)
    .values({ ...values, status: 'APPLIED', createdBy: admin.adminId })
    .returning({ id: technicianApplication.id });
  return row!.id;
}

/** 면접·불합격 */
export async function changeApplicationStatus(input: z.output<typeof applicationStatusInput>, admin: AdminPrincipal, now = new Date()) {
  const a = await applicationInScope(input.id, admin);
  transition(() => assertApplicationTransition(a.status, input.status), input.status === 'INTERVIEW' ? '지원 상태에서만 면접으로 바꿀 수 있습니다.' : '이미 결과가 정해진 지원서입니다.');
  await getDb()
    .update(technicianApplication)
    .set({ status: input.status, note: input.note ?? a.note, updatedAt: now, updatedBy: admin.adminId })
    .where(eq(technicianApplication.id, a.id));
}

/** 합격 = 기사 계정 생성(교육중·견습) + 등급 이력 1행 + 지원서 연결, 합격 안내 알림톡(실패 시 문자) */
export async function acceptApplication(input: z.output<typeof applicationAcceptInput>, admin: AdminPrincipal, now = new Date()) {
  const a = await applicationInScope(input.id, admin);
  guard(admin, input.branchId);
  const errors = checkAcceptInput({ status: a.status, techCode: input.techCode, contractType: input.contractType, branchId: input.branchId });
  if (errors) throw new ValidationFailed(errors);
  const db = getDb();
  const [dup] = await db.select({ id: technician.id }).from(technician).where(eq(technician.loginId, a.phoneHash));
  if (dup) throw new UserError('같은 연락처로 등록된 기사가 이미 있습니다.');
  const accompanyRequiredCount = await getSettingNumber(SETTING_KEYS.TECH_ACCOMPANY_COUNT);
  const techId = await db.transaction(async (tx) => {
    const [t] = await tx
      .insert(technician)
      .values({
        techCode: input.techCode,
        loginId: a.phoneHash,
        name: a.name,
        phone: a.phone,
        branchId: input.branchId,
        grade: NEW_TECH_FROM_APPLICATION.grade,
        contractType: input.contractType,
        status: NEW_TECH_FROM_APPLICATION.status,
        licenses: a.licenses,
        accompanyRequiredCount,
        createdBy: admin.adminId,
        updatedBy: admin.adminId,
      })
      .returning({ id: technician.id });
    await tx.insert(technicianGradeHistory).values({
      technicianId: t!.id,
      fromGrade: null,
      toGrade: NEW_TECH_FROM_APPLICATION.grade,
      reason: '지원 합격(신규 등록)',
      approvedBy: admin.adminId,
      effectiveDate: kstDate(now),
    });
    await tx
      .update(technicianApplication)
      .set({ status: 'ACCEPTED', technicianId: t!.id, updatedAt: now, updatedBy: admin.adminId })
      .where(eq(technicianApplication.id, a.id));
    return t!.id;
  });
  const [b] = await db.select({ phone: branch.phone }).from(branch).where(eq(branch.id, input.branchId));
  const phone = decrypt(a.phone);
  if (phone) await notifyPhone('APPLICANT_ACCEPTED', phone, { 기사명: a.name, 거점전화: b?.phone ?? '' }, { type: 'APPLICATION', id: a.id }, { type: 'TECHNICIAN', id: techId });
  return techId;
}

export async function deleteApplication(id: number, admin: AdminPrincipal, now = new Date()) {
  const a = await applicationInScope(id, admin);
  if (a.status === 'ACCEPTED') throw new UserError('합격 처리된 지원서는 지울 수 없습니다.');
  await getDb().update(technicianApplication).set({ deletedAt: now, updatedAt: now, updatedBy: admin.adminId }).where(eq(technicianApplication.id, id));
}

/* ---------- 교육 과정 (A-TEC-040) ---------- */

const courseBranchCond = (filter: BranchFilter) =>
  filter.kind === 'ALL' ? undefined : filter.kind === 'NONE' ? sql`false` : sql`(${trainingCourse.branchId} is null or ${trainingCourse.branchId} = ${filter.branchId})`;

export async function listCourses(filter: BranchFilter) {
  const db = getDb();
  const rows = await db
    .select({ c: trainingCourse, branchName: branch.name })
    .from(trainingCourse)
    .leftJoin(branch, eq(branch.id, trainingCourse.branchId))
    .where(and(isNull(trainingCourse.deletedAt), courseBranchCond(filter)))
    .orderBy(desc(trainingCourse.startDate), desc(trainingCourse.id))
    .limit(300);
  const ids = rows.map((r) => r.c.id);
  const counts = ids.length
    ? await db
        .select({ courseId: trainingEnrollment.courseId, n: sql<number>`count(*) filter (where ${trainingEnrollment.result} <> 'DROPPED')::int`, passed: sql<number>`count(*) filter (where ${trainingEnrollment.result} = 'PASSED')::int` })
        .from(trainingEnrollment)
        .where(inArray(trainingEnrollment.courseId, ids))
        .groupBy(trainingEnrollment.courseId)
    : [];
  return rows.map((r) => {
    const c = counts.find((x) => x.courseId === r.c.id);
    return { ...r.c, branchName: r.branchName, enrolled: c?.n ?? 0, passed: c?.passed ?? 0 };
  });
}

async function courseInScope(id: number, admin: AdminPrincipal) {
  const [c] = await getDb().select().from(trainingCourse).where(and(eq(trainingCourse.id, id), isNull(trainingCourse.deletedAt)));
  if (!c) throw new UserError('교육 과정을 찾을 수 없습니다.');
  // 전체 공통 과정(거점 없음)은 본사(ALL 범위)만 고친다
  if (c.branchId === null ? admin.dataScope !== 'ALL' || admin.branchId !== null : !canAccessBranch(admin, c.branchId)) throw new ForbiddenError('다른 거점의 과정은 고칠 수 없습니다.');
  return c;
}

async function enrolledCount(courseId: number) {
  const [r] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(trainingEnrollment)
    .where(and(eq(trainingEnrollment.courseId, courseId), ne(trainingEnrollment.result, 'DROPPED')));
  return r?.n ?? 0;
}

export async function saveCourse(input: z.output<typeof trainingCourseInput>, admin: AdminPrincipal, now = new Date()) {
  if (input.branchId === null && (admin.dataScope !== 'ALL' || admin.branchId !== null)) throw new ValidationFailed({ branchId: '거점 소속 관리자는 자기 거점 과정만 만들 수 있습니다.' });
  guard(admin, input.branchId);
  const enrolled = input.id ? await enrolledCount(input.id) : 0;
  const errors = checkCourseInput({ startDate: input.startDate, endDate: input.endDate, capacity: input.capacity, enrolled });
  if (errors) throw new ValidationFailed(errors);
  const values = {
    courseCode: input.courseCode,
    name: input.name,
    courseType: input.courseType,
    fee: input.fee,
    totalHours: input.totalHours,
    passCriteria: input.passCriteria,
    branchId: input.branchId,
    startDate: input.startDate,
    endDate: input.endDate,
    capacity: input.capacity,
    status: input.status,
    updatedAt: now,
    updatedBy: admin.adminId,
  };
  const db = getDb();
  if (input.id) {
    const c = await courseInScope(input.id, admin);
    transition(() => assertCourseTransition(c.status, input.status), '과정 상태는 모집중 → 진행중 → 종료 순서로만 바꿀 수 있습니다.');
    await db.update(trainingCourse).set(values).where(eq(trainingCourse.id, c.id));
    return c.id;
  }
  if (input.status !== 'RECRUITING') throw new ValidationFailed({ status: '새 과정은 모집중으로 시작합니다.' });
  const [row] = await db
    .insert(trainingCourse)
    .values({ ...values, createdBy: admin.adminId })
    .returning({ id: trainingCourse.id });
  return row!.id;
}

export async function deleteCourse(id: number, admin: AdminPrincipal, now = new Date()) {
  const c = await courseInScope(id, admin);
  if ((await enrolledCount(id)) > 0) throw new UserError('수강생이 있는 과정은 지울 수 없습니다.');
  await getDb().update(trainingCourse).set({ deletedAt: now, updatedAt: now, updatedBy: admin.adminId }).where(eq(trainingCourse.id, c.id));
}

/* ---------- 수강·수료 (A-TEC-041) ---------- */

export async function listEnrollments(courseId: number, admin: AdminPrincipal, filter: BranchFilter) {
  const [c] = await getDb().select().from(trainingCourse).where(and(eq(trainingCourse.id, courseId), isNull(trainingCourse.deletedAt)));
  if (!c) return null;
  if (c.branchId !== null && !canAccessBranch(admin, c.branchId)) throw new ForbiddenError('다른 거점의 과정은 볼 수 없습니다.');
  const rows = await getDb()
    .select({
      id: trainingEnrollment.id,
      technicianId: technician.id,
      techCode: technician.techCode,
      techName: technician.name,
      techStatus: technician.status,
      techGrade: technician.grade,
      branchId: technician.branchId,
      paidAmount: trainingEnrollment.paidAmount,
      attendanceRate: trainingEnrollment.attendanceRate,
      practicalScore: trainingEnrollment.practicalScore,
      result: trainingEnrollment.result,
      completedAt: trainingEnrollment.completedAt,
      certificateNo: trainingEnrollment.certificateNo,
    })
    .from(trainingEnrollment)
    .innerJoin(technician, eq(technician.id, trainingEnrollment.technicianId))
    .where(and(eq(trainingEnrollment.courseId, courseId), branchCond(technician.branchId, filter)))
    .orderBy(asc(technician.name));
  return { course: c, rows };
}

/** 수강 등록 후보: 거점 범위 안 지원·교육중·활동·휴직 기사 */
export async function enrollableTechs(filter: BranchFilter) {
  return getDb()
    .select({ id: technician.id, techCode: technician.techCode, name: technician.name, status: technician.status })
    .from(technician)
    .where(and(isNull(technician.deletedAt), ne(technician.status, 'LEFT'), branchCond(technician.branchId, filter)))
    .orderBy(asc(technician.name))
    .limit(500);
}

export async function addEnrollment(input: z.output<typeof enrollmentAddInput>, admin: AdminPrincipal) {
  const c = await courseInScope(input.courseId, admin).catch(async (e) => {
    // 공통 과정도 거점 관리자가 자기 기사를 등록할 수 있다
    const [row] = await getDb().select().from(trainingCourse).where(and(eq(trainingCourse.id, input.courseId), isNull(trainingCourse.deletedAt)));
    if (row && row.branchId === null) return row;
    throw e;
  });
  const db = getDb();
  const [t] = await db.select().from(technician).where(and(eq(technician.id, input.technicianId), isNull(technician.deletedAt)));
  if (!t) throw new UserError('기사를 찾을 수 없습니다.');
  guard(admin, t.branchId);
  const [dup] = await db.select({ id: trainingEnrollment.id }).from(trainingEnrollment).where(and(eq(trainingEnrollment.courseId, c.id), eq(trainingEnrollment.technicianId, t.id)));
  const err = canEnroll({ courseStatus: c.status, capacity: c.capacity, enrolled: await enrolledCount(c.id), alreadyEnrolled: Boolean(dup), techStatus: t.status });
  if (err) throw new UserError(err);
  const [row] = await db
    .insert(trainingEnrollment)
    .values({ courseId: c.id, technicianId: t.id, paidAmount: input.paidAmount, result: 'ENROLLED', createdBy: admin.adminId, updatedBy: admin.adminId })
    .returning({ id: trainingEnrollment.id });
  return row!.id;
}

/** 출석·점수 저장 / 판정(수료·미수료) / 중도 포기. 수료면 수료증 번호, 기본과정이면 기사 활동(ACTIVE)·활동 시작일 */
export async function scoreEnrollment(input: z.output<typeof enrollmentScoreInput>, admin: AdminPrincipal, now = new Date()) {
  const db = getDb();
  const [row] = await db
    .select({ e: trainingEnrollment, c: trainingCourse, t: technician })
    .from(trainingEnrollment)
    .innerJoin(trainingCourse, eq(trainingCourse.id, trainingEnrollment.courseId))
    .innerJoin(technician, eq(technician.id, trainingEnrollment.technicianId))
    .where(eq(trainingEnrollment.id, input.id));
  if (!row) throw new UserError('수강 내역을 찾을 수 없습니다.');
  guard(admin, row.t.branchId);
  if (row.e.result !== 'ENROLLED') throw new UserError('이미 결과가 정해진 수강입니다.');
  const base = { attendanceRate: input.attendanceRate, practicalScore: input.practicalScore, updatedAt: now, updatedBy: admin.adminId };
  if (input.action === 'SAVE') {
    await db.update(trainingEnrollment).set(base).where(eq(trainingEnrollment.id, input.id));
    return { result: 'ENROLLED' as const };
  }
  if (input.action === 'DROP') {
    assertEnrollmentTransition('ENROLLED', 'DROPPED');
    await db.update(trainingEnrollment).set({ ...base, result: 'DROPPED' }).where(eq(trainingEnrollment.id, input.id));
    return { result: 'DROPPED' as const };
  }
  const [passAttendance, passScore] = await Promise.all([getSettingNumber(SETTING_KEYS.TRAINING_PASS_ATTENDANCE), getSettingNumber(SETTING_KEYS.TRAINING_PASS_SCORE)]);
  const result = judgeEnrollment({ attendanceRate: input.attendanceRate, practicalScore: input.practicalScore, passAttendance, passScore });
  if (!result) throw new ValidationFailed({ ...(input.attendanceRate === null ? { attendanceRate: MSG.required('출석률') } : {}), ...(input.practicalScore === null ? { practicalScore: MSG.required('실습 점수') } : {}) });
  assertEnrollmentTransition('ENROLLED', result);
  const today = kstDate(now);
  const year = Number(today.slice(0, 4));
  const newStatus = result === 'PASSED' ? techStatusAfterPass({ courseType: row.c.courseType, techStatus: row.t.status }) : null;
  const certificateNo = await db.transaction(async (tx) => {
    let cert: string | null = null;
    if (result === 'PASSED') {
      const prefix = `${row.c.courseCode}-${year}-`;
      const [last] = await tx
        .select({ no: trainingEnrollment.certificateNo })
        .from(trainingEnrollment)
        .where(like(trainingEnrollment.certificateNo, `${prefix}%`))
        .orderBy(desc(trainingEnrollment.certificateNo))
        .limit(1);
      cert = formatCertificateNo(row.c.courseCode, year, (last?.no ? Number(last.no.slice(prefix.length)) : 0) + 1);
    }
    await tx
      .update(trainingEnrollment)
      .set({ ...base, result, completedAt: result === 'PASSED' ? today : null, certificateNo: cert })
      .where(eq(trainingEnrollment.id, input.id));
    if (newStatus) {
      assertTechStatusTransition(row.t.status, newStatus);
      await tx
        .update(technician)
        .set({ status: newStatus, joinedAt: row.t.joinedAt ?? today, updatedAt: now, updatedBy: admin.adminId })
        .where(eq(technician.id, row.t.id));
    }
    return cert;
  });
  if (result === 'PASSED' && certificateNo)
    await notifyStaffWith('TRAINING_PASSED', { type: 'TECHNICIAN', id: row.t.id }, { type: 'TRAINING', id: row.e.id }, { 과정명: row.c.name, 수료증번호: certificateNo }, '/tech/education');
  return { result, certificateNo, activated: newStatus === 'ACTIVE' };
}

/* ---------- 정착·이탈 (A-TEC-050) ---------- */

export async function retentionReport(filter: BranchFilter, now = new Date()) {
  const techs = await getDb()
    .select({ id: technician.id, techCode: technician.techCode, name: technician.name, status: technician.status, joinedAt: technician.joinedAt, leftAt: technician.leftAt, leaveReason: technician.leaveReason, branchName: branch.name })
    .from(technician)
    .innerJoin(branch, eq(branch.id, technician.branchId))
    .where(and(isNull(technician.deletedAt), branchCond(technician.branchId, filter)))
    .orderBy(asc(technician.name));
  const today = kstDate(now);
  return {
    today,
    retention: cohortRetention(techs, today),
    reasons: leaveReasonStats(techs),
    active: techs.filter((t) => t.status !== 'LEFT' && t.status !== 'APPLICANT'),
    left: techs.filter((t) => t.status === 'LEFT').sort((a, b) => (b.leftAt ?? '').localeCompare(a.leftAt ?? '')),
  };
}

/** 이탈 처리: 상태 LEFT·이탈일·사유 */
export async function markTechLeft(input: z.output<typeof techLeaveInput>, admin: AdminPrincipal, now = new Date()) {
  const db = getDb();
  const [t] = await db.select().from(technician).where(and(eq(technician.id, input.technicianId), isNull(technician.deletedAt)));
  if (!t) throw new UserError('기사를 찾을 수 없습니다.');
  guard(admin, t.branchId);
  const errors = checkLeaveInput({ status: t.status, leaveReason: input.leaveReason, leftAt: input.leftAt, joinedAt: t.joinedAt, today: kstDate(now) });
  if (errors) throw new ValidationFailed(errors);
  assertTechStatusTransition(t.status, 'LEFT');
  await db
    .update(technician)
    .set({ status: 'LEFT', leftAt: input.leftAt, leaveReason: input.leaveReason, dutyStartedAt: null, updatedAt: now, updatedBy: admin.adminId })
    .where(eq(technician.id, t.id));
}
