import 'server-only';
/**
 * 근무 시작/종료 · 위치 수집 (단계 4-2: F-TEC-AUTH-02, F-TEC-MAP-05, F-SYS-18, BR-115).
 * - 최초 1회 위치정보 수집 동의(technician.location_agreed_at, 감사 로그 남김) 후에만 근무를 시작할 수 있다.
 * - 근무 중(technician.duty_started_at 이 있음)에만 위치를 받는다(canCollectLocation). 근무 종료하면 받지 않는다.
 * - 고객에게는 좌표를 주지 않는다(customerVisitTime 은 시각만). 관리자 코스 모니터링(A-DSP-070)은 단계 9.
 * - 원본 위치는 LOCATION_RETENTION_DAYS(90일) 뒤 삭제하고, 그 전에 일별 이동거리(technician_daily_distance)를 집계한다.
 */
import { routePlan, technician, technicianDailyDistance, technicianLocation } from '@aircon/db';
import { SETTING_KEYS, canCollectLocation, haversineMeters, kstDate } from '@aircon/domain';
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { UserError } from './action-result';
import { writeAudit } from './audit';
import { getDb } from './db';
import { toLatLng } from './geo';
import { getSettingNumber } from './settings';

export async function getDutyState(techId: number) {
  const [[t], interval] = await Promise.all([
    getDb()
      .select({ agreed: technician.locationAgreedAt, since: technician.dutyStartedAt })
      .from(technician)
      .where(eq(technician.id, techId)),
    getSettingNumber(SETTING_KEYS.LOCATION_INTERVAL_SEC),
  ]);
  return {
    locationAgreed: Boolean(t?.agreed),
    onDuty: Boolean(t?.since),
    since: t?.since?.toISOString() ?? null,
    intervalSec: interval,
  };
}

/** 위치정보 수집 동의 (최초 1회) */
export async function agreeLocation(techId: number) {
  const rows = await getDb()
    .update(technician)
    .set({ locationAgreedAt: new Date(), updatedAt: new Date(), updatedBy: techId })
    .where(and(eq(technician.id, techId), sql`${technician.locationAgreedAt} IS NULL`))
    .returning({ id: technician.id });
  if (rows.length)
    await writeAudit({
      actorType: 'TECHNICIAN',
      actorId: techId,
      action: 'UPDATE',
      targetTable: 'technician',
      targetId: techId,
      detail: { consent: 'LOCATION', agree: true },
    });
}

export async function startDuty(techId: number) {
  const [t] = await getDb()
    .select({ agreed: technician.locationAgreedAt })
    .from(technician)
    .where(eq(technician.id, techId));
  if (!t?.agreed) throw new UserError('위치정보 수집에 동의해야 근무를 시작할 수 있습니다.');
  await getDb()
    .update(technician)
    .set({ dutyStartedAt: new Date(), updatedAt: new Date(), updatedBy: techId })
    .where(eq(technician.id, techId));
}

export async function endDuty(techId: number) {
  await getDb()
    .update(technician)
    .set({ dutyStartedAt: null, updatedAt: new Date(), updatedBy: techId })
    .where(eq(technician.id, techId));
}

/** 근무 중 위치 1건 (BR-115: 동의 + 근무 중이 아니면 받지 않음). 너무 잦은 전송은 간격의 절반 이내면 버린다 */
export async function recordLocation(
  techId: number,
  p: { lat: number; lng: number; accuracyM: number | null; speedKmh: number | null },
  now = new Date(),
) {
  const db = getDb();
  const [t] = await db
    .select({ agreed: technician.locationAgreedAt, since: technician.dutyStartedAt })
    .from(technician)
    .where(eq(technician.id, techId));
  if (!t || !canCollectLocation({ locationAgreedAt: t.agreed, dutyStartedAt: t.since }))
    return { saved: false as const, reason: 'OFF_DUTY' };
  const interval = await getSettingNumber(SETTING_KEYS.LOCATION_INTERVAL_SEC);
  const [last] = await db
    .select({ at: technicianLocation.recordedAt })
    .from(technicianLocation)
    .where(eq(technicianLocation.technicianId, techId))
    .orderBy(desc(technicianLocation.recordedAt))
    .limit(1);
  if (last && now.getTime() - last.at.getTime() < (interval * 1000) / 2)
    return { saved: false as const, reason: 'TOO_SOON' };
  const [plan] = await db
    .select({ id: routePlan.id })
    .from(routePlan)
    .where(and(eq(routePlan.technicianId, techId), eq(routePlan.planDate, kstDate(now))));
  await db.insert(technicianLocation).values({
    technicianId: techId,
    lat: p.lat.toFixed(7),
    lng: p.lng.toFixed(7),
    accuracyM: p.accuracyM === null ? null : Math.round(p.accuracyM),
    speedKmh: p.speedKmh === null ? null : p.speedKmh.toFixed(1),
    routePlanId: plan?.id ?? null,
    recordedAt: now,
  });
  return { saved: true as const };
}

/** 지도에 보일 내 위치 (근무 중일 때 오늘 마지막 위치만) */
export async function myLatestLocation(techId: number, now = new Date()) {
  const db = getDb();
  const [t] = await db
    .select({ since: technician.dutyStartedAt })
    .from(technician)
    .where(eq(technician.id, techId));
  if (!t?.since) return null;
  const [l] = await db
    .select()
    .from(technicianLocation)
    .where(and(eq(technicianLocation.technicianId, techId), gte(technicianLocation.recordedAt, t.since)))
    .orderBy(desc(technicianLocation.recordedAt))
    .limit(1);
  if (!l || kstDate(l.recordedAt) !== kstDate(now)) return null;
  const p = toLatLng(l.lat, l.lng);
  return p ? { ...p, recordedAt: l.recordedAt.toISOString() } : null;
}

/* ---------- F-SYS-18 위치 기록 정리 (매일 04:00) ---------- */

const DAY = 24 * 3600_000;

/** 어제까지 집계 안 된 날의 이동거리를 집계하고, 보관기간이 지난 원본을 지운다 */
export async function purgeLocations(now = new Date()) {
  const db = getDb();
  const days = await getSettingNumber(SETTING_KEYS.LOCATION_RETENTION_DAYS);
  const today = kstDate(now);
  const todayStart = new Date(`${today}T00:00:00+09:00`);
  const rows = await db
    .select({
      technicianId: technicianLocation.technicianId,
      lat: technicianLocation.lat,
      lng: technicianLocation.lng,
      at: technicianLocation.recordedAt,
    })
    .from(technicianLocation)
    .where(
      and(
        lt(technicianLocation.recordedAt, todayStart),
        sql`NOT EXISTS (SELECT 1 FROM technician_daily_distance d WHERE d.technician_id = ${technicianLocation.technicianId}
          AND d.work_date = (${technicianLocation.recordedAt} AT TIME ZONE 'Asia/Seoul')::date)`,
      ),
    )
    .orderBy(asc(technicianLocation.technicianId), asc(technicianLocation.recordedAt));
  const agg = new Map<
    string,
    {
      technicianId: number;
      workDate: string;
      distanceM: number;
      pointCount: number;
      last: { lat: number; lng: number } | null;
    }
  >();
  for (const r of rows) {
    const key = `${r.technicianId}|${kstDate(r.at)}`;
    const cur = agg.get(key) ?? {
      technicianId: r.technicianId,
      workDate: kstDate(r.at),
      distanceM: 0,
      pointCount: 0,
      last: null,
    };
    const p = toLatLng(r.lat, r.lng)!;
    if (cur.last) cur.distanceM += haversineMeters(cur.last, p);
    cur.last = p;
    cur.pointCount++;
    agg.set(key, cur);
  }
  if (agg.size) {
    await db
      .insert(technicianDailyDistance)
      .values(
        [...agg.values()].map((a) => ({
          technicianId: a.technicianId,
          workDate: a.workDate,
          distanceM: Math.round(a.distanceM),
          pointCount: a.pointCount,
        })),
      )
      .onConflictDoNothing();
  }
  const cutoff = new Date(todayStart.getTime() - days * DAY);
  const deleted = await db
    .delete(technicianLocation)
    .where(lt(technicianLocation.recordedAt, cutoff))
    .returning({ id: technicianLocation.id });
  return { aggregatedDays: agg.size, deleted: deleted.length };
}
