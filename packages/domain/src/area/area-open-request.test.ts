import { describe, expect, it } from 'vitest';
import {
  AREA_OPEN_TRANSITIONS,
  areaDisplayName,
  assertAreaOpenTransition,
  canTransitionAreaOpen,
  isAreaOpenRequestExpired,
  isMobilePhone,
  renderAreaOpenedMessage,
  shouldNotifyAreaOpened,
} from './area-open-request';

describe('오픈 알림 신청 상태 전이 (01 §3.9)', () => {
  it('WAITING 에서만 NOTIFIED·EXPIRED 로 갈 수 있다', () => {
    expect(canTransitionAreaOpen('WAITING', 'NOTIFIED')).toBe(true);
    expect(canTransitionAreaOpen('WAITING', 'EXPIRED')).toBe(true);
  });
  it('BR-003 이미 안내한 신청은 다시 안내하지 않는다(NOTIFIED·EXPIRED 는 종료)', () => {
    expect(AREA_OPEN_TRANSITIONS.NOTIFIED).toEqual([]);
    expect(AREA_OPEN_TRANSITIONS.EXPIRED).toEqual([]);
    expect(() => assertAreaOpenTransition('NOTIFIED', 'NOTIFIED')).toThrow();
    expect(() => assertAreaOpenTransition('EXPIRED', 'NOTIFIED')).toThrow();
    expect(() => assertAreaOpenTransition('UNKNOWN', 'NOTIFIED')).toThrow();
  });
});

describe('BR-003 오픈 알림 신청 조건', () => {
  it('BR-003 휴대폰 번호(010·011·016~019, 10~11자리)만 받는다', () => {
    expect(isMobilePhone('010-1234-5678')).toBe(true);
    expect(isMobilePhone('01112345678')).toBe(true);
    expect(isMobilePhone('016-123-4567')).toBe(true);
  });
  it('BR-003 유선·짧은·긴 번호는 거절한다', () => {
    expect(isMobilePhone('02-123-4567')).toBe(false);
    expect(isMobilePhone('010-123-456')).toBe(false);
    expect(isMobilePhone('010-1234-56789')).toBe(false);
    expect(isMobilePhone('015-1234-5678')).toBe(false);
    expect(isMobilePhone('')).toBe(false);
  });
  it('BR-003 서비스 가능이고 법정동 코드가 있는 관할 지역 저장일 때만 안내한다', () => {
    expect(shouldNotifyAreaOpened({ isServiceable: true, legalDongCode: '4113511000' })).toBe(true);
    expect(shouldNotifyAreaOpened({ isServiceable: false, legalDongCode: '4113511000' })).toBe(false);
    expect(shouldNotifyAreaOpened({ isServiceable: true, legalDongCode: null })).toBe(false);
    expect(shouldNotifyAreaOpened({ isServiceable: true, legalDongCode: '' })).toBe(false);
  });
  it('BR-003 보관일이 지난 대기 신청은 만료 대상이다', () => {
    const created = new Date('2026-01-01T00:00:00Z');
    expect(isAreaOpenRequestExpired(created, 365, new Date('2027-01-01T00:00:01Z'))).toBe(true);
    expect(isAreaOpenRequestExpired(created, 365, new Date('2026-12-31T23:59:59Z'))).toBe(false);
  });
  it('BR-003 보관일 설정이 1 미만이거나 정수가 아니면 오류', () => {
    expect(() => isAreaOpenRequestExpired(new Date(), 0, new Date())).toThrow();
    expect(() => isAreaOpenRequestExpired(new Date(), 1.5, new Date())).toThrow();
  });
});

describe('오픈 안내 문구 (템플릿 AREA_OPENED)', () => {
  it('지역명을 시군구+읍면동으로 만들고 문구에 넣는다', () => {
    const name = areaDisplayName({ sido: '경기', sigungu: '성남시 분당구', eupmyeondong: '백현동' });
    expect(name).toBe('경기 성남시 분당구 백현동');
    const text = renderAreaOpenedMessage({ areaName: name });
    expect(text).toContain('경기 성남시 분당구 백현동');
    expect(text).not.toContain('#{');
  });
});
