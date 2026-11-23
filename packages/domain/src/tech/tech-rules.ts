/**
 * 기사 앱 규칙 (단계 4-1).
 * - F-TEC-AUTH-01 로그인: 휴대폰 번호 + 비밀번호 또는 인증번호(OTP). 상태 ACTIVE·TRAINING만 허용.
 *   비밀번호를 연속으로 틀리면(TECH_LOGIN_MAX_FAIL) 비밀번호 로그인을 막고, 인증번호 로그인에 성공하면 다시 풀린다.
 * - F-TEC-JOB-01 작업 목록: 탭 [오늘 | 예정 | 미처리 | 완료], 처리완료는 하단.
 * - F-TEC-HOM-02 오늘의 약속: 미처리 우선.
 */
import { kstDate } from '../quote/quote-status';

export const TECH_LOGIN_STATUSES = ['ACTIVE', 'TRAINING'] as const;

export interface TechLoginAccount {
  status: string;
  deleted: boolean;
  loginFailCount: number;
  hasPassword: boolean;
}

export type TechLoginOutcome =
  | { result: 'SUCCESS'; loginFailCount: 0 }
  | { result: 'INVALID'; loginFailCount: number; remaining: number }
  | { result: 'LOCKED'; loginFailCount: number }
  | { result: 'NO_PASSWORD' }
  | { result: 'UNAVAILABLE' };

/**
 * F-TEC-AUTH-01 로그인 판정.
 * method=OTP 는 휴대폰 인증이 끝난 상태(verified=true)로 부른다. 성공하면 비밀번호 실패 횟수를 0으로 돌린다.
 */
export function evaluateTechLogin(a: TechLoginAccount, method: 'PASSWORD' | 'OTP', verified: boolean, maxFail: number): TechLoginOutcome {
  if (a.deleted || !(TECH_LOGIN_STATUSES as readonly string[]).includes(a.status)) return { result: 'UNAVAILABLE' };
  if (method === 'OTP') return verified ? { result: 'SUCCESS', loginFailCount: 0 } : { result: 'UNAVAILABLE' };
  if (!a.hasPassword) return { result: 'NO_PASSWORD' };
  if (a.loginFailCount >= maxFail) return { result: 'LOCKED', loginFailCount: a.loginFailCount };
  if (verified) return { result: 'SUCCESS', loginFailCount: 0 };
  const count = a.loginFailCount + 1;
  if (count >= maxFail) return { result: 'LOCKED', loginFailCount: count };
  return { result: 'INVALID', loginFailCount: count, remaining: maxFail - count };
}

export const TECH_LOGIN_MESSAGES: Record<Exclude<TechLoginOutcome['result'], 'SUCCESS'>, string> = {
  INVALID: '휴대폰 번호 또는 비밀번호가 맞지 않습니다.',
  LOCKED: '비밀번호를 여러 번 틀려 비밀번호 로그인이 잠겼습니다. 인증번호로 로그인하면 풀립니다.',
  NO_PASSWORD: '아직 비밀번호가 없습니다. 인증번호로 로그인한 뒤 내 정보에서 비밀번호를 만들어 주세요.',
  UNAVAILABLE: '로그인할 수 없는 계정입니다. 거점에 문의해 주세요.',
};

/* ---------- F-TEC-JOB-01 작업 목록 ---------- */

export const TECH_JOB_TABS = ['TODAY', 'UPCOMING', 'PENDING', 'DONE'] as const;
export type TechJobTab = (typeof TECH_JOB_TABS)[number];

/** 처리 완료로 보는 주문 상태(목록 하단·배경색) */
export const TECH_DONE_STATUSES = ['WORK_DONE', 'COMPLETED', 'CANCELED'] as const;
export const isTechJobDone = (status: string) => (TECH_DONE_STATUSES as readonly string[]).includes(status);

export interface TechJobLike {
  status: string;
  promisedAt: Date | null;
}

/** 작업 1건이 어느 탭에 들어가는지 (오늘 = 한국 날짜 기준 오늘 약속) */
export function techJobTab(j: TechJobLike, now: Date): TechJobTab {
  if (isTechJobDone(j.status)) return 'DONE';
  if (j.status === 'PENDING') return 'PENDING';
  const today = kstDate(now);
  const day = j.promisedAt ? kstDate(j.promisedAt) : null;
  if (day && day > today) return 'UPCOMING';
  return 'TODAY';
}

/** 정렬: 미처리 → 진행 중(약속 시각 순) → 처리 완료(맨 아래) */
export function sortTechJobs<T extends TechJobLike>(jobs: readonly T[]): T[] {
  const rank = (j: T) => (j.status === 'PENDING' ? 0 : isTechJobDone(j.status) ? 2 : 1);
  return [...jobs].sort((a, b) => rank(a) - rank(b) || (a.promisedAt?.getTime() ?? 0) - (b.promisedAt?.getTime() ?? 0));
}

/** F-TEC-JOB-01 경과시간: 약속 시각을 지난 진행 중 작업의 지난 분 (없으면 null) */
export function elapsedMinutes(j: TechJobLike, now: Date): number | null {
  if (!j.promisedAt || isTechJobDone(j.status)) return null;
  const m = Math.floor((now.getTime() - j.promisedAt.getTime()) / 60_000);
  return m > 0 ? m : null;
}

/** 목록용 짧은 주소: 도로명 주소의 시·구·도로명까지 (건물번호·상세주소 제외) */
export function shortAddress(road: string): string {
  const parts = road.trim().split(/\s+/);
  const idx = parts.findIndex((p) => /(로|길)$/.test(p));
  return (idx >= 0 ? parts.slice(0, idx + 1) : parts.slice(0, 3)).join(' ');
}
