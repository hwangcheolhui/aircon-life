import { describe, expect, it } from 'vitest';
import { createMockReceiptIssuer, createPortOneReceiptIssuer, createReceiptIssuer } from './index';

const req = {
  receiptId: 'R1',
  purpose: 'INCOME' as const,
  identityNo: '01012345678',
  totalAmount: 110000,
  vatAmount: 10000,
  orderName: '에어컨 청소',
};

describe('현금영수증 발행 (F-ADM-PAY-05)', () => {
  it('모의 발행: 바로 승인번호를 준다, 0000으로 끝나면 실패 흉내', async () => {
    const m = createMockReceiptIssuer();
    expect(await m.issueCashReceipt(req)).toMatchObject({ ok: true, issuedNo: 'MOCK-R1' });
    expect(await m.issueCashReceipt({ ...req, identityNo: '01012340000' })).toMatchObject({
      ok: false,
      failReason: expect.any(String),
    });
  });

  it('기본은 모의, RECEIPT_DRIVER=portone 이면 키가 필요하다', () => {
    expect(createReceiptIssuer({}).kind).toBe('mock');
    expect(() => createReceiptIssuer({ RECEIPT_DRIVER: 'portone' })).toThrow();
  });

  it('포트원: 발급 결과 ISSUED 면 승인번호, 아니면 실패 사유', async () => {
    let sent: Record<string, unknown> = {};
    const ok = (async (_u: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ cashReceipt: { status: 'ISSUED', issueNumber: '123456789' } }));
    }) as typeof fetch;
    const g = createPortOneReceiptIssuer({ apiSecret: 's', storeId: 'st', channelKey: 'ch', fetchImpl: ok });
    expect(await g.issueCashReceipt(req)).toEqual({ ok: true, issuedNo: '123456789', failReason: null });
    expect(sent).toMatchObject({
      type: 'PERSONAL',
      amount: { total: 110000, vat: 10000 },
      customer: { identityNumber: '01012345678' },
    });
    const bad = (async () =>
      new Response(JSON.stringify({ message: '채널 없음' }), { status: 404 })) as typeof fetch;
    const g2 = createPortOneReceiptIssuer({
      apiSecret: 's',
      storeId: 'st',
      channelKey: 'ch',
      fetchImpl: bad,
    });
    expect(await g2.issueCashReceipt(req)).toMatchObject({ ok: false, failReason: '채널 없음' });
  });
});
