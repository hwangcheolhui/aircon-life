/**
 * 미처리 (F-TEC-WRK-08, 단계 5-2) · BR-031 사유 필수, 고객부재 2회 연속이면 운영자 확인 후에만 재약속 · BR-032 장기 미처리.
 * 미처리 사유 코드는 common_code PENDING_REASON.
 */
import { MSG } from '../messages';

export const PENDING_REASONS = [
  'CUSTOMER_ABSENT',
  'POSTPONED_CUSTOMER',
  'POSTPONED_TECH',
  'MATERIAL_SHORT',
  'UNSAFE_SITE',
  'WEATHER',
  'ETC',
] as const;

/** BR-031 입력 검증: 사유 필수, 기타는 메모 필수, 재약속 희망일은 오늘 이후 */
export function checkPendingInput(i: { pendingCode: string; memo: string; revisitDate: string | null; today: string }): Record<string, string> {
  const e: Record<string, string> = {};
  if (!(PENDING_REASONS as readonly string[]).includes(i.pendingCode)) e.pendingCode = MSG.required('미처리 사유');
  if (i.pendingCode === 'ETC' && !i.memo.trim()) e.memo = MSG.required('메모');
  if (i.revisitDate && i.revisitDate < i.today) e.revisitDate = '재약속 희망일은 오늘 이후로 골라 주세요.';
  return e;
}

/** BR-031 주문 상태 이력에서 직전까지 이어진 고객부재 미처리 횟수 (다른 사유 미처리가 끼면 끊긴다) */
export function absentStreak(history: readonly { toStatus: string; reasonCode: string | null }[]): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]!;
    if (h.toStatus !== 'PENDING') continue;
    if (h.reasonCode !== 'CUSTOMER_ABSENT') break;
    n++;
  }
  return n;
}

/** BR-031 고객부재 2회 연속이면 운영자 확인 후에만 재약속 */
export function needsOperatorConfirm(streak: number): boolean {
  return streak >= 2;
}

/** 가장 최근 PENDING 진입 시각 (이력은 시간순) */
export function pendingSince(history: readonly { toStatus: string; createdAt: Date }[]): Date | null {
  for (let i = history.length - 1; i >= 0; i--) if (history[i]!.toStatus === 'PENDING') return history[i]!.createdAt;
  return null;
}

/** BR-032 PENDING 이 된 지 PENDING_OVERDUE_HOURS(기본 48) 이상 = 장기 미처리 */
export function isLongPending(status: string, since: Date | null, now: Date, hours: number): boolean {
  if (status !== 'PENDING' || !since) return false;
  return now.getTime() - since.getTime() >= hours * 3600_000;
}
