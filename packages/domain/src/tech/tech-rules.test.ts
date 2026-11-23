import { describe, expect, it } from 'vitest';
import { assertAssignTransition, canTransitionAssignment, validateGradeChange } from '../dispatch/assignment-status';
import { elapsedMinutes, evaluateTechLogin, shortAddress, sortTechJobs, techJobTab } from './tech-rules';

const acct = (over: Partial<Parameters<typeof evaluateTechLogin>[0]> = {}) => ({ status: 'ACTIVE', deleted: false, loginFailCount: 0, hasPassword: true, ...over });

describe('F-TEC-AUTH-01 기사 로그인', () => {
  it('활동·교육중 기사는 로그인할 수 있다', () => {
    expect(evaluateTechLogin(acct(), 'PASSWORD', true, 5).result).toBe('SUCCESS');
    expect(evaluateTechLogin(acct({ status: 'TRAINING' }), 'OTP', true, 5).result).toBe('SUCCESS');
  });
  it('휴직·이탈·지원·삭제 기사는 로그인할 수 없다', () => {
    for (const status of ['PAUSED', 'LEFT', 'APPLICANT']) expect(evaluateTechLogin(acct({ status }), 'OTP', true, 5).result).toBe('UNAVAILABLE');
    expect(evaluateTechLogin(acct({ deleted: true }), 'OTP', true, 5).result).toBe('UNAVAILABLE');
  });
  it('비밀번호가 없으면 비밀번호 로그인 대신 인증번호 로그인을 안내한다', () => {
    expect(evaluateTechLogin(acct({ hasPassword: false }), 'PASSWORD', false, 5).result).toBe('NO_PASSWORD');
  });
  it('비밀번호를 정해진 횟수만큼 틀리면 잠기고, 인증번호 로그인으로 풀린다', () => {
    expect(evaluateTechLogin(acct({ loginFailCount: 3 }), 'PASSWORD', false, 5)).toEqual({ result: 'INVALID', loginFailCount: 4, remaining: 1 });
    expect(evaluateTechLogin(acct({ loginFailCount: 4 }), 'PASSWORD', false, 5)).toEqual({ result: 'LOCKED', loginFailCount: 5 });
    expect(evaluateTechLogin(acct({ loginFailCount: 5 }), 'PASSWORD', true, 5).result).toBe('LOCKED');
    expect(evaluateTechLogin(acct({ loginFailCount: 5 }), 'OTP', true, 5)).toEqual({ result: 'SUCCESS', loginFailCount: 0 });
  });
});

describe('01 §3.10 배정 상태 전이', () => {
  it('확정 배정은 이관 요청·이관·취소로 갈 수 있다', () => {
    expect(canTransitionAssignment('ACCEPTED', 'TRANSFER_REQUESTED')).toBe(true);
    expect(canTransitionAssignment('ACCEPTED', 'TRANSFERRED')).toBe(true);
    expect(canTransitionAssignment('TRANSFER_REQUESTED', 'ACCEPTED')).toBe(true);
  });
  it('이관·취소된 배정은 다시 바뀌지 않는다', () => {
    expect(() => assertAssignTransition('TRANSFERRED', 'ACCEPTED')).toThrow();
    expect(() => assertAssignTransition('CANCELED', 'ACCEPTED')).toThrow();
  });
});

describe('F-ADM-TEC-03 등급 변경', () => {
  it('다른 등급으로 사유와 함께 바꿀 수 있다', () => {
    expect(validateGradeChange('TRAINEE', 'REGULAR', '동행 3건 완료')).toBeNull();
  });
  it('같은 등급·사유 없음·없는 등급은 막는다', () => {
    expect(validateGradeChange('REGULAR', 'REGULAR', '사유')).toMatch(/같습니다/);
    expect(validateGradeChange('REGULAR', 'LEADER', ' ')).toBe('변경 사유는 필수 입력값입니다.');
    expect(validateGradeChange('REGULAR', 'BOSS', '사유')).toMatch(/올바르지/);
  });
});

describe('F-TEC-JOB-01 작업 목록', () => {
  const now = new Date('2027-03-02T10:00:00+09:00');
  const j = (status: string, iso: string | null) => ({ status, promisedAt: iso ? new Date(iso) : null });
  it('오늘·예정·미처리·완료 탭으로 나눈다', () => {
    expect(techJobTab(j('ASSIGNED', '2027-03-02T14:00:00+09:00'), now)).toBe('TODAY');
    expect(techJobTab(j('ASSIGNED', '2027-03-03T09:00:00+09:00'), now)).toBe('UPCOMING');
    expect(techJobTab(j('PENDING', '2027-03-01T09:00:00+09:00'), now)).toBe('PENDING');
    expect(techJobTab(j('COMPLETED', '2027-03-02T09:00:00+09:00'), now)).toBe('DONE');
  });
  it('미처리 먼저, 처리완료는 맨 아래, 나머지는 약속 시각 순', () => {
    const list = [j('COMPLETED', '2027-03-02T08:00:00+09:00'), j('ASSIGNED', '2027-03-02T15:00:00+09:00'), j('ASSIGNED', '2027-03-02T11:00:00+09:00'), j('PENDING', '2027-03-02T16:00:00+09:00')];
    expect(sortTechJobs(list).map((x) => x.status + x.promisedAt!.getUTCHours())).toEqual(['PENDING7', 'ASSIGNED2', 'ASSIGNED6', 'COMPLETED23']);
  });
  it('약속 시각이 지난 진행 중 작업만 경과시간을 보여 준다', () => {
    expect(elapsedMinutes(j('ASSIGNED', '2027-03-02T09:30:00+09:00'), now)).toBe(30);
    expect(elapsedMinutes(j('ASSIGNED', '2027-03-02T11:00:00+09:00'), now)).toBeNull();
    expect(elapsedMinutes(j('COMPLETED', '2027-03-02T09:30:00+09:00'), now)).toBeNull();
  });
  it('목록 주소는 도로명까지만 보여 준다(건물번호·상세주소 제외)', () => {
    expect(shortAddress('경기 성남시 분당구 판교역로 166')).toBe('경기 성남시 분당구 판교역로');
  });
});
