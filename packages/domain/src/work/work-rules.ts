/**
 * 현장작업 업무 규칙 (단계 5-1: F-TEC-WRK-01~04·07, BR-041·043, F-CUS-ORD-05).
 * 기준값(처리 내용 최소 글자 수 등)은 system_setting 에서 읽어 넘긴다(CLAUDE.md §5).
 */

/* ---------- BR-043 안전 체크리스트 (T-WRK-011) ---------- */

/** common_code SAFETY_CHECK 순서 그대로 (고소·전기·보호구·약품) */
export const SAFETY_CHECK_ITEMS = ['HIGH_PLACE', 'ELECTRIC', 'PROTECTIVE', 'CHEMICAL'] as const;
export type SafetyCheckItem = (typeof SAFETY_CHECK_ITEMS)[number];

/** BR-043 네 항목을 모두 확인해야 작업 시작. 고소작업을 혼자 하면 2인 이상 권장 경고(막지는 않음) */
export function checkSafety(i: { checked: readonly string[]; highPlaceWork: boolean; teamSize: number }): {
  ok: boolean;
  missing: SafetyCheckItem[];
  soloHighPlaceWarning: boolean;
} {
  const missing = SAFETY_CHECK_ITEMS.filter((s) => !i.checked.includes(s));
  return { ok: missing.length === 0, missing, soloHighPlaceWarning: i.highPlaceWork && i.teamSize < 2 };
}

/* ---------- F-TEC-WRK-01 출발 ---------- */

export interface DepartureInput {
  orderNo: string;
  orderStatus: string;
  /** assignment.role */
  role: string;
  /** 약속일(한국 날짜 YYYY-MM-DD) */
  promisedDate: string | null;
  today: string;
  /** 이 기사가 이미 진행 중(출발~작업중)인 다른 작업 */
  otherActiveOrderNo: string | null;
  /** 확정 코스의 다음 방문지(아직 끝나지 않은 첫 작업). 코스가 없거나 미확정이면 null */
  nextStopOrderNo: string | null;
}

export type DepartureCheck = { ok: true; warning: string | null } | { ok: false; message: string };

/** 출발은 오늘 약속·배정완료·주기사만, 진행 중 작업은 한 건만. 코스 순서와 다르면 경고만 한다(4-2 확정 코스 기준) */
export function checkDeparture(i: DepartureInput): DepartureCheck {
  if (i.role !== 'MAIN') return { ok: false, message: '출발·완료 처리는 주기사만 할 수 있습니다.' };
  if (i.orderStatus !== 'ASSIGNED') return { ok: false, message: '배정완료 상태인 작업만 출발할 수 있습니다.' };
  if (!i.promisedDate || i.promisedDate !== i.today) return { ok: false, message: '오늘 약속된 작업만 출발할 수 있습니다.' };
  if (i.otherActiveOrderNo)
    return { ok: false, message: `진행 중인 작업(${i.otherActiveOrderNo})을 먼저 완료하거나 미처리로 저장해 주세요.` };
  const warning =
    i.nextStopOrderNo && i.nextStopOrderNo !== i.orderNo
      ? `확정 코스의 다음 방문지는 ${i.nextStopOrderNo}입니다. 순서를 바꿔 이 작업으로 먼저 출발할까요?`
      : null;
  return { ok: true, warning };
}

/* ---------- 기기 단위 (T-WRK-020·030) ---------- */

export interface WorkUnit {
  orderItemId: number;
  /** 같은 주문 항목 안의 몇 번째 기기(1부터) */
  unitNo: number;
  label: string;
}

/** 작업 대상 기기 = 상품(PRODUCT) 주문 항목 × 수량. 옵션·할증·할인 항목은 기기가 아니다 */
export function workUnits(
  items: readonly { id: number; itemType: string; quantity: number; name: string }[],
): WorkUnit[] {
  return items
    .filter((i) => i.itemType === 'PRODUCT' && i.quantity > 0)
    .flatMap((i) =>
      Array.from({ length: i.quantity }, (_, k) => ({
        orderItemId: i.id,
        unitNo: k + 1,
        label: i.quantity > 1 ? `${i.name} ${k + 1}` : i.name,
      })),
    );
}

const unitKey = (u: { orderItemId: number; unitNo: number }) => `${u.orderItemId}:${u.unitNo}`;

/* ---------- BR-041 / F-TEC-WRK-07 처리 저장(완료) ---------- */

/** work_result.result: DONE 완료 / PARTIAL 일부 / SKIPPED 작업 불가 */
export const WORK_RESULTS = ['DONE', 'PARTIAL', 'SKIPPED'] as const;
export type WorkResult = (typeof WORK_RESULTS)[number];
/** 작업한(사진이 필요한) 결과 */
const isWorked = (r: string) => r === 'DONE' || r === 'PARTIAL';

export type CompletionProblemCode =
  | 'NOT_IN_PROGRESS'
  | 'SAFETY'
  | 'RESULT_MISSING'
  | 'NOTHING_DONE'
  | 'PHOTO_MISSING'
  | 'EXTRA_PENDING'
  | 'NOTE_SHORT';

export interface CompletionInput {
  workStatus: string;
  units: readonly WorkUnit[];
  results: readonly { orderItemId: number; unitNo: number; result: string }[];
  photos: readonly { orderItemId: number | null; unitNo: number | null; photoType: string }[];
  safetyDone: boolean;
  /** 고객 동의도 철회도 안 된 추가요금 건수 (단계 5-2) */
  pendingExtraCharges: number;
  workNote: string | null;
  /** WORK_NOTE_MIN_LENGTH */
  noteMinLength: number;
}

/**
 * F-TEC-WRK-07 필수 검증: ① 모든 기기 결과 ② 작업한 기기마다 BEFORE·AFTER 각 1장 이상(BR-041) ③ 안전 체크(BR-043)
 * ④ 추가요금 동의 완료 또는 철회 ⑤ 처리 내용 N자 이상(공백 제외). 모두 작업 불가면 완료 대신 미처리로 저장한다.
 */
export function checkCompletion(i: CompletionInput): {
  ok: boolean;
  problems: { code: CompletionProblemCode; message: string }[];
} {
  const problems: { code: CompletionProblemCode; message: string }[] = [];
  const add = (code: CompletionProblemCode, message: string) => problems.push({ code, message });
  if (i.workStatus !== 'IN_PROGRESS') add('NOT_IN_PROGRESS', '작업을 시작한 뒤에 완료할 수 있습니다.');
  if (!i.safetyDone) add('SAFETY', '안전 체크리스트를 먼저 마쳐 주세요.');
  const results = new Map(i.results.map((r) => [unitKey(r), r.result]));
  for (const u of i.units) if (!results.has(unitKey(u))) add('RESULT_MISSING', `${u.label} 처리 결과를 입력해 주세요.`);
  const entered = i.units.filter((u) => results.has(unitKey(u)));
  if (entered.length === i.units.length && i.units.length > 0 && !entered.some((u) => isWorked(results.get(unitKey(u))!)))
    add('NOTHING_DONE', '작업한 기기가 없습니다. 완료 대신 미처리로 저장해 주세요.');
  const has = new Set(
    i.photos.filter((p) => p.orderItemId !== null && p.unitNo !== null).map((p) => `${p.orderItemId}:${p.unitNo}:${p.photoType}`),
  );
  for (const u of entered) {
    if (!isWorked(results.get(unitKey(u))!)) continue;
    if (!has.has(`${unitKey(u)}:BEFORE`)) add('PHOTO_MISSING', `${u.label} 작업 전 사진이 없습니다.`);
    if (!has.has(`${unitKey(u)}:AFTER`)) add('PHOTO_MISSING', `${u.label} 작업 후 사진이 없습니다.`);
  }
  if (i.pendingExtraCharges > 0) add('EXTRA_PENDING', '고객 동의를 기다리는 추가요금이 있습니다.');
  if ((i.workNote ?? '').replace(/\s/g, '').length < i.noteMinLength)
    add('NOTE_SHORT', `처리 내용을 ${i.noteMinLength}자 이상 입력해 주세요.`);
  return { ok: problems.length === 0, problems };
}

/** F-TEC-WRK-07 final_amount = 작업비 + 동의된 추가요금 + 자재판매 − 할인 (BR-040: 동의 안 된 추가요금은 넣지 않는다) */
export function finalAmount(i: { laborAmount: number; agreedExtra: number; materialAmount: number; discountAmount: number }): number {
  return Math.max(i.laborAmount + i.agreedExtra + i.materialAmount - i.discountAmount, 0);
}

/** work_minutes: 작업 시작~종료(분, 반올림) */
export function workMinutes(startedAt: Date | null, finishedAt: Date | null): number | null {
  if (!startedAt || !finishedAt) return null;
  return Math.max(Math.round((finishedAt.getTime() - startedAt.getTime()) / 60_000), 0);
}

/** order_item.item_status: 한 대라도 작업했으면 DONE, 모두 불가면 SKIPPED */
export function itemStatusFromResults(results: readonly string[]): 'DONE' | 'SKIPPED' {
  return results.some(isWorked) ? 'DONE' : 'SKIPPED';
}

/** work_order.result_code (RESULT_CODE). repairGuided = 발견 이슈를 고객에게 수리 안내함 */
export function resultCodeFromResults(results: readonly string[], repairGuided: boolean): string {
  if (!results.some(isWorked)) return 'NOT_CLEANABLE';
  if (repairGuided) return 'NEED_REPAIR';
  return results.every((r) => r === 'DONE') ? 'DONE_NORMAL' : 'DONE_PARTIAL';
}

/* ---------- F-CUS-ORD-05 작업 리포트 ---------- */

export function canSeeWorkReport(orderStatus: string): boolean {
  return orderStatus === 'WORK_DONE' || orderStatus === 'COMPLETED';
}
