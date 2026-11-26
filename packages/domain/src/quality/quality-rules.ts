/**
 * 품질 업무 규칙 (단계 9): 후기(F-CUS-REV-01, F-ADM-VOC-04, F-SYS-05)·작업 결과 검수(F-ADM-PRC-03).
 * - BR-090 평점 REVIEW_VOC_MAX_RATING(2)점 이하 후기는 VOC 를 자동으로 만든다
 * - 후기는 완료(작업 완료·결제 완료) 주문에만, 완료 후 REVIEW_WRITABLE_DAYS(7)일 안에 1건
 * - 검수: 대기 → 승인 | 반려, 반려 → 승인(재검수). 반려 건은 정산 대상에서 빠지고, INSPECTION_REQUIRED=Y 면 승인 건만 정산
 * 기준값은 system_setting 에서 읽어 넘긴다(CLAUDE.md §5).
 */
import { MSG } from '../messages';

export type FieldErrors = Record<string, string>;

/* ---------- 후기 ---------- */

/** 후기 작성 가능한 주문 상태 (01 §3.1 작업완료·완료) */
export const REVIEWABLE_ORDER_STATUSES = ['WORK_DONE', 'COMPLETED'] as const;
export const REVIEW_PHOTO_MAX = 3;
export const REVIEW_CONTENT_MAX = 1000;

/** 후기 작성 가능 여부와 마감 시각 */
export function reviewWindow(i: {
  orderStatus: string;
  orderType: string;
  completedAt: Date | null;
  hasReview: boolean;
  now: Date;
  writableDays: number;
}): { ok: true; until: Date } | { ok: false; reason: string } {
  if (i.hasReview) return { ok: false, reason: '이미 후기를 남긴 예약입니다.' };
  if (!(REVIEWABLE_ORDER_STATUSES as readonly string[]).includes(i.orderStatus) || !i.completedAt)
    return { ok: false, reason: '작업이 끝난 예약에만 후기를 남길 수 있어요.' };
  const until = new Date(i.completedAt.getTime() + i.writableDays * 86_400_000);
  if (i.now.getTime() > until.getTime()) return { ok: false, reason: `작업 완료 후 ${i.writableDays}일이 지나 후기를 남길 수 없어요.` };
  return { ok: true, until };
}

/** C-REV-010 입력 검증: 평점 1~5 필수, 추천의향 0~10(선택), 태그는 코드 목록 안, 사진 최대 3장 */
export function checkReviewInput(i: {
  rating: number | null;
  npsScore: number | null;
  tags: readonly string[];
  allowedTags: readonly string[];
  content: string;
  photoCount: number;
}): FieldErrors {
  const e: FieldErrors = {};
  if (i.rating === null || !Number.isInteger(i.rating) || i.rating < 1 || i.rating > 5) e.rating = MSG.required('평점');
  if (i.npsScore !== null && (!Number.isInteger(i.npsScore) || i.npsScore < 0 || i.npsScore > 10)) e.npsScore = '추천 의향은 0~10 사이로 골라 주세요.';
  if (i.tags.some((t) => !i.allowedTags.includes(t))) e.tags = '태그를 목록에서 골라 주세요.';
  if (i.content.length > REVIEW_CONTENT_MAX) e.content = `내용은 ${REVIEW_CONTENT_MAX}자까지 쓸 수 있어요.`;
  if (i.photoCount > REVIEW_PHOTO_MAX) e.photos = `사진은 ${REVIEW_PHOTO_MAX}장까지 올릴 수 있어요.`;
  return e;
}

/** BR-090 저평점 후기 → VOC 자동 생성 여부 */
export const needsLowRatingVoc = (rating: number, maxRating: number) => rating <= maxRating;

/** BR-090 자동 VOC 의 등급: 1점은 높음(경보), 그 외 저평점은 보통 */
export const lowRatingSeverity = (rating: number): 'HIGH' | 'MID' => (rating <= 1 ? 'HIGH' : 'MID');

/** BR-090 자동 VOC 제목·내용 */
export function lowRatingVocText(i: { orderNo: string; rating: number; tags: readonly string[]; content: string }) {
  return {
    title: `[저평점 후기] ${i.orderNo} 평점 ${i.rating}점`,
    content: [`고객 후기 평점 ${i.rating}점`, i.tags.length ? `태그: ${i.tags.join(', ')}` : null, i.content.trim() || '(내용 없음)'].filter(Boolean).join('\n'),
  };
}

/** 태그 문자열(쉼표 구분) ↔ 목록 */
export const parseTags = (v: string | null) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
export const joinTags = (tags: readonly string[]) => [...new Set(tags)].join(',').slice(0, 200) || null;

/** 기사 평균 평점 (숨긴 후기도 포함 — 숨김은 공개 여부일 뿐 평가는 남는다). 소수 둘째 자리 */
export function averageRating(ratings: readonly number[]): number | null {
  if (!ratings.length) return null;
  return Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 100) / 100;
}

/**
 * F-SYS-05 후기 요청 대상: 완료 후 delayHours 가 지났고 작성 기간 안이며, 후기·요청 이력이 없는 주문.
 */
export function isReviewRequestDue(i: {
  completedAt: Date | null;
  now: Date;
  delayHours: number;
  writableDays: number;
  hasReview: boolean;
  alreadyRequested: boolean;
}): boolean {
  if (!i.completedAt || i.hasReview || i.alreadyRequested) return false;
  const t = i.now.getTime() - i.completedAt.getTime();
  return t >= i.delayHours * 3_600_000 && t <= i.writableDays * 86_400_000;
}

/* ---------- 작업 결과 검수 (F-ADM-PRC-03) ---------- */

export const INSPECTION_STATUSES = ['WAITING', 'APPROVED', 'REJECTED'] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];
/** 검수 전이표: (신규·대기) → 승인/반려, 반려 → 승인(재검수 후). 승인은 끝 */
export const INSPECTION_TRANSITIONS: Readonly<Record<InspectionStatus, readonly InspectionStatus[]>> = {
  WAITING: ['APPROVED', 'REJECTED'],
  REJECTED: ['APPROVED'],
  APPROVED: [],
};

export function canTransitionInspection(from: string | null, to: InspectionStatus): boolean {
  return (INSPECTION_TRANSITIONS[(from ?? 'WAITING') as InspectionStatus] ?? []).includes(to);
}
export function assertInspectionTransition(from: string | null, to: InspectionStatus): void {
  if (!canTransitionInspection(from, to)) throw new Error(`검수 상태를 ${from ?? 'WAITING'}에서 ${to}(으)로 바꿀 수 없습니다.`);
}

/** 검수 입력: 반려는 사유(재작업 요청 내용) 필수. 이미 정산에 들어간 작업은 바꿀 수 없다(BR-084) */
export function checkInspection(i: { to: string; note: string; inSettlement: boolean }): FieldErrors {
  const e: FieldErrors = {};
  if (i.inSettlement) e.status = '이미 정산에 들어간 작업은 검수 결과를 바꿀 수 없습니다.';
  if (i.to === 'REJECTED' && !i.note.trim()) e.note = MSG.required('반려 사유');
  return e;
}

/** 정산 대상 판정에 검수 반영: 반려 건은 항상 제외, 검수 필수 설정이면 승인 건만 */
export function inspectionAllowsSettlement(status: string | null, required: boolean): boolean {
  if (status === 'REJECTED') return false;
  return required ? status === 'APPROVED' : true;
}
