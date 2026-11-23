'use client';
// C-QUO-020 기기 형태 선택 · F-CUS-QUO-02 (복수 선택)
import { Alert, Button, Empty } from '@aircon/ui';
import { AirVent, Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { QuoteBottomBar, StepHeader, useQuoteDraft } from './quote-flow';

export function DeviceStep({ deviceTypes }: { deviceTypes: { value: string; label: string }[] }) {
  const router = useRouter();
  const { draft, ready, update } = useQuoteDraft();
  useEffect(() => {
    if (ready && !draft.address) router.replace('/quote');
  }, [ready, draft.address, router]);
  const dong = draft.address?.legalDongCode ?? '';
  const toggle = (v: string) => {
    const has = draft.deviceTypes.includes(v);
    update({ deviceTypes: has ? draft.deviceTypes.filter((d) => d !== v) : [...draft.deviceTypes, v] });
  };
  const selected = draft.deviceTypes.filter((d) => deviceTypes.some((t) => t.value === d));
  return (
    <>
      <main className="cus-flow__body">
        <StepHeader step={2} backHref="/quote" title="어떤 에어컨인가요?" />
        <p className="ac-body ac-caption">청소할 에어컨 형태를 모두 골라 주세요.</p>
        {deviceTypes.length === 0 ? (
          <Empty>지금은 견적 가능한 기기가 없습니다.</Empty>
        ) : (
          <div className="cus-device-grid" role="group" aria-label="기기 형태">
            {deviceTypes.map((t) => {
              const on = selected.includes(t.value);
              return (
                <button
                  key={t.value}
                  type="button"
                  aria-pressed={on}
                  className={`ac-card ac-card--interactive cus-device-card${on ? ' ac-card--selected' : ''}`}
                  onClick={() => toggle(t.value)}
                >
                  {on ? <Check aria-hidden /> : <AirVent aria-hidden />}
                  <span className="ac-body">{t.label}</span>
                </button>
              );
            })}
          </div>
        )}
        <Alert>시스템·천장형이 여러 대라면 현장 확인 후 견적을 드릴 수 있어요.</Alert>
      </main>
      <QuoteBottomBar label="예상 금액" amount={null}>
        <Button
          variant="primary"
          size="lg"
          disabled={selected.length === 0}
          onClick={() => router.push(`/quote/count?dong=${encodeURIComponent(dong)}`)}
        >
          다음
        </Button>
      </QuoteBottomBar>
    </>
  );
}
