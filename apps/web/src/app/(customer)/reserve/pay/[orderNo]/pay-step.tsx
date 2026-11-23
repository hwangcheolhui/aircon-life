'use client';
// C-PAY-010 결제 화면: 모의 결제창(개발) 또는 포트원 결제창 → 서버가 결제 ID로 PG에 다시 확인한다
import { mockPaymentId } from '@aircon/integrations/payment';
import { Alert, Button, Card } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { formatWon } from '@/customer/format';
import { type PortOneConfig, portonePayment } from '@/customer/portone';
import { QuoteBottomBar } from '@/customer/quote-flow';
import { ReserveStepHeader } from '@/customer/reserve-flow';
import { completePayment, payOnsite, preparePayment } from '../../actions';

interface Props {
  orderNo: string;
  amount: number;
  items: { name: string; amount: number }[];
  driver: 'mock' | 'portone';
  portone: PortOneConfig | null;
  returnedPaymentId: string | null;
  demoQuery: string;
}

export function PayStep({ orderNo, amount, items, driver, portone, returnedPaymentId, demoQuery }: Props) {
  const router = useRouter();
  const [mockNo, setMockNo] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const handled = useRef(false);
  const done = `/reserve/done/${orderNo}${demoQuery}`;

  const verify = (paymentId: string) =>
    start(async () => {
      const r = await completePayment(orderNo, paymentId);
      if (!r.ok) return setMessage(r.message ?? '결제 확인에 실패했습니다.');
      const d = r.data as { ok: boolean; failReason: string | null };
      if (!d.ok) {
        setMockNo(null);
        return setMessage(`결제가 완료되지 않았어요. ${d.failReason ?? ''} 다시 시도하거나 현장 결제를 선택해 주세요.`);
      }
      router.replace(done);
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
        orderName: `에어컨 청소 ${orderNo}`,
        amount,
        redirectUrl: `${window.location.origin}/reserve/pay/${orderNo}`,
      });
      if (!r.ok) return setMessage(r.message);
      verify(r.paymentId);
    });

  return (
    <>
      <main className="cus-flow__body">
        <ReserveStepHeader step={4} backHref={`/orders/${orderNo}`} title="결제해 주세요" />
        {message ? <Alert tone="danger">{message}</Alert> : null}
        <Card>
          <p className="ac-caption" style={{ marginTop: 0 }}>
            접수번호 <span className="ac-num">{orderNo === 'demo' ? '체험용(저장 안 됨)' : orderNo}</span>
          </p>
          {items.map((i, idx) => (
            <div key={idx} className="cus-amount-row ac-body">
              <span>{i.name}</span>
              <span className="ac-num">{i.amount < 0 ? `−${formatWon(-i.amount)}` : formatWon(i.amount)}</span>
            </div>
          ))}
          <div className="cus-amount-row cus-amount-row--total ac-body-lg">
            <span>최종 결제 금액</span>
            <span className="ac-num">{formatWon(amount)}</span>
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
        <Button
          variant="ghost"
          block
          disabled={pending}
          onClick={() =>
            start(async () => {
              await payOnsite(orderNo);
              router.replace(done);
            })
          }
        >
          현장에서 결제할게요
        </Button>
      </main>
      <QuoteBottomBar label="최종 결제 금액" amount={amount}>
        <Button variant="primary" size="lg" loading={pending} disabled={Boolean(mockNo)} onClick={pay}>
          결제하기
        </Button>
      </QuoteBottomBar>
    </>
  );
}
