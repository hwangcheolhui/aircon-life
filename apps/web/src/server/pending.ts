import 'server-only';
/**
 * 장기 미처리 (단계 5-2) · BR-032 PENDING 후 PENDING_OVERDUE_HOURS(기본 48) 경과 = 장기 미처리(배지 overdue48h 색상 강조) · F-SYS-08 운영자 알림.
 * PENDING 진입 시각은 order_status_history 의 가장 최근 PENDING 행(INSERT ONLY)으로 정한다.
 */
import { orderStatusHistory, serviceOrder } from '@aircon/db';
import { SETTING_KEYS, isLongPending, pendingSince } from '@aircon/domain';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from './db';
import { alreadyNotified, notifyStaff } from './notify';
import { getSettingNumber } from './settings';

/** 주문별 가장 최근 PENDING 진입 시각 */
export async function pendingSinceOf(orderIds: readonly number[]): Promise<Map<number, Date>> {
  const out = new Map<number, Date>();
  if (!orderIds.length) return out;
  const rows = await getDb()
    .select({ orderId: orderStatusHistory.orderId, toStatus: orderStatusHistory.toStatus, createdAt: orderStatusHistory.createdAt })
    .from(orderStatusHistory)
    .where(inArray(orderStatusHistory.orderId, [...orderIds]))
    .orderBy(asc(orderStatusHistory.id));
  const by = new Map<number, { toStatus: string; createdAt: Date }[]>();
  for (const r of rows) by.set(r.orderId, [...(by.get(r.orderId) ?? []), r]);
  for (const [id, h] of by) {
    const s = pendingSince(h);
    if (s) out.set(id, s);
  }
  return out;
}

/** 화면 표시용: 장기 미처리 주문 ID 집합 (BR-032) */
export async function longPendingIds(orders: readonly { id: number; status: string }[], now = new Date()): Promise<Set<number>> {
  const pend = orders.filter((o) => o.status === 'PENDING');
  if (!pend.length) return new Set();
  const [hours, since] = await Promise.all([getSettingNumber(SETTING_KEYS.PENDING_OVERDUE_HOURS), pendingSinceOf(pend.map((o) => o.id))]);
  return new Set(pend.filter((o) => isLongPending(o.status, since.get(o.id) ?? null, now, hours)).map((o) => o.id));
}

/** F-SYS-08 장기 미처리 운영자 알림: 미처리 건마다 1회 (같은 미처리 구간에 이미 보냈으면 건너뜀) */
export async function alertLongPending(now = new Date()): Promise<number> {
  const rows = await getDb()
    .select({ id: serviceOrder.id, status: serviceOrder.status })
    .from(serviceOrder)
    .where(and(eq(serviceOrder.status, 'PENDING'), isNull(serviceOrder.deletedAt)));
  const overdue = await longPendingIds(rows, now);
  let sent = 0;
  for (const id of overdue) {
    if (await alreadyNotified('PENDING_OVERDUE', id)) continue;
    await notifyStaff('PENDING_OVERDUE', { type: 'ADMIN', id: null }, id);
    sent++;
  }
  return sent;
}
