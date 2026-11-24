import { describe, expect, it } from 'vitest';
import {
  FIELD_PAY_METHODS,
  assertTaxDocTransition,
  checkCollect,
  checkReceivable,
  checkRefund,
  checkTaxDocInput,
  completionAfterPayment,
  isFieldCollected,
  isValidBizNo,
  orderBalance,
  paymentStatusAfterPay,
  refundableOf,
  settlementTargetOf,
  splitVat,
  taxDocTypesFor,
} from './payment-rules';

describe('잔액·결제 상태 (ERD §3.1 WORK_DONE → COMPLETED)', () => {
  it('잔액 = 청구 금액 − 결제 완료 금액(음수 없음)', () => {
    expect(orderBalance({ totalAmount: 120000, paidAmount: 90000 })).toBe(30000);
    expect(orderBalance({ totalAmount: 90000, paidAmount: 90000 })).toBe(0);
    expect(orderBalance({ totalAmount: 90000, paidAmount: 100000 })).toBe(0);
  });

  it('결제 후 결제 상태: 다 내면 PAID, 일부면 PREPAID, 없으면 UNPAID', () => {
    expect(paymentStatusAfterPay(120000, 120000)).toBe('PAID');
    expect(paymentStatusAfterPay(120000, 90000)).toBe('PREPAID');
    expect(paymentStatusAfterPay(120000, 0)).toBe('UNPAID');
  });

  it('작업완료 + 다 냈으면 자동으로 완료(COMPLETED)', () => {
    expect(completionAfterPayment({ status: 'WORK_DONE', totalAmount: 90000, paidAmount: 90000 })).toBe(true);
    expect(completionAfterPayment({ status: 'WORK_DONE', totalAmount: 90000, paidAmount: 120000 })).toBe(
      true,
    );
  });

  it('예외: 잔액이 남았거나 작업완료가 아니면 완료하지 않는다', () => {
    expect(completionAfterPayment({ status: 'WORK_DONE', totalAmount: 120000, paidAmount: 90000 })).toBe(
      false,
    );
    expect(completionAfterPayment({ status: 'IN_PROGRESS', totalAmount: 90000, paidAmount: 90000 })).toBe(
      false,
    );
    expect(completionAfterPayment({ status: 'COMPLETED', totalAmount: 90000, paidAmount: 90000 })).toBe(
      false,
    );
  });
});

describe('BR-081 결제 미완료(미수) 주문은 정산 제외, 결제 완료되면 정산 대상', () => {
  it('완료(COMPLETED) + 결제완료(PAID)면 정산 대상', () => {
    expect(settlementTargetOf({ status: 'COMPLETED', paymentStatus: 'PAID' })).toBe(true);
  });

  it('예외: 미수·미결제·작업완료(결제 대기)는 정산 대상이 아니다', () => {
    expect(settlementTargetOf({ status: 'WORK_DONE', paymentStatus: 'RECEIVABLE' })).toBe(false);
    expect(settlementTargetOf({ status: 'WORK_DONE', paymentStatus: 'UNPAID' })).toBe(false);
    expect(settlementTargetOf({ status: 'WORK_DONE', paymentStatus: 'PAID' })).toBe(false);
  });
});

describe('BR-082 현장 수금(현금·계좌이체)은 기사가 받은 돈으로 기록해 정산에서 상계한다', () => {
  it('현금·계좌이체는 기사 수금, 카드단말은 아니다', () => {
    expect(isFieldCollected('CASH')).toBe(true);
    expect(isFieldCollected('BANK_TRANSFER')).toBe(true);
    expect(isFieldCollected('ONSITE_CARD')).toBe(false);
    expect(isFieldCollected('CARD')).toBe(false);
  });
});

describe('F-TEC-PAY-01·02 현장 결제·수금 확인', () => {
  const ok = { method: 'CASH', amount: 30000, balance: 30000, orderStatus: 'WORK_DONE' };

  it('현장 결제 수단은 카드단말·계좌이체·현금', () => {
    expect(FIELD_PAY_METHODS).toEqual(['ONSITE_CARD', 'BANK_TRANSFER', 'CASH']);
    expect(checkCollect(ok)).toEqual({});
  });

  it('예외: 받은 금액이 결제할 금액과 다르면 저장하지 않는다', () => {
    expect(checkCollect({ ...ok, amount: 20000 }).amount).toBe(
      '받은 금액이 결제할 금액(30,000원)과 다릅니다.',
    );
    expect(checkCollect({ ...ok, amount: 0 }).amount).toBe('받은 금액은 필수 입력값입니다.');
  });

  it('예외: 작업완료 전이거나 낼 돈이 없거나 앱 결제 수단이면 막는다', () => {
    expect(checkCollect({ ...ok, orderStatus: 'IN_PROGRESS' }).form).toBeTruthy();
    expect(checkCollect({ ...ok, balance: 0, amount: 0 }).form).toBe('결제할 금액이 없습니다.');
    expect(checkCollect({ ...ok, method: 'CARD' }).method).toBe('결제 수단은 필수 입력값입니다.');
  });
});

describe('F-ADM-PAY-04 미수 처리', () => {
  it('작업완료이고 잔액이 있으면 사유를 받아 미수로 남긴다', () => {
    expect(
      checkReceivable({ orderStatus: 'WORK_DONE', balance: 30000, reason: '고객 카드 한도 초과' }),
    ).toEqual({});
  });

  it('예외: 사유가 없거나 낼 돈이 없으면 막는다', () => {
    expect(checkReceivable({ orderStatus: 'WORK_DONE', balance: 30000, reason: ' ' }).reason).toBe(
      '미수 사유는 필수 입력값입니다.',
    );
    expect(checkReceivable({ orderStatus: 'WORK_DONE', balance: 0, reason: '사유' }).form).toBe(
      '결제할 금액이 없습니다.',
    );
    expect(checkReceivable({ orderStatus: 'COMPLETED', balance: 30000, reason: '사유' }).form).toBeTruthy();
  });
});

describe('F-ADM-PAY-03 환불', () => {
  it('환불 가능 금액 = 결제 금액 − 이미 환불한 금액 − 이미 뗀 수수료', () => {
    expect(refundableOf(90000, [{ amount: 30000, cancelFee: 0 }])).toBe(60000);
    expect(refundableOf(90000, [{ amount: 80000, cancelFee: 10000 }])).toBe(0);
  });

  it('환불 금액 + 수수료는 환불 가능 금액 이내', () => {
    expect(
      checkRefund({ refundable: 90000, amount: 80000, fee: 10000, reasonCode: 'CUSTOMER_CANCEL' }),
    ).toEqual({});
  });

  it('예외: 0원·초과·사유 없음은 막는다', () => {
    expect(checkRefund({ refundable: 90000, amount: 0, fee: 0, reasonCode: 'CUSTOMER_CANCEL' }).amount).toBe(
      '환불 금액은 필수 입력값입니다.',
    );
    expect(
      checkRefund({ refundable: 90000, amount: 85000, fee: 10000, reasonCode: 'CUSTOMER_CANCEL' }).amount,
    ).toBe('환불 금액과 수수료의 합이 환불 가능 금액(90,000원)을 넘습니다.');
    expect(
      checkRefund({ refundable: 90000, amount: 1000, fee: -1, reasonCode: 'CUSTOMER_CANCEL' }).fee,
    ).toBeTruthy();
    expect(checkRefund({ refundable: 90000, amount: 1000, fee: 0, reasonCode: '' }).reasonCode).toBe(
      '환불 사유는 필수 입력값입니다.',
    );
  });
});

describe('F-CUS-PAY-03 · F-TEC-PAY-03 증빙', () => {
  it('부가세 포함 금액을 공급가·부가세로 나눈다(합계 유지)', () => {
    expect(splitVat(110000)).toEqual({ supply: 100000, vat: 10000 });
    expect(splitVat(99000)).toEqual({ supply: 90000, vat: 9000 });
    const s = splitVat(12345);
    expect(s.supply + s.vat).toBe(12345);
  });

  it('현금·계좌이체 결제는 현금영수증·세금계산서, 카드는 카드 영수증만', () => {
    expect(taxDocTypesFor('CASH')).toEqual(['CASH_RECEIPT_INCOME', 'CASH_RECEIPT_EXPENSE', 'TAX_INVOICE']);
    expect(taxDocTypesFor('BANK_TRANSFER')).toEqual([
      'CASH_RECEIPT_INCOME',
      'CASH_RECEIPT_EXPENSE',
      'TAX_INVOICE',
    ]);
    expect(taxDocTypesFor('CARD')).toEqual([]);
    expect(taxDocTypesFor('ONSITE_CARD')).toEqual([]);
  });

  it('사업자등록번호 검증(검증 숫자)', () => {
    expect(isValidBizNo('220-81-62517')).toBe(true);
    expect(isValidBizNo('2208162518')).toBe(false);
    expect(isValidBizNo('12345')).toBe(false);
  });

  it('소득공제는 휴대폰 번호, 지출증빙·세금계산서는 사업자등록번호', () => {
    expect(
      checkTaxDocInput({ docType: 'CASH_RECEIPT_INCOME', identityNo: '010-1234-5678', method: 'CASH' }),
    ).toEqual({});
    expect(
      checkTaxDocInput({
        docType: 'CASH_RECEIPT_EXPENSE',
        identityNo: '2208162517',
        method: 'BANK_TRANSFER',
      }),
    ).toEqual({});
  });

  it('예외: 번호 형식이 틀리거나 카드 결제에 현금영수증을 요청하면 막는다', () => {
    expect(
      checkTaxDocInput({ docType: 'CASH_RECEIPT_INCOME', identityNo: '1234', method: 'CASH' }).identityNo,
    ).toBe('휴대폰 번호 형식이 올바르지 않습니다.');
    expect(
      checkTaxDocInput({ docType: 'TAX_INVOICE', identityNo: '2208162518', method: 'CASH' }).identityNo,
    ).toBe('사업자등록번호가 올바르지 않습니다.');
    expect(
      checkTaxDocInput({ docType: 'CASH_RECEIPT_INCOME', identityNo: '', method: 'CASH' }).identityNo,
    ).toBe('발급 번호는 필수 입력값입니다.');
    expect(
      checkTaxDocInput({ docType: 'CASH_RECEIPT_INCOME', identityNo: '01012345678', method: 'CARD' }).docType,
    ).toBe('카드 결제는 카드 영수증으로 증빙합니다.');
  });

  it('증빙 상태 전이: 요청 → 발행/실패, 실패 → 재발행, 발행 → 취소', () => {
    expect(() => assertTaxDocTransition('REQUESTED', 'ISSUED')).not.toThrow();
    expect(() => assertTaxDocTransition('FAILED', 'ISSUED')).not.toThrow();
    expect(() => assertTaxDocTransition('ISSUED', 'CANCELED')).not.toThrow();
    expect(() => assertTaxDocTransition('CANCELED', 'ISSUED')).toThrow();
    expect(() => assertTaxDocTransition('ISSUED', 'ISSUED')).toThrow();
  });
});
