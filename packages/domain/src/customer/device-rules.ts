/**
 * 내 기기·원클릭 재예약·사진 인식 (단계 9, F-CUS-DEV-01·02, F-CUS-QUO-05, 01 §2.2.3·2.4.3).
 * - 다음 권장 청소일 = 최근 청소일 + 권장 개월(작업 결과 recommend_next, 없으면 DEVICE_RECOMMEND_MONTHS)
 * - 재예약 견적 = 고른 기기의 형태 × 이전 작업 범위로 묶은 견적 줄(공용 견적 모듈 입력)
 * - 작업 완료 때 기기(주문 항목 × 대수)를 고객 보유 기기에 연결: 같은 주소·같은 형태의 기존 기기부터, 모자라면 새로 등록
 * 기준값은 system_setting 에서 읽어 넘긴다(CLAUDE.md §5).
 */
import { MSG } from '../messages';
import { addMonthsToDate } from '../ops/ops-rules';

export const DEVICE_CATEGORIES = ['AIRCON', 'WASHER', 'DRYER', 'HOOD', 'MATTRESS'] as const;
/** 이미지 인식 목적 (device_image.purpose) */
export const IMAGE_PURPOSES = ['DEVICE_TYPE', 'BRAND_LABEL', 'DIRT_LEVEL'] as const;
export const DIRT_LEVELS = ['LOW', 'MID', 'HIGH'] as const;
/** 사진 인식 결과를 그대로 믿어도 되는 신뢰도 하한. 이보다 낮으면 화면에서 "확인해 주세요"를 강조한다 */
export const RECOGNITION_CONFIDENT = 0.7;

export type FieldErrors = Record<string, string>;

/** C-DEV-020 기기 등록·수정 입력 검증 */
export function checkDeviceInput(i: {
  deviceType: string;
  deviceTypes: readonly string[];
  brand: string | null;
  brands: readonly string[];
  installYear: number | null;
  thisYear: number;
  addressId: number | null;
}): FieldErrors {
  const e: FieldErrors = {};
  if (!i.deviceTypes.includes(i.deviceType)) e.deviceType = MSG.required('기기 형태');
  if (i.brand && !i.brands.includes(i.brand)) e.brand = '제조사를 목록에서 골라 주세요.';
  if (i.installYear !== null && (!Number.isInteger(i.installYear) || i.installYear < 1980 || i.installYear > i.thisYear))
    e.installYear = `설치 연도는 1980~${i.thisYear} 사이로 입력해 주세요.`;
  if (!i.addressId) e.addressId = MSG.required('설치 주소');
  return e;
}

/** 다음 권장 청소일 (최근 청소일이 없으면 null) */
export function nextCleanDate(lastCleanedAt: string | null, recommendMonths: number | null, defaultMonths: number): string | null {
  if (!lastCleanedAt) return null;
  const m = recommendMonths && recommendMonths > 0 ? recommendMonths : defaultMonths;
  return addMonthsToDate(lastCleanedAt, m);
}

/** 권장일이 지났거나 오늘이면 "청소할 때가 됐어요" */
export const isCleanDue = (nextDate: string | null, today: string) => nextDate !== null && nextDate <= today;

/**
 * F-CUS-DEV-02 원클릭 재예약 견적 줄: 고른 기기를 (형태, 이전 작업 범위)로 묶어 대수를 센다.
 * 이전 작업 범위를 모르면 기본 범위(BASIC). 견적 가능한 형태만 남긴다.
 */
export function rebookLines(
  devices: readonly { deviceType: string; lastCleanLevel: string | null }[],
  quotable: readonly { deviceType: string; cleanLevel: string }[],
  defaultCleanLevel = 'BASIC',
): { lines: { deviceType: string; cleanLevel: string; quantity: number }[]; skipped: string[] } {
  const map = new Map<string, { deviceType: string; cleanLevel: string; quantity: number }>();
  const skipped: string[] = [];
  for (const d of devices) {
    const wanted = d.lastCleanLevel ?? defaultCleanLevel;
    const level = quotable.some((q) => q.deviceType === d.deviceType && q.cleanLevel === wanted)
      ? wanted
      : quotable.find((q) => q.deviceType === d.deviceType)?.cleanLevel;
    if (!level) {
      skipped.push(d.deviceType);
      continue;
    }
    const key = `${d.deviceType}|${level}`;
    const cur = map.get(key);
    if (cur) cur.quantity += 1;
    else map.set(key, { deviceType: d.deviceType, cleanLevel: level, quantity: 1 });
  }
  return { lines: [...map.values()], skipped };
}

/**
 * 작업 완료 때 기기 연결: 주문의 기기(주문 항목 × 대수)마다 고객 보유 기기 ID 를 정한다.
 * 이미 연결된 기기는 그대로, 아니면 같은 형태의 아직 쓰지 않은 기존 기기, 그것도 없으면 null(새로 등록).
 */
export function matchUnitsToDevices(
  units: readonly { key: string; deviceType: string; linkedDeviceId: number | null }[],
  devices: readonly { id: number; deviceType: string }[],
): Map<string, number | null> {
  const used = new Set(units.map((u) => u.linkedDeviceId).filter((v): v is number => v !== null));
  const out = new Map<string, number | null>();
  for (const u of units) {
    if (u.linkedDeviceId !== null) {
      out.set(u.key, u.linkedDeviceId);
      continue;
    }
    const hit = devices.find((d) => d.deviceType === u.deviceType && !used.has(d.id));
    if (hit) used.add(hit.id);
    out.set(u.key, hit?.id ?? null);
  }
  return out;
}

/** 사진 인식 결과를 견적 입력으로: 인식한 형태(고객이 고친 값 우선)별 대수 */
export function recognizedDeviceCounts(results: readonly { deviceType: string | null }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of results) if (r.deviceType) out[r.deviceType] = (out[r.deviceType] ?? 0) + 1;
  return out;
}
