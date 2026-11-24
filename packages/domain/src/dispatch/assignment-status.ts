/**
 * 배정 상태 전이 (01 §3.10 `assignment.status`, 단계 4-1). 배정 상태 변경은 이 전이표를 거치고
 * assignment_history 에 1행 INSERT 한다.
 * - 운영자 배정: 바로 ACCEPTED (F-ADM-DSP-01)
 * - 재배정(F-ADM-DSP-04): 기존 ACCEPTED → TRANSFERRED, 새 기사 ACCEPTED (이력 REASSIGN)
 * - 기사 이관 요청(F-TEC-JOB-05): ACCEPTED → TRANSFER_REQUESTED (이력 TRANSFER_REQUEST)
 *   승인: TRANSFER_REQUESTED → TRANSFERRED + 새 기사 ACCEPTED (이력 TRANSFER) / 반려: → ACCEPTED (이력 TRANSFER_REJECT)
 * - 배정 취소: → CANCELED (이력 UNASSIGN), 주문은 ASSIGNED → ASSIGN_WAIT
 * - 자가 배정(단계 4-2, F-TEC-RTE-04): 기사 요청 REQUESTED(이력 SELF_REQUEST) → 승인 ACCEPTED(SELF_APPROVE) / 반려 REJECTED(SELF_REJECT).
 *   승인이 필요 없으면 바로 ACCEPTED(SELF_REQUEST + SELF_APPROVE). PROPOSED(제안)는 단계 9.
 */
import { MSG } from '../messages';

export const ASSIGN_STATUSES = ['REQUESTED', 'PROPOSED', 'ACCEPTED', 'TRANSFER_REQUESTED', 'REJECTED', 'TRANSFERRED', 'CANCELED'] as const;
export type AssignStatus = (typeof ASSIGN_STATUSES)[number];

export const ASSIGN_TRANSITIONS: Readonly<Record<AssignStatus, readonly AssignStatus[]>> = {
  REQUESTED: ['ACCEPTED', 'REJECTED', 'CANCELED'],
  PROPOSED: ['ACCEPTED', 'REJECTED', 'CANCELED'],
  ACCEPTED: ['TRANSFER_REQUESTED', 'TRANSFERRED', 'CANCELED'],
  TRANSFER_REQUESTED: ['ACCEPTED', 'TRANSFERRED', 'CANCELED'],
  REJECTED: [],
  TRANSFERRED: [],
  CANCELED: [],
};

/** 아직 살아 있는 배정 (기사 일정을 차지함) */
export const ACTIVE_ASSIGN_STATUSES: readonly AssignStatus[] = ['REQUESTED', 'PROPOSED', 'ACCEPTED', 'TRANSFER_REQUESTED'];

/** 확정된 배정 (기사 앱 작업 목록·고객 "배정 기사"에 보임) */
export const CONFIRMED_ASSIGN_STATUSES: readonly AssignStatus[] = ['ACCEPTED', 'TRANSFER_REQUESTED'];

export function canTransitionAssignment(from: string, to: AssignStatus): boolean {
  return (ASSIGN_TRANSITIONS[from as AssignStatus] ?? []).includes(to);
}

export function assertAssignTransition(from: string, to: AssignStatus): void {
  if (!canTransitionAssignment(from, to)) throw new Error(`배정 상태를 ${from}에서 ${to}(으)로 바꿀 수 없습니다.`);
}

/** 01 §4 ASSIGN_ACTION */
export type AssignAction = 'ASSIGN' | 'REASSIGN' | 'TRANSFER' | 'UNASSIGN' | 'SELF_REQUEST' | 'SELF_APPROVE' | 'SELF_REJECT' | 'TRANSFER_REQUEST' | 'TRANSFER_REJECT';

/** BR-071 동행 완료 건수 표시 "동행 1/3" */
export const accompanyLabel = (done: number, required: number) => `동행 ${Math.min(done, required)}/${required}`;

/* ---------- 등급 변경 (F-ADM-TEC-03) ---------- */

export const TECH_GRADES = ['TRAINEE', 'REGULAR', 'LEADER'] as const;

/** 등급 변경 검증: 다른 등급으로만, 사유 필수. 오류 문구 또는 null */
export function validateGradeChange(from: string, to: string, reason: string | null): string | null {
  if (!(TECH_GRADES as readonly string[]).includes(to)) return '등급이 올바르지 않습니다.';
  if (from === to) return '현재 등급과 같습니다.';
  if (!reason?.trim()) return MSG.required('변경 사유');
  return null;
}
