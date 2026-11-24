import 'server-only';
/**
 * 기사 관할 구역 (단계 4-2: A-DSP-060, F-ADM-DSP-08).
 * - 구역 = 법정동 선택(DONG_SET) 또는 지도에 그린 다각형(DRAWN). 저장 때 구역 법정동(dong_codes)과 표시용 경계(boundary_geojson)를 함께 저장한다.
 *   DONG_SET 경계는 동 중심 둘레 근사 육각형을 합친 것(법정동 경계 데이터를 붙이기 전), DRAWN 법정동은 다각형 안에 중심이 든 거점 법정동.
 * - 관할 판단 기준인 technician_area 는 "오늘 유효한 구역"의 법정동으로 다시 만든다(zone_id 채움, 주 관할 구역에 든 동은 priority 1).
 *   구역이 하나라도 있는 기사의 활동지역은 구역에서만 정해지고, 기사 상세(A-TEC-020)에서 직접 고칠 수 없다.
 *   적용 기간이 시작·끝나는 날은 F-SYS-15 배치(매일)가 다시 맞춘다.
 * 거점 범위(BR-102)는 기사 소속 거점으로 확인한다.
 */
import { technician, technicianArea, technicianZone } from '@aircon/db';
import {
  type BranchFilter,
  type GeoShape,
  type Position,
  dongsInsidePolygon,
  hexagonAround,
  kstDate,
  mergePolygons,
  parseShape,
  polygonFromPoints,
  shapeCenter,
  validateRing,
  zoneCoverage,
} from '@aircon/domain';
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { UserError } from './action-result';
import { ForbiddenError } from './auth';
import { getDb } from './db';
import { branchDongs, dongRadius } from './geo';
import type { Actor, Tx } from './orders';

type Db = ReturnType<typeof getDb>;

export const ZONE_PALETTE = ['1', '2', '3', '4', '5', '6'] as const;

/** 오늘(KST) 유효한 구역인지 */
export const zoneValidOn = (z: { validFrom: string | null; validTo: string | null; deletedAt: Date | null }, day: string) =>
  z.deletedAt === null && (!z.validFrom || z.validFrom <= day) && (!z.validTo || z.validTo >= day);

/** 기사의 technician_area 를 오늘 유효한 구역으로 다시 만든다 (구역이 하나도 없으면 손대지 않음) */
export async function syncTechnicianAreasFromZones(db: Db | Tx, techId: number, actor: Actor, day = kstDate(new Date())): Promise<boolean> {
  const zones = await db.select().from(technicianZone).where(and(eq(technicianZone.technicianId, techId), isNull(technicianZone.deletedAt)));
  if (zones.length === 0) {
    // 구역을 모두 지웠다면 구역에서 만든 행만 정리한다
    await db.delete(technicianArea).where(and(eq(technicianArea.technicianId, techId), isNotNull(technicianArea.zoneId)));
    return false;
  }
  const map = new Map<string, { zoneId: number; priority: number }>();
  for (const z of zones) {
    if (!zoneValidOn(z, day)) continue;
    const p = z.zoneType === 'PRIMARY' ? 1 : 2;
    for (const code of z.dongCodes ?? []) {
      const cur = map.get(code);
      if (!cur || p < cur.priority) map.set(code, { zoneId: z.id, priority: p });
    }
  }
  await db.delete(technicianArea).where(eq(technicianArea.technicianId, techId));
  if (map.size) {
    await db.insert(technicianArea).values(
      [...map].map(([legalDongCode, v]) => ({ technicianId: techId, legalDongCode, zoneId: v.zoneId, priority: v.priority, createdBy: actor.id, updatedBy: actor.id })),
    );
  }
  return true;
}

/** 구역이 있는 기사 전원을 다시 맞춘다 (F-SYS-15 배치에서 하루 한 번: 적용 기간 시작·종료 반영) */
export async function syncAllZoneAreas(day = kstDate(new Date())) {
  const db = getDb();
  const rows = await db.selectDistinct({ id: technicianZone.technicianId }).from(technicianZone).where(isNull(technicianZone.deletedAt));
  for (const r of rows) await db.transaction((tx) => syncTechnicianAreasFromZones(tx, r.id, { type: 'SYSTEM', id: null }, day));
  return rows.length;
}

/** 이 기사가 관할 구역으로 관리되는지 (A-TEC-020 활동지역 직접 수정 막기) */
export async function hasZones(techId: number) {
  const [z] = await getDb()
    .select({ id: technicianZone.id })
    .from(technicianZone)
    .where(and(eq(technicianZone.technicianId, techId), isNull(technicianZone.deletedAt)))
    .limit(1);
  return Boolean(z);
}

function assertBranch(branchId: number, filter: BranchFilter) {
  if (filter.kind === 'NONE' || (filter.kind === 'BRANCH' && filter.branchId !== branchId)) throw new ForbiddenError('다른 거점의 기사입니다.');
}

/* ---------- A-DSP-060 화면 데이터 ---------- */

export async function loadZoneBoard(branchId: number, filter: BranchFilter, day = kstDate(new Date())) {
  assertBranch(branchId, filter);
  const db = getDb();
  const [techs, dongs] = await Promise.all([
    db
      .select({ id: technician.id, name: technician.name, displayName: technician.displayName, grade: technician.grade, status: technician.status })
      .from(technician)
      .where(and(eq(technician.branchId, branchId), inArray(technician.status, ['ACTIVE', 'TRAINING', 'PAUSED']), isNull(technician.deletedAt)))
      .orderBy(asc(technician.name)),
    branchDongs(branchId),
  ]);
  const ids = techs.map((t) => t.id);
  const [zones, areas] = await Promise.all([
    ids.length
      ? db
          .select()
          .from(technicianZone)
          .where(and(inArray(technicianZone.technicianId, ids), isNull(technicianZone.deletedAt)))
          .orderBy(asc(technicianZone.id))
      : Promise.resolve([]),
    ids.length ? db.select().from(technicianArea).where(inArray(technicianArea.technicianId, ids)) : Promise.resolve([]),
  ]);
  const coverage = zoneCoverage(
    dongs.map((d) => d.code),
    areas.map((a) => ({ technicianId: a.technicianId, code: a.legalDongCode, priority: a.priority })),
  );
  return {
    techs: techs.map((t) => ({ id: t.id, name: t.displayName || t.name, grade: t.grade, status: t.status })),
    dongs,
    zones: zones.map((z) => ({
      id: z.id,
      technicianId: z.technicianId,
      zoneName: z.zoneName,
      zoneType: z.zoneType,
      defineMethod: z.defineMethod,
      boundary: parseShape(z.boundaryGeojson),
      dongCodes: z.dongCodes ?? [],
      color: z.color ?? '1',
      validFrom: z.validFrom,
      validTo: z.validTo,
      activeToday: zoneValidOn(z, day),
    })),
    areas: areas.map((a) => ({ technicianId: a.technicianId, code: a.legalDongCode, priority: a.priority, zoneId: a.zoneId })),
    coverage,
  };
}

export type ZoneBoard = Awaited<ReturnType<typeof loadZoneBoard>>;

/* ---------- F-ADM-DSP-08 저장·삭제 ---------- */

export interface ZoneInput {
  id: number | null;
  technicianId: number;
  zoneName: string;
  zoneType: 'PRIMARY' | 'SECONDARY';
  defineMethod: 'DONG_SET' | 'DRAWN';
  dongCodes: string[];
  points: Position[];
  color: string;
  validFrom: string | null;
  validTo: string | null;
}

export async function saveZone(input: ZoneInput, filter: BranchFilter, actor: Actor) {
  const db = getDb();
  const [t] = await db.select({ id: technician.id, branchId: technician.branchId }).from(technician).where(and(eq(technician.id, input.technicianId), isNull(technician.deletedAt)));
  if (!t) throw new UserError('기사를 찾을 수 없습니다.');
  assertBranch(t.branchId, filter);
  if (input.validFrom && input.validTo && input.validFrom > input.validTo) throw new UserError('적용 종료일이 시작일보다 빠릅니다.');
  const dongs = await branchDongs(t.branchId);
  let boundary: GeoShape | null;
  let codes: string[];
  if (input.defineMethod === 'DONG_SET') {
    codes = [...new Set(input.dongCodes)];
    if (codes.length === 0) throw new UserError('관할 법정동은(는) 필수 입력값입니다.');
    const picked = dongs.filter((d) => codes.includes(d.code));
    if (picked.length !== codes.length) throw new UserError('소속 거점의 서비스 지역만 관할 구역으로 지정할 수 있습니다.');
    const radius = await dongRadius();
    boundary = mergePolygons(picked.map((d) => hexagonAround(d.center, radius)));
  } else {
    const err = validateRing(input.points);
    if (err) throw new UserError(err);
    boundary = polygonFromPoints(input.points);
    codes = dongsInsidePolygon(dongs, boundary);
    if (codes.length === 0) throw new UserError('그린 구역 안에 거점 서비스 지역(법정동 중심)이 없습니다. 구역을 넓혀 그려 주세요.');
  }
  const center = boundary ? shapeCenter(boundary) : null;
  const values = {
    technicianId: t.id,
    branchId: t.branchId,
    zoneName: input.zoneName,
    zoneType: input.zoneType,
    defineMethod: input.defineMethod,
    boundaryGeojson: boundary,
    dongCodes: codes,
    centerLat: center ? center.lat.toFixed(7) : null,
    centerLng: center ? center.lng.toFixed(7) : null,
    color: (ZONE_PALETTE as readonly string[]).includes(input.color) ? input.color : '1',
    validFrom: input.validFrom,
    validTo: input.validTo,
    updatedAt: new Date(),
    updatedBy: actor.id,
  };
  await db.transaction(async (tx) => {
    if (input.id) {
      const rows = await tx
        .update(technicianZone)
        .set(values)
        .where(and(eq(technicianZone.id, input.id), eq(technicianZone.technicianId, t.id), isNull(technicianZone.deletedAt)))
        .returning({ id: technicianZone.id });
      if (!rows.length) throw new UserError('관할 구역을 찾을 수 없습니다.');
    } else {
      await tx.insert(technicianZone).values({ ...values, createdBy: actor.id });
    }
    await syncTechnicianAreasFromZones(tx, t.id, actor);
  });
}

export async function deleteZone(id: number, filter: BranchFilter, actor: Actor) {
  const db = getDb();
  const [z] = await db.select().from(technicianZone).where(and(eq(technicianZone.id, id), isNull(technicianZone.deletedAt)));
  if (!z) throw new UserError('관할 구역을 찾을 수 없습니다.');
  assertBranch(z.branchId, filter);
  await db.transaction(async (tx) => {
    await tx.update(technicianZone).set({ deletedAt: new Date(), updatedAt: new Date(), updatedBy: actor.id }).where(eq(technicianZone.id, id));
    await syncTechnicianAreasFromZones(tx, z.technicianId, actor);
  });
}

/* ---------- 기사 앱 지도용 (F-TEC-MAP-02) ---------- */

export async function techZonesToday(techId: number, day = kstDate(new Date())) {
  const rows = await getDb()
    .select()
    .from(technicianZone)
    .where(and(eq(technicianZone.technicianId, techId), isNull(technicianZone.deletedAt)));
  return rows
    .filter((z) => zoneValidOn(z, day))
    .map((z) => ({ id: z.id, zoneName: z.zoneName, zoneType: z.zoneType, boundary: parseShape(z.boundaryGeojson), color: z.color ?? '1' }));
}
