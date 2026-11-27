/**
 * 기사 모집·교육·정착 규칙 (단계 10, F-ADM-TEC-04~07 · F-TEC-EDU-02, 01 §2.7.6~2.7.8 · §3.4 · §3.20~3.22).
 * 흐름: 지원(APPLIED) → 면접(INTERVIEW) → 합격(ACCEPTED, 기사 계정 생성 = 상태 TRAINING·등급 TRAINEE)
 *       → 수강(ENROLLED) → 수료(PASSED, 기본과정이면 기사 ACTIVE·활동 시작일) → 동행 n/3(BR-071) → 정착(6개월 정착률, ERD §5).
 * BR-070: 교육중(TRAINING) 기사는 동행으로만 배정 — 수료 전에는 단독 배정되지 않는다(배정 규칙은 dispatch/assignment-rules).
 */
import { MSG } from '../messages';
import { addMonthsToDate } from '../ops/ops-rules';

function makeTransitions<S extends string>(name: string, table: Readonly<Record<S, readonly S[]>>) {
  const can = (from: string, to: S) => (table[from as S] ?? []).includes(to);
  const assert = (from: string, to: S) => {
    if (!can(from, to)) throw new Error(`${name} 상태를 ${from}에서 ${to}(으)로 바꿀 수 없습니다.`);
  };
  return { can, assert };
}

/* ---------- 지원서 (F-ADM-TEC-04, 01 §3.20) ---------- */

export const APPLICATION_STATUSES = ['APPLIED', 'INTERVIEW', 'ACCEPTED', 'REJECTED'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export const APPLICATION_TRANSITIONS: Readonly<Record<ApplicationStatus, readonly ApplicationStatus[]>> = {
  APPLIED: ['INTERVIEW', 'REJECTED'],
  INTERVIEW: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: [],
  REJECTED: [],
};
const appT = makeTransitions('지원서', APPLICATION_TRANSITIONS);
export const canTransitionApplication = appT.can;
export const assertApplicationTransition = appT.assert;
export const APPLICATION_SOURCES = ['SNS', 'JOB_SITE', 'REFERRAL', 'GOV_PROGRAM'] as const;

/** 합격 처리 입력 검증: 기사 코드·계약 형태·소속 거점 필수 */
export function checkAcceptInput(i: { status: string; techCode: string; contractType: string; branchId: number | null }): Record<string, string> | null {
  const e: Record<string, string> = {};
  if (!canTransitionApplication(i.status, 'ACCEPTED')) e.status = '면접 단계의 지원자만 합격 처리할 수 있습니다.';
  if (!i.techCode.trim()) e.techCode = MSG.required('기사 코드');
  if (!i.contractType) e.contractType = MSG.required('계약 형태');
  if (!i.branchId) e.branchId = MSG.required('소속 거점');
  return Object.keys(e).length ? e : null;
}

/** 합격으로 만드는 기사 계정의 시작값 (01 §3.4 APPLICANT → TRAINING, 등급 TRAINEE) */
export const NEW_TECH_FROM_APPLICATION = { status: 'TRAINING', grade: 'TRAINEE' } as const;

/* ---------- 기사 상태 (01 §3.4) ---------- */

export const TECH_STATUSES = ['APPLICANT', 'TRAINING', 'ACTIVE', 'PAUSED', 'LEFT'] as const;
export type TechStatus = (typeof TECH_STATUSES)[number];
/** APPLICANT → TRAINING → ACTIVE ⇄ PAUSED → LEFT (교육 중 이탈도 LEFT) */
export const TECH_STATUS_TRANSITIONS: Readonly<Record<TechStatus, readonly TechStatus[]>> = {
  APPLICANT: ['TRAINING', 'LEFT'],
  TRAINING: ['ACTIVE', 'LEFT'],
  ACTIVE: ['PAUSED', 'LEFT'],
  PAUSED: ['ACTIVE', 'LEFT'],
  LEFT: [],
};
const techT = makeTransitions('기사', TECH_STATUS_TRANSITIONS);
export const canTransitionTechStatus = techT.can;
export const assertTechStatusTransition = techT.assert;
export const LEAVE_REASONS = ['INCOME', 'WORKLOAD', 'SEASONAL', 'HEALTH', 'CAREER_CHANGE'] as const;

/** 이탈 처리 검증 (A-TEC-050): 사유·이탈일 필수, 이탈일은 활동 시작일 이후·오늘 이전 */
export function checkLeaveInput(i: { status: string; leaveReason: string; leftAt: string; joinedAt: string | null; today: string }): Record<string, string> | null {
  const e: Record<string, string> = {};
  if (!canTransitionTechStatus(i.status, 'LEFT')) e.status = '이미 이탈 처리된 기사입니다.';
  if (!(LEAVE_REASONS as readonly string[]).includes(i.leaveReason)) e.leaveReason = MSG.required('이탈 사유');
  if (!i.leftAt) e.leftAt = MSG.required('이탈일');
  else if (i.leftAt > i.today) e.leftAt = '이탈일은 오늘 이전이어야 합니다.';
  else if (i.joinedAt && i.leftAt < i.joinedAt) e.leftAt = '이탈일은 활동 시작일 이후여야 합니다.';
  return Object.keys(e).length ? e : null;
}

/* ---------- 교육 과정 (F-ADM-TEC-05, 01 §3.21) ---------- */

export const COURSE_TYPES = ['BASIC', 'ADVANCED', 'SAFETY', 'LEADER'] as const;
export const COURSE_STATUSES = ['RECRUITING', 'IN_PROGRESS', 'FINISHED'] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];
export const COURSE_TRANSITIONS: Readonly<Record<CourseStatus, readonly CourseStatus[]>> = {
  RECRUITING: ['IN_PROGRESS'],
  IN_PROGRESS: ['FINISHED'],
  FINISHED: [],
};
const courseT = makeTransitions('교육 과정', COURSE_TRANSITIONS);
export const canTransitionCourse = (from: string, to: CourseStatus) => from === to || courseT.can(from, to);
export function assertCourseTransition(from: string, to: CourseStatus) {
  if (from !== to) courseT.assert(from, to);
}

/** 과정 입력 검증: 종료일 ≥ 시작일, 정원·시간·수강료 0 이상 */
export function checkCourseInput(i: { startDate: string | null; endDate: string | null; capacity: number | null; enrolled: number }): Record<string, string> | null {
  const e: Record<string, string> = {};
  if (i.startDate && i.endDate && i.endDate < i.startDate) e.endDate = '종료일은 시작일 이후여야 합니다.';
  if (i.capacity !== null && i.capacity < i.enrolled) e.capacity = `이미 ${i.enrolled}명이 수강 중이라 정원을 그보다 줄일 수 없습니다.`;
  return Object.keys(e).length ? e : null;
}

/* ---------- 수강·수료 (F-ADM-TEC-06, 01 §3.22) ---------- */

export const ENROLLMENT_RESULTS = ['ENROLLED', 'PASSED', 'FAILED', 'DROPPED'] as const;
export type EnrollmentResult = (typeof ENROLLMENT_RESULTS)[number];
export const ENROLLMENT_TRANSITIONS: Readonly<Record<EnrollmentResult, readonly EnrollmentResult[]>> = {
  ENROLLED: ['PASSED', 'FAILED', 'DROPPED'],
  PASSED: [],
  FAILED: [],
  DROPPED: [],
};
const enrT = makeTransitions('수강', ENROLLMENT_TRANSITIONS);
export const canTransitionEnrollment = enrT.can;
export const assertEnrollmentTransition = enrT.assert;

/** 수강 등록 가능 여부: 모집중·진행중 과정, 정원 미만, 같은 과정 중복 없음, 이탈 기사 아님 */
export function canEnroll(i: { courseStatus: string; capacity: number | null; enrolled: number; alreadyEnrolled: boolean; techStatus: string }): string | null {
  if (i.courseStatus === 'FINISHED') return '끝난 과정에는 수강 등록할 수 없습니다.';
  if (i.techStatus === 'LEFT') return '이탈한 기사는 수강 등록할 수 없습니다.';
  if (i.alreadyEnrolled) return '이미 이 과정에 등록된 기사입니다.';
  if (i.capacity !== null && i.enrolled >= i.capacity) return `정원(${i.capacity}명)이 찼습니다.`;
  return null;
}

/**
 * 수료 판정: 출석률 ≥ TRAINING_PASS_ATTENDANCE(%) 이고 실습 점수 ≥ TRAINING_PASS_SCORE 이면 수료, 아니면 미수료.
 * 출석률·점수가 비어 있으면 판정하지 않는다(null).
 */
export function judgeEnrollment(i: { attendanceRate: number | null; practicalScore: number | null; passAttendance: number; passScore: number }): 'PASSED' | 'FAILED' | null {
  if (i.attendanceRate === null || i.practicalScore === null) return null;
  return i.attendanceRate >= i.passAttendance && i.practicalScore >= i.passScore ? 'PASSED' : 'FAILED';
}

/** 수료증 번호 = 과정 코드-수료 연도-3자리 일련 (예: TR-AC-BASIC-2026-001) */
export function formatCertificateNo(courseCode: string, year: number, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1 || seq > 999) throw new Error('수료증 일련번호 범위를 넘었습니다.');
  return `${courseCode}-${year}-${String(seq).padStart(3, '0')}`;
}

/** 수료 뒤 기사 상태: 기본과정(BASIC)을 수료한 교육중 기사만 활동(ACTIVE)으로 바꾼다. 다른 경우는 그대로(null) */
export function techStatusAfterPass(i: { courseType: string; techStatus: string }): 'ACTIVE' | null {
  return i.courseType === 'BASIC' && i.techStatus === 'TRAINING' ? 'ACTIVE' : null;
}

/** 동행 진행 현황 n/N (BR-071) */
export function accompanyProgress(done: number, required: number) {
  const d = Math.max(0, done);
  const r = Math.max(0, required);
  return { done: Math.min(d, r), required: r, complete: d >= r };
}

/* ---------- 정착·이탈 (F-ADM-TEC-07, ERD §5 기사 6개월 정착률) ---------- */

export interface CohortRow {
  /** 활동 시작 달 YYYY-MM */
  cohort: string;
  joined: number;
  /** 6개월이 지난 기사 수(정착률 분모) */
  matured: number;
  /** 그중 지금 이탈하지 않은 기사 수 */
  retained: number;
  /** 지금까지 이탈한 기사 수(6개월 전 포함) */
  left: number;
  /** 정착률(%) — 6개월이 지난 기사가 없으면 null */
  rate: number | null;
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

/**
 * 활동 시작 달(코호트)별 6개월 정착률. 6개월 경과 = joined_at ≤ 오늘 − months.
 * 정착 = 6개월이 지난 기사 중 지금 status ≠ LEFT (ERD §5 산식을 코호트로 나눈 것, A-DSH-020 KPI 카드와 전체 값이 같다).
 */
export function cohortRetention(techs: readonly { joinedAt: string | null; leftAt: string | null; status: string }[], today: string, months = 6): {
  cohorts: CohortRow[];
  total: { matured: number; retained: number; rate: number | null };
} {
  const cutoff = addMonthsToDate(today, -months);
  const byCohort = new Map<string, CohortRow>();
  let matured = 0;
  let retained = 0;
  for (const t of techs) {
    if (!t.joinedAt) continue;
    const cohort = t.joinedAt.slice(0, 7);
    const row = byCohort.get(cohort) ?? { cohort, joined: 0, matured: 0, retained: 0, left: 0, rate: null };
    row.joined++;
    const isLeft = t.status === 'LEFT';
    if (isLeft) row.left++;
    if (t.joinedAt <= cutoff) {
      row.matured++;
      matured++;
      if (!isLeft) {
        row.retained++;
        retained++;
      }
    }
    byCohort.set(cohort, row);
  }
  const cohorts = [...byCohort.values()].map((r) => ({ ...r, rate: pct(r.retained, r.matured) })).sort((a, b) => b.cohort.localeCompare(a.cohort));
  return { cohorts, total: { matured, retained, rate: pct(retained, matured) } };
}

/** 이탈 사유별 건수·활동 기간 평균(개월) */
export function leaveReasonStats(techs: readonly { status: string; leaveReason: string | null; joinedAt: string | null; leftAt: string | null }[]) {
  const left = techs.filter((t) => t.status === 'LEFT');
  const reasons = new Map<string, { reason: string; count: number; tenureSum: number; tenureN: number }>();
  for (const t of left) {
    const key = t.leaveReason ?? 'UNKNOWN';
    const r = reasons.get(key) ?? { reason: key, count: 0, tenureSum: 0, tenureN: 0 };
    r.count++;
    if (t.joinedAt && t.leftAt) {
      const [y1, m1] = t.joinedAt.split('-').map(Number) as [number, number];
      const [y2, m2] = t.leftAt.split('-').map(Number) as [number, number];
      r.tenureSum += Math.max(0, (y2 - y1) * 12 + (m2 - m1));
      r.tenureN++;
    }
    reasons.set(key, r);
  }
  return [...reasons.values()]
    .map((r) => ({ reason: r.reason, count: r.count, share: pct(r.count, left.length), avgTenureMonths: r.tenureN ? Math.round((r.tenureSum / r.tenureN) * 10) / 10 : null }))
    .sort((a, b) => b.count - a.count);
}
