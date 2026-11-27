import { describe, expect, it } from 'vitest';
import {
  accompanyProgress,
  assertApplicationTransition,
  assertEnrollmentTransition,
  canEnroll,
  canTransitionCourse,
  canTransitionTechStatus,
  checkAcceptInput,
  checkCourseInput,
  checkLeaveInput,
  cohortRetention,
  formatCertificateNo,
  judgeEnrollment,
  leaveReasonStats,
  techStatusAfterPass,
} from './training-rules';
import { kpiRetention } from '../ops/ops-rules';

describe('지원서 상태 (F-ADM-TEC-04, 01 §3.20)', () => {
  it('지원 → 면접 → 합격, 지원·면접에서 불합격', () => {
    expect(() => assertApplicationTransition('APPLIED', 'INTERVIEW')).not.toThrow();
    expect(() => assertApplicationTransition('INTERVIEW', 'ACCEPTED')).not.toThrow();
    expect(() => assertApplicationTransition('APPLIED', 'REJECTED')).not.toThrow();
  });
  it('면접 없이 바로 합격·합격 뒤 변경은 막는다', () => {
    expect(() => assertApplicationTransition('APPLIED', 'ACCEPTED')).toThrow();
    expect(() => assertApplicationTransition('ACCEPTED', 'REJECTED')).toThrow();
  });
  it('합격 처리에는 기사 코드·계약 형태·거점이 필요', () => {
    expect(checkAcceptInput({ status: 'INTERVIEW', techCode: 'T100', contractType: 'FREELANCER', branchId: 1 })).toBeNull();
    const e = checkAcceptInput({ status: 'APPLIED', techCode: ' ', contractType: '', branchId: null });
    expect(Object.keys(e ?? {})).toEqual(['status', 'techCode', 'contractType', 'branchId']);
  });
});

describe('기사 상태 (01 §3.4 · BR-070)', () => {
  it('교육중 → 활동, 활동 ⇄ 휴직, 어디서든 이탈', () => {
    expect(canTransitionTechStatus('TRAINING', 'ACTIVE')).toBe(true);
    expect(canTransitionTechStatus('PAUSED', 'ACTIVE')).toBe(true);
    expect(canTransitionTechStatus('TRAINING', 'LEFT')).toBe(true);
  });
  it('BR-070 교육 수료 전 지원자는 바로 활동이 되지 않는다', () => {
    expect(canTransitionTechStatus('APPLICANT', 'ACTIVE')).toBe(false);
    expect(canTransitionTechStatus('LEFT', 'ACTIVE')).toBe(false);
  });
  it('이탈 처리: 사유·이탈일 필수, 이탈일은 활동 시작일~오늘', () => {
    expect(checkLeaveInput({ status: 'ACTIVE', leaveReason: 'INCOME', leftAt: '2026-11-20', joinedAt: '2026-05-01', today: '2026-11-27' })).toBeNull();
    expect(checkLeaveInput({ status: 'ACTIVE', leaveReason: '', leftAt: '2026-11-30', joinedAt: null, today: '2026-11-27' })).toEqual({
      leaveReason: '이탈 사유는 필수 입력값입니다.',
      leftAt: '이탈일은 오늘 이전이어야 합니다.',
    });
    expect(checkLeaveInput({ status: 'LEFT', leaveReason: 'INCOME', leftAt: '2026-04-01', joinedAt: '2026-05-01', today: '2026-11-27' })).toHaveProperty('status');
  });
});

describe('교육 과정·수강 (F-ADM-TEC-05·06)', () => {
  it('과정은 모집 → 진행 → 종료 순서만', () => {
    expect(canTransitionCourse('RECRUITING', 'IN_PROGRESS')).toBe(true);
    expect(canTransitionCourse('FINISHED', 'RECRUITING')).toBe(false);
    expect(canTransitionCourse('IN_PROGRESS', 'IN_PROGRESS')).toBe(true);
  });
  it('정원은 현재 수강 인원보다 줄일 수 없고 종료일은 시작일 이후', () => {
    expect(checkCourseInput({ startDate: '2026-12-01', endDate: '2026-11-30', capacity: 1, enrolled: 2 })).toEqual({
      endDate: '종료일은 시작일 이후여야 합니다.',
      capacity: '이미 2명이 수강 중이라 정원을 그보다 줄일 수 없습니다.',
    });
  });
  it('수강 등록: 정원·중복·끝난 과정·이탈 기사', () => {
    const ok = { courseStatus: 'RECRUITING', capacity: 10, enrolled: 3, alreadyEnrolled: false, techStatus: 'TRAINING' };
    expect(canEnroll(ok)).toBeNull();
    expect(canEnroll({ ...ok, enrolled: 10 })).toContain('정원');
    expect(canEnroll({ ...ok, alreadyEnrolled: true })).toContain('이미');
    expect(canEnroll({ ...ok, courseStatus: 'FINISHED' })).toContain('끝난');
    expect(canEnroll({ ...ok, techStatus: 'LEFT' })).toContain('이탈');
  });
  it('수료 판정: 출석률·실습 점수가 기준 이상이면 수료, 비어 있으면 판정 안 함', () => {
    expect(judgeEnrollment({ attendanceRate: 90, practicalScore: 80, passAttendance: 80, passScore: 80 })).toBe('PASSED');
    expect(judgeEnrollment({ attendanceRate: 79.5, practicalScore: 95, passAttendance: 80, passScore: 80 })).toBe('FAILED');
    expect(judgeEnrollment({ attendanceRate: null, practicalScore: 95, passAttendance: 80, passScore: 80 })).toBeNull();
  });
  it('수강 결과는 수강중에서 한 번만 정한다', () => {
    expect(() => assertEnrollmentTransition('ENROLLED', 'PASSED')).not.toThrow();
    expect(() => assertEnrollmentTransition('PASSED', 'FAILED')).toThrow();
  });
  it('수료증 번호·수료 뒤 기사 상태(기본과정 교육중 기사만 활동)', () => {
    expect(formatCertificateNo('TR-AC-BASIC', 2026, 7)).toBe('TR-AC-BASIC-2026-007');
    expect(techStatusAfterPass({ courseType: 'BASIC', techStatus: 'TRAINING' })).toBe('ACTIVE');
    expect(techStatusAfterPass({ courseType: 'SAFETY', techStatus: 'TRAINING' })).toBeNull();
    expect(techStatusAfterPass({ courseType: 'BASIC', techStatus: 'ACTIVE' })).toBeNull();
  });
  it('BR-071 동행 진행 n/3', () => {
    expect(accompanyProgress(1, 3)).toEqual({ done: 1, required: 3, complete: false });
    expect(accompanyProgress(4, 3)).toEqual({ done: 3, required: 3, complete: true });
  });
});

describe('6개월 정착률·이탈 사유 (F-ADM-TEC-07, ERD §5)', () => {
  const techs = [
    { joinedAt: '2026-03-02', leftAt: null, status: 'ACTIVE', leaveReason: null },
    { joinedAt: '2026-03-15', leftAt: '2026-04-30', status: 'LEFT', leaveReason: 'INCOME' },
    { joinedAt: '2026-04-01', leftAt: '2026-11-01', status: 'LEFT', leaveReason: 'SEASONAL' },
    { joinedAt: '2026-04-10', leftAt: null, status: 'PAUSED', leaveReason: null },
    { joinedAt: '2026-10-01', leftAt: null, status: 'TRAINING', leaveReason: null },
    { joinedAt: null, leftAt: null, status: 'TRAINING', leaveReason: null },
  ];
  it('코호트별 6개월 경과 기사 중 이탈하지 않은 비율, 6개월이 안 된 코호트는 비율 없음', () => {
    const r = cohortRetention(techs, '2026-11-27');
    expect(r.cohorts.map((c) => [c.cohort, c.joined, c.matured, c.retained, c.rate])).toEqual([
      ['2026-10', 1, 0, 0, null],
      ['2026-04', 2, 2, 1, 50],
      ['2026-03', 2, 2, 1, 50],
    ]);
    expect(r.total).toEqual({ matured: 4, retained: 2, rate: 50 });
  });
  it('전체 정착률은 KPI 카드(A-DSH-020)와 같다', () => {
    expect(cohortRetention(techs, '2026-11-27').total.rate).toBe(kpiRetention(techs, '2026-11-27'));
  });
  it('이탈 사유별 건수·비중·평균 활동 개월', () => {
    expect(leaveReasonStats(techs)).toEqual([
      { reason: 'INCOME', count: 1, share: 50, avgTenureMonths: 1 },
      { reason: 'SEASONAL', count: 1, share: 50, avgTenureMonths: 7 },
    ]);
  });
});
