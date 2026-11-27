import { describe, expect, it } from 'vitest';
import {
  assertInspectionTransition,
  averageRating,
  canTransitionInspection,
  checkInspection,
  checkReviewInput,
  inspectionAllowsSettlement,
  isReviewRequestDue,
  joinTags,
  lowRatingSeverity,
  lowRatingVocText,
  needsLowRatingVoc,
  parseTags,
  reviewWindow,
} from './quality-rules';

const d = (s: string) => new Date(s);
const done = d('2026-11-20T15:00:00+09:00');

describe('후기 작성 기간 (F-CUS-REV-01)', () => {
  it('완료 후 7일 안이면 작성 가능', () => {
    const r = reviewWindow({ orderStatus: 'COMPLETED', orderType: 'NORMAL', completedAt: done, hasReview: false, now: d('2026-11-27T14:00:00+09:00'), writableDays: 7 });
    expect(r.ok).toBe(true);
  });
  it('7일이 지나거나, 완료 전이거나, 이미 썼으면 불가', () => {
    expect(reviewWindow({ orderStatus: 'COMPLETED', orderType: 'NORMAL', completedAt: done, hasReview: false, now: d('2026-11-27T16:00:00+09:00'), writableDays: 7 }).ok).toBe(false);
    expect(reviewWindow({ orderStatus: 'ASSIGNED', orderType: 'NORMAL', completedAt: null, hasReview: false, now: done, writableDays: 7 }).ok).toBe(false);
    expect(reviewWindow({ orderStatus: 'WORK_DONE', orderType: 'NORMAL', completedAt: done, hasReview: true, now: done, writableDays: 7 }).ok).toBe(false);
  });
});

describe('후기 입력 검증', () => {
  const ok = { rating: 5, npsScore: 10, tags: ['KIND'], allowedTags: ['KIND', 'CLEAN'], content: '좋아요', photoCount: 1 };
  it('정상', () => expect(checkReviewInput(ok)).toEqual({}));
  it('평점 필수·범위, 추천의향 0~10, 태그 목록, 사진 3장', () => {
    expect(checkReviewInput({ ...ok, rating: null }).rating).toBeTruthy();
    expect(checkReviewInput({ ...ok, rating: 6 }).rating).toBeTruthy();
    expect(checkReviewInput({ ...ok, npsScore: 11 }).npsScore).toBeTruthy();
    expect(checkReviewInput({ ...ok, npsScore: null })).toEqual({});
    expect(checkReviewInput({ ...ok, tags: ['X'] }).tags).toBeTruthy();
    expect(checkReviewInput({ ...ok, photoCount: 4 }).photos).toBeTruthy();
    expect(checkReviewInput({ ...ok, content: 'a'.repeat(1001) }).content).toBeTruthy();
  });
});

describe('저평점 후기 VOC (BR-090)', () => {
  it('BR-090 평점 2점 이하면 VOC 자동 생성, 3점부터는 생성하지 않음', () => {
    expect(needsLowRatingVoc(1, 2)).toBe(true);
    expect(needsLowRatingVoc(2, 2)).toBe(true);
    expect(needsLowRatingVoc(3, 2)).toBe(false);
  });
  it('BR-090 1점은 높음(경보), 2점은 보통 등급', () => {
    expect(lowRatingSeverity(1)).toBe('HIGH');
    expect(lowRatingSeverity(2)).toBe('MID');
  });
  it('BR-090 자동 VOC 제목에 접수번호·평점, 내용에 태그·후기', () => {
    const t = lowRatingVocText({ orderNo: 'R2611200001', rating: 2, tags: ['늦음'], content: '' });
    expect(t.title).toBe('[저평점 후기] R2611200001 평점 2점');
    expect(t.content).toContain('태그: 늦음');
    expect(t.content).toContain('(내용 없음)');
  });
});

describe('태그·평균 평점', () => {
  it('쉼표 문자열 변환(중복 제거)', () => {
    expect(parseTags('KIND, CLEAN,')).toEqual(['KIND', 'CLEAN']);
    expect(joinTags(['KIND', 'KIND', 'ON_TIME'])).toBe('KIND,ON_TIME');
    expect(joinTags([])).toBeNull();
  });
  it('평균 평점은 소수 둘째 자리, 후기가 없으면 null', () => {
    expect(averageRating([5, 4, 4])).toBe(4.33);
    expect(averageRating([])).toBeNull();
  });
});

describe('후기 요청 배치 (F-SYS-05)', () => {
  const base = { completedAt: done, delayHours: 2, writableDays: 7, hasReview: false, alreadyRequested: false };
  it('완료 2시간 뒤부터 7일 안에 1회', () => {
    expect(isReviewRequestDue({ ...base, now: d('2026-11-20T16:59:00+09:00') })).toBe(false);
    expect(isReviewRequestDue({ ...base, now: d('2026-11-20T17:00:00+09:00') })).toBe(true);
    expect(isReviewRequestDue({ ...base, now: d('2026-11-28T15:00:01+09:00') })).toBe(false);
    expect(isReviewRequestDue({ ...base, alreadyRequested: true, now: d('2026-11-21T10:00:00+09:00') })).toBe(false);
    expect(isReviewRequestDue({ ...base, hasReview: true, now: d('2026-11-21T10:00:00+09:00') })).toBe(false);
  });
});

describe('작업 결과 검수 (F-ADM-PRC-03)', () => {
  it('대기 → 승인/반려, 반려 → 승인, 승인은 끝', () => {
    expect(canTransitionInspection(null, 'APPROVED')).toBe(true);
    expect(canTransitionInspection('WAITING', 'REJECTED')).toBe(true);
    expect(canTransitionInspection('REJECTED', 'APPROVED')).toBe(true);
    expect(canTransitionInspection('APPROVED', 'REJECTED')).toBe(false);
    expect(() => assertInspectionTransition('APPROVED', 'APPROVED')).toThrow();
  });
  it('반려는 사유 필수, 정산에 들어간 작업은 변경 불가', () => {
    expect(checkInspection({ to: 'REJECTED', note: ' ', inSettlement: false }).note).toBeTruthy();
    expect(checkInspection({ to: 'APPROVED', note: '', inSettlement: false })).toEqual({});
    expect(checkInspection({ to: 'APPROVED', note: '', inSettlement: true }).status).toBeTruthy();
  });
  it('정산 대상: 반려는 항상 제외, 검수 필수 설정이면 승인 건만', () => {
    expect(inspectionAllowsSettlement(null, false)).toBe(true);
    expect(inspectionAllowsSettlement('REJECTED', false)).toBe(false);
    expect(inspectionAllowsSettlement(null, true)).toBe(false);
    expect(inspectionAllowsSettlement('APPROVED', true)).toBe(true);
  });
});
