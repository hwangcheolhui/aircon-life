import { describe, expect, it } from 'vitest';
import {
  QUOTE_EXPIRABLE_STATUSES,
  assertQuoteTransition,
  canTransitionQuote,
  formatQuoteNo,
  isQuoteExpired,
  quoteExpiresAt,
} from './quote-status';

describe('BR-015 견적 유효기간(설정값)', () => {
  it('BR-015 발행 시각 + 설정 일수가 유효기한이다', () => {
    const issued = new Date('2027-03-02T05:00:00Z');
    expect(quoteExpiresAt(issued, 7).toISOString()).toBe('2027-03-09T05:00:00.000Z');
    expect(quoteExpiresAt(issued, 3).toISOString()).toBe('2027-03-05T05:00:00.000Z');
  });
  it('BR-015 유효기간 설정값이 1 미만이면 오류', () => {
    expect(() => quoteExpiresAt(new Date(), 0)).toThrow();
  });
  it('BR-015 유효기한이 지난 발행 견적만 만료로 본다', () => {
    const now = new Date('2027-03-09T05:00:01Z');
    expect(isQuoteExpired({ status: 'ISSUED', expiresAt: new Date('2027-03-09T05:00:00Z') }, now)).toBe(true);
    expect(isQuoteExpired({ status: 'ISSUED', expiresAt: new Date('2027-03-09T06:00:00Z') }, now)).toBe(
      false,
    );
    expect(isQuoteExpired({ status: 'CONVERTED', expiresAt: new Date('2027-03-01T00:00:00Z') }, now)).toBe(
      false,
    );
  });
});

describe('F-SYS-02 견적 상태 전이 (01 §3.8)', () => {
  it('F-SYS-02 발행(ISSUED) 견적은 만료(EXPIRED)·주문전환(CONVERTED)으로만 바뀐다', () => {
    expect(canTransitionQuote('DRAFT', 'ISSUED')).toBe(true);
    expect(canTransitionQuote('ISSUED', 'EXPIRED')).toBe(true);
    expect(canTransitionQuote('ISSUED', 'CONVERTED')).toBe(true);
  });
  it('F-SYS-02 전환·만료된 견적은 다시 바뀌지 않는다', () => {
    expect(canTransitionQuote('CONVERTED', 'EXPIRED')).toBe(false);
    expect(canTransitionQuote('EXPIRED', 'ISSUED')).toBe(false);
    expect(() => assertQuoteTransition('EXPIRED', 'CONVERTED')).toThrow();
  });
  it('F-SYS-02 만료 배치 대상 상태는 전이표에서 EXPIRED 로 갈 수 있는 상태뿐', () => {
    expect([...QUOTE_EXPIRABLE_STATUSES].sort()).toEqual(['DRAFT', 'ISSUED']);
  });
});

describe('견적 번호', () => {
  it('Q + 한국 날짜(YYMMDD) + 4자리 일련번호', () => {
    // 2027-03-01 23:30 UTC = 2027-03-02 08:30 KST
    expect(formatQuoteNo(new Date('2027-03-01T23:30:00Z'), 1)).toBe('Q2703020001');
    expect(formatQuoteNo(new Date('2027-03-01T10:00:00Z'), 123)).toBe('Q2703010123');
  });
});
