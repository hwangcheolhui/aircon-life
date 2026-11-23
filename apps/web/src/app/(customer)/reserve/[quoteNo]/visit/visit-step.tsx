'use client';
// C-RSV-020 방문 정보 입력
import { Button, Check, Field, Input, MSG, Textarea } from '@aircon/ui';
import type { AddressResult } from '@aircon/integrations/address';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AddressSearchModal } from '@/shared/address-search';
import { QuoteBottomBar } from '@/customer/quote-flow';
import { ReserveFlowProvider, ReserveStepHeader, reservePath, useReserveDraft } from '@/customer/reserve-flow';

interface Props {
  quoteNo: string;
  r: string | null;
  amount: number;
  housingTypes: { value: string; label: string }[];
}

export function VisitStep(p: Props) {
  return (
    <ReserveFlowProvider quoteNo={p.quoteNo} r={p.r}>
      <Inner {...p} />
    </ReserveFlowProvider>
  );
}

function Inner({ quoteNo, r, amount, housingTypes }: Props) {
  const router = useRouter();
  const { draft, ready, update } = useReserveDraft();
  const [searching, setSearching] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const next = () => {
    const e: Record<string, string> = {};
    if (!draft.address) e.address = MSG.required('방문 주소');
    if (!draft.detailAddress.trim()) e.detailAddress = MSG.required('상세주소');
    if (!draft.housingType) e.housingType = MSG.required('주거 유형');
    setErrors(e);
    if (Object.keys(e).length === 0) router.push(reservePath(quoteNo, r, '/confirm'));
  };

  return (
    <>
      <main className="cus-flow__body">
        <ReserveStepHeader step={2} backHref={reservePath(quoteNo, r)} title="방문할 곳을 알려 주세요" />
        <Field label="방문 주소" required error={errors.address} help="견적을 받은 주소예요. 다른 지역으로 바꾸면 다시 견적을 받아야 할 수 있어요.">
          {(id, d) => (
            <div className="ac-row" style={{ flexWrap: 'nowrap' }}>
              <Input id={id} aria-describedby={d} readOnly value={draft.address?.roadAddress ?? ''} placeholder="주소를 검색해 주세요" />
              <Button type="button" onClick={() => setSearching(true)}>
                {draft.address ? '변경' : '검색'}
              </Button>
            </div>
          )}
        </Field>
        <Field label="상세주소" required error={errors.detailAddress}>
          {(id, d, inv) => (
            <Input
              id={id}
              aria-describedby={d}
              aria-invalid={inv}
              value={draft.detailAddress}
              onChange={(e) => update({ detailAddress: e.target.value })}
              placeholder="동·호수"
              maxLength={200}
            />
          )}
        </Field>
        <Field label="주거 유형" required error={errors.housingType}>
          {() => (
            <div className="ac-chip-row" role="group" aria-label="주거 유형" style={{ flexWrap: 'wrap' }}>
              {housingTypes.map((h) => (
                <button key={h.value} type="button" className="ac-chip" aria-pressed={draft.housingType === h.value} onClick={() => update({ housingType: h.value })}>
                  {h.label}
                </button>
              ))}
            </div>
          )}
        </Field>
        <Check label="엘리베이터 있음" checked={draft.hasElevator} onChange={(e) => update({ hasElevator: e.target.checked })} />
        <Field label="주차 안내">
          {(id, d) => (
            <Input id={id} aria-describedby={d} value={draft.parkingNote} onChange={(e) => update({ parkingNote: e.target.value })} placeholder="예: 지하 주차장 방문 등록 필요" maxLength={200} />
          )}
        </Field>
        <Field label="요청사항">
          {(id, d) => (
            <Textarea id={id} aria-describedby={d} value={draft.customerRequest} onChange={(e) => update({ customerRequest: e.target.value })} rows={3} maxLength={500} />
          )}
        </Field>
      </main>
      <QuoteBottomBar label="견적 금액" amount={amount}>
        <Button variant="primary" size="lg" disabled={!ready} onClick={next}>
          다음
        </Button>
      </QuoteBottomBar>
      <AddressSearchModal
        open={searching}
        onClose={() => setSearching(false)}
        onSelect={(a: AddressResult) => {
          update({ address: a });
          setSearching(false);
        }}
      />
    </>
  );
}
