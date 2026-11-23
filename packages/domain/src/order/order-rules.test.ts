import { describe, expect, it } from 'vitest';
import {
  addressKey,
  canWithdraw,
  cancelPolicy,
  findDuplicateOrders,
  formatCustomerNo,
  formatOrderNo,
  orderNoSerial,
  paymentStatusAfterRefund,
} from './order-rules';

describe('BR-030 취소 수수료 (방문 24시간 이내, 설정값)', () => {
  const settings = { feeHours: 24, feeAmount: 10000 };
  const promisedAt = new Date('2027-03-10T01:00:00Z'); // 한국 10:00
  it('BR-030 방문 24시간보다 전이면 수수료 없이 전액 환불', () => {
    const r = cancelPolicy({ promisedAt, now: new Date('2027-03-08T00:00:00Z'), paidAmount: 90000, ...settings });
    expect(r).toEqual({ withinFeeWindow: false, fee: 0, refundAmount: 90000 });
  });
  it('BR-030 방문 24시간 이내면 취소 수수료를 빼고 환불', () => {
    const r = cancelPolicy({ promisedAt, now: new Date('2027-03-09T02:00:00Z'), paidAmount: 90000, ...settings });
    expect(r).toEqual({ withinFeeWindow: true, fee: 10000, refundAmount: 80000 });
  });
  it('BR-030 예외: 결제 금액보다 수수료가 크면 결제 금액까지만, 미결제면 수수료 청구 없음', () => {
    expect(cancelPolicy({ promisedAt, now: new Date('2027-03-09T23:00:00Z'), paidAmount: 5000, ...settings })).toEqual({
      withinFeeWindow: true,
      fee: 5000,
      refundAmount: 0,
    });
    expect(cancelPolicy({ promisedAt, now: new Date('2027-03-09T23:00:00Z'), paidAmount: 0, ...settings })).toEqual({
      withinFeeWindow: true,
      fee: 0,
      refundAmount: 0,
    });
  });
  it('BR-030 약속 일시가 없으면 수수료 구간이 아니다', () => {
    expect(cancelPolicy({ promisedAt: null, now: new Date(), paidAmount: 1000, ...settings }).withinFeeWindow).toBe(false);
  });
});

describe('BR-020 이중예약 확인', () => {
  const orders = [
    { id: 1, status: 'RECEIVED', phoneHash: 'h1', addressKey: 'k1' },
    { id: 2, status: 'COMPLETED', phoneHash: 'h1', addressKey: 'k1' },
    { id: 3, status: 'CANCELED', phoneHash: 'h2', addressKey: 'k2' },
    { id: 4, status: 'ASSIGNED', phoneHash: 'h3', addressKey: 'k2' },
  ];
  it('BR-020 같은 전화번호의 미완료 주문이 있으면 찾는다', () => {
    expect(findDuplicateOrders(orders, { phoneHash: 'h1', addressKey: 'x' }).map((o) => o.id)).toEqual([1]);
  });
  it('BR-020 같은 주소의 미완료 주문도 찾는다', () => {
    expect(findDuplicateOrders(orders, { phoneHash: 'zz', addressKey: 'k2' }).map((o) => o.id)).toEqual([4]);
  });
  it('BR-020 예외: 완료·취소 주문만 있으면 이중예약이 아니다', () => {
    expect(findDuplicateOrders(orders, { phoneHash: 'h2', addressKey: 'none' })).toEqual([]);
  });
  it('주소 키는 도로명 주소·상세주소의 공백·대소문자 차이를 무시한다', () => {
    expect(addressKey('서울 은평구 불광로 1', '101동 1203호')).toBe(addressKey(' 서울  은평구 불광로 1', '101동1203호'));
    expect(addressKey('서울 은평구 불광로 1', '101동 1203호')).not.toBe(addressKey('서울 은평구 불광로 1', '102동 1203호'));
  });
});

describe('F-CUS-AUTH-05 회원 탈퇴', () => {
  it('진행 중 주문이 없으면 탈퇴할 수 있다', () => {
    expect(canWithdraw(['COMPLETED', 'CANCELED'])).toBe(true);
    expect(canWithdraw([])).toBe(true);
  });
  it('예외: 진행 중 주문이 있으면 탈퇴할 수 없다', () => {
    expect(canWithdraw(['COMPLETED', 'RECEIVED'])).toBe(false);
  });
});

describe('번호 형식 (01 §2.5.1 order_no, §2.2.1 customer_no)', () => {
  const at = new Date('2026-11-22T06:30:12Z'); // 한국 2026-11-22 15:30
  it('접수 번호 = 한국 시각 YYMMDDHHmm + 일련(A1~A9, B1…)', () => {
    expect(formatOrderNo(at, 1)).toBe('2611221530A1');
    expect(orderNoSerial(9)).toBe('A9');
    expect(orderNoSerial(10)).toBe('B1');
    expect(() => orderNoSerial(26 * 9 + 1)).toThrow();
  });
  it('고객 번호 = C + YYMM + 6자리 일련', () => {
    expect(formatCustomerNo(at, 123)).toBe('C2611000123');
  });
});

describe('결제 상태 (service_order.payment_status)', () => {
  it('전액 환불이면 REFUNDED, 일부면 PARTIAL_REFUND, 환불 없으면 그대로', () => {
    expect(paymentStatusAfterRefund('PREPAID', 90000, 90000)).toBe('REFUNDED');
    expect(paymentStatusAfterRefund('PREPAID', 90000, 80000)).toBe('PARTIAL_REFUND');
    expect(paymentStatusAfterRefund('PREPAID', 90000, 0)).toBe('PREPAID');
    expect(paymentStatusAfterRefund('UNPAID', 0, 0)).toBe('UNPAID');
  });
});
