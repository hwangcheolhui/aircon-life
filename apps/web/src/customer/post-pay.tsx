'use client';
// C-PAY-020 작업 후 결제 (F-CUS-PAY-02): 금액 요약 → 모의 결제창(개발) 또는 포트원 결제창 → 서버가 PG에 다시 확인 → 주문 완료.
// 결제가 끝나면 증빙 신청(C-PAY-030)을 안내한다.
import { mockPaymentId } from '@aircon/integrations/payment';
import { Alert, Button, Card } from '@aircon/ui';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { completePostPayment } from '@/app/(customer)/(tabs)/orders/actions';
import { preparePayment } from '@/app/(customer)/reserve/actions';
import type { CodeMap } from '@/server/codes';
import type { CustomerPaymentState } from '@/server/payments';
import { formatWon } from './format';
import { type PortOneConfig, portonePayment } from './portone';
import { QuoteBottomBar } from './quote-flow';
import { ReceiptRequest } from './receipt-request';

export function PostPay({
  s,
  codes,
  driver,
  portone,
  returnedPaymentId,
}: {
  s: CustomerPaymentState;
  codes: CodeMap;
  driver: 'mock' | 'portone';
  portone: PortOneConfig | null;
  returnedPaymentId: string | null;
}) {
  const router = useRouter();
  const [mockNo, setMockNo] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const handled = useRef(false);
  const canPay = s.status === 'WORK_DONE' && s.balance > 0;

  const verify = (paymentId: string) =>
    start(async () => {
      const r = await completePostPayment(s.orderNo, paymentId);
      if (!r.ok) return setMessage(r.message ?? '결제 확인에 실패했습니다.');
      const d = r.data as { ok: boolean; failReason: string | null };
      setMockNo(null);
      if (!d.ok) return setMessage(`결제가 완료되지 않았어요. ${d.failReason ?? ''} 다시 시도해 주세요.`);
      setMessage(null);
      router.replace(`/orders/${s.orderNo}/pay`);
      router.refresh();
    });

  // 모바일 결제창은 결제 후 이 화면으로 돌아온다(?paymentId=)
  useEffect(() => {
    if (returnedPaymentId && !handled.current) {
      handled.current = true;
      verify(returnedPaymentId);
    }
  }, [returnedPaymentId]);

  const pay = () =>
    start(async () => {
      setMessage(null);
      const p = await preparePayment();
      if (!p.ok) return setMessage(p.message ?? '결제를 시작하지 못했습니다.');
      const { paymentNo } = p.data as { paymentNo: string };
      if (driver === 'mock') return setMockNo(paymentNo);
      const r = await portonePayment(portone!, {
        paymentId: paymentNo,
        orderName: `에어컨 청소 ${s.orderNo}`,
        amount: s.balance,
        redirectUrl: `${window.location.origin}/orders/${s.orderNo}/pay`,
      });
      if (!r.ok) return setMessage(r.message);
      verify(r.paymentId);
    });

  return (
    <>
      <main className="cus-page-body">
        <div className="cus-topbar">
          <Link
            href={`/orders/${s.orderNo}`}
            className="ac-btn ac-btn--ghost ac-btn--icon"
            aria-label="예약 상세"
          >
            <ChevronLeft aria-hidden />
          </Link>
          <span className="ac-caption ac-num">{s.orderNo}</span>
        </div>
        <h1 className="ac-h2">{canPay ? '작업 금액을 결제해 주세요' : '결제 내역'}</h1>
        {s.status === 'COMPLETED' ? (
          <Alert tone="success">결제가 완료되었어요. 이용해 주셔서 감사합니다.</Alert>
        ) : null}
        {!canPay && s.status !== 'COMPLETED' ? (
          <Alert tone="warning">지금 결제할 금액이 없어요.</Alert>
        ) : null}
        {message ? <Alert tone="danger">{message}</Alert> : null}
        <Card>
          <div className="cus-amount-row ac-body">
            <span>작업비</span>
            <span className="ac-num">{formatWon(s.laborAmount)}</span>
          </div>
          {s.extraAmount ? (
            <div className="cus-amount-row ac-body">
              <span>현장 추가(동의한 항목)</span>
              <span className="ac-num">{formatWon(s.extraAmount)}</span>
            </div>
          ) : null}
          {s.paidAmount ? (
            <div className="cus-amount-row ac-body">
              <span>이미 결제</span>
              <span className="ac-num is-minus">−{formatWon(s.paidAmount)}</span>
            </div>
          ) : null}
          <div className="cus-amount-row cus-amount-row--total ac-body-lg">
            <span>남은 결제 금액</span>
            <span className="ac-num">{formatWon(s.balance)}</span>
          </div>
        </Card>
        {mockNo ? (
          <div className="cus-mock-box" role="dialog" aria-label="모의 결제창">
            <strong className="ac-body">모의 결제창 (개발용)</strong>
            <span className="ac-caption">실제 돈은 오가지 않아요. 결과를 골라 결제 흐름을 시험해요.</span>
            <div className="ac-btn-group">
              <Button onClick={() => verify(mockPaymentId(mockNo, 'FAIL'))} disabled={pending}>
                결제 실패
              </Button>
              <Button variant="dark" onClick={() => verify(mockPaymentId(mockNo, 'OK'))} loading={pending}>
                결제 승인
              </Button>
            </div>
          </div>
        ) : null}
        <ReceiptRequest orderNo={s.orderNo} payments={s.payments} codes={codes} />
      </main>
      <QuoteBottomBar label="남은 결제 금액" amount={s.balance}>
        {canPay ? (
          <Button variant="primary" size="lg" loading={pending} disabled={Boolean(mockNo)} onClick={pay}>
            결제하기
          </Button>
        ) : (
          <Link href={`/orders/${s.orderNo}`} className="ac-btn ac-btn--dark ac-btn--lg">
            예약 상세
          </Link>
        )}
      </QuoteBottomBar>
    </>
  );
}
