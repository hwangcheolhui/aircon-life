/**
 * 상담 상태 전이 (01 §3.5 `consultation.status`) · 상담 번호 (01 §2.6.2).
 * 상담 상태 변경은 이 전이표를 거친다. 상담에는 상태 이력 테이블이 없어 상태 컬럼만 바꾼다.
 */
import { kstYymmdd } from '../quote/quote-status';

export const CONSULT_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'TRANSFERRED'] as const;
export type ConsultStatus = (typeof CONSULT_STATUSES)[number];

/** 01 §3.5: OPEN(미완료) → IN_PROGRESS → DONE / TRANSFERRED */
export const CONSULT_TRANSITIONS: Readonly<Record<ConsultStatus, readonly ConsultStatus[]>> = {
  OPEN: ['IN_PROGRESS', 'DONE', 'TRANSFERRED'],
  IN_PROGRESS: ['DONE', 'TRANSFERRED'],
  DONE: [],
  TRANSFERRED: [],
};

/** 상담 생성 시 첫 상태: 통화 중 끝난 상담은 바로 DONE, 후속 처리가 남으면 OPEN (01 §3.5 단계 3 메모) */
export const CONSULT_INITIAL_STATUSES: readonly ConsultStatus[] = ['OPEN', 'DONE'];

/** 미완료 상담 (BR-022 Alert 대상) */
export const OPEN_CONSULT_STATUSES: readonly ConsultStatus[] = ['OPEN', 'IN_PROGRESS'];

export function canTransitionConsult(from: string | null, to: ConsultStatus): boolean {
  if (from === null) return CONSULT_INITIAL_STATUSES.includes(to);
  return (CONSULT_TRANSITIONS[from as ConsultStatus] ?? []).includes(to);
}

export function assertConsultTransition(from: string | null, to: ConsultStatus): void {
  if (!canTransitionConsult(from, to)) throw new Error(`상담 상태를 ${from ?? '(신규)'}에서 ${to}(으)로 바꿀 수 없습니다.`);
}

/** 상담 번호 `J2611220001` = J + 한국 날짜 YYMMDD + 그날 4자리 일련 (01 §2.6.2) */
export function formatConsultNo(at: Date, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1 || seq > 9999) throw new Error('하루에 만들 수 있는 상담 번호를 넘었습니다.');
  return `J${kstYymmdd(at)}${String(seq).padStart(4, '0')}`;
}
