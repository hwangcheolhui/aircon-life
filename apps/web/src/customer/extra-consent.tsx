'use client';
// C-ORD-040 추가요금 동의 · F-CUS-ORD-04: 항목·사유·증빙 사진 확인 → [동의]/[거절] (BR-040). 금액은 하단 고정 바(.ac-bottom-bar)
import type { ExtraChargeState } from '@aircon/domain';
import { Alert, Button, Card, ConfirmModal, Empty, Tag, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { respondExtraCharge } from '@/app/(customer)/(tabs)/orders/actions';
import { formatWon } from '@/customer/format';
import type { ExtraChargeView } from '@/server/extra-charges';

const STATE: Partial<Record<ExtraChargeState, { label: string; tone?: 'success' | 'warning' | 'danger' }>> = {
  WAIT_CUSTOMER: { label: '동의 기다리는 중', tone: 'warning' },
  AGREED: { label: '동의함', tone: 'success' },
  DECLINED: { label: '거절함', tone: 'danger' },
};

export function ExtraConsent({ orderNo, charges, canRespond, agreed }: { orderNo: string; charges: ExtraChargeView[]; canRespond: boolean; agreed: number }) {
  const router = useRouter();
  const toast = useToast();
  const [ask, setAsk] = useState<{ c: ExtraChargeView; agree: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!charges.length) return <Empty>동의를 기다리는 추가요금이 없어요.</Empty>;
  return (
    <>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {charges.map((c) => (
        <Card key={c.id}>
          <div className="cus-extra-head">
            <Tag tone={STATE[c.state]?.tone}>{STATE[c.state]?.label ?? c.state}</Tag>
          </div>
          <h2 className="ac-h3">{c.title}</h2>
          <p className="ac-body-lg ac-num">{formatWon(c.amount)}</p>
          <p className="ac-body">사유: {c.reason}</p>
          {c.evidenceUrl ? (
            <img className="cus-extra-photo" src={c.evidenceUrl} alt={`${c.title} 증빙 사진`} />
          ) : null}
          {c.state === 'WAIT_CUSTOMER' && canRespond ? (
            <div className="cus-extra-actions">
              <Button variant="outline" size="lg" onClick={() => setAsk({ c, agree: false })}>
                거절
              </Button>
              <Button variant="primary" size="lg" onClick={() => setAsk({ c, agree: true })}>
                동의
              </Button>
            </div>
          ) : null}
        </Card>
      ))}
      <div className="ac-bottom-bar">
        <div className="ac-bottom-bar__price">
          <span className="ac-caption">동의한 추가요금</span>
          <strong className="ac-num">{formatWon(agreed)}</strong>
        </div>
      </div>
      <ConfirmModal
        open={ask !== null}
        message={ask?.agree ? '추가요금에 동의하시겠습니까?' : '추가요금을 거절하시겠습니까?'}
        description={ask ? `${ask.c.title} ${formatWon(ask.c.amount)}${ask.agree ? '이 최종 금액에 더해집니다.' : '은 청구되지 않고 해당 작업은 하지 않습니다.'}` : undefined}
        confirmLabel={ask?.agree ? '동의' : '거절'}
        danger={ask ? !ask.agree : false}
        onCancel={() => setAsk(null)}
        onConfirm={async () => {
          const a = ask!;
          setAsk(null);
          setError(null);
          const r = await respondExtraCharge({ orderNo, chargeId: a.c.id, decision: a.agree ? 'AGREE' : 'DECLINE' });
          if (!r.ok) return setError(r.message ?? '처리하지 못했습니다.');
          toast(a.agree ? '동의했어요. 기사님께 알려 드렸어요.' : '거절했어요. 청구되지 않아요.');
          router.refresh();
        }}
      />
    </>
  );
}
