/**
 * BR-021 슬롯 예약·해제 (01 §2.8.1 "예약 시 booked_count < capacity 조건부 UPDATE(낙관적 잠금)").
 * 트랜잭션 안에서 호출한다. 한 칸이라도 잔여가 없으면 false 를 돌려주고, 호출한 쪽은 트랜잭션을 되돌린다.
 */
import { and, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from './client';
import { timeSlot } from './schema';

type Tx = Pick<Db, 'update'>;

export interface SlotTarget {
  branchId: number;
  slotDate: string;
  hours: readonly number[];
  slotKind?: string;
  /** 차지할 건수 (필요 인원, 기본 1) */
  units?: number;
}

/** 조건부 UPDATE: 마감 아님 + booked_count + units ≤ capacity 인 칸만 늘린다. 모든 칸이 늘어나야 성공 */
export async function bookSlots(tx: Tx, t: SlotTarget): Promise<boolean> {
  const units = t.units ?? 1;
  if (t.hours.length === 0) return false;
  const rows = await tx
    .update(timeSlot)
    .set({ bookedCount: sql`${timeSlot.bookedCount} + ${units}`, updatedAt: new Date() })
    .where(
      and(
        eq(timeSlot.branchId, t.branchId),
        eq(timeSlot.slotDate, t.slotDate),
        eq(timeSlot.slotKind, t.slotKind ?? 'NORMAL'),
        inArray(timeSlot.slotHour, [...t.hours]),
        eq(timeSlot.isClosed, false),
        lt(timeSlot.bookedCount, sql`${timeSlot.capacity} - ${units - 1}`),
      ),
    )
    .returning({ id: timeSlot.id });
  return rows.length === t.hours.length;
}

/** 취소·일정 변경 시 차지했던 칸을 돌려준다 (0 아래로는 내려가지 않음) */
export async function releaseSlots(tx: Tx, t: SlotTarget): Promise<void> {
  const units = t.units ?? 1;
  if (t.hours.length === 0) return;
  await tx
    .update(timeSlot)
    .set({ bookedCount: sql`greatest(${timeSlot.bookedCount} - ${units}, 0)`, updatedAt: new Date() })
    .where(
      and(
        eq(timeSlot.branchId, t.branchId),
        eq(timeSlot.slotDate, t.slotDate),
        eq(timeSlot.slotKind, t.slotKind ?? 'NORMAL'),
        inArray(timeSlot.slotHour, [...t.hours]),
        gt(timeSlot.bookedCount, 0),
      ),
    );
}
