'use client';
// C-RSV-030 예약 확인 화면
import { Alert, Button, Card, Check, Modal } from '@aircon/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { formatDateLabel, formatHourLabel, formatWon } from '@/customer/format';
import { QuoteBottomBar } from '@/customer/quote-flow';
import { ReserveFlowProvider, ReserveStepHeader, reservePath, useReserveDraft } from '@/customer/reserve-flow';
import { confirmReservation, previewReservation } from '../../actions';

type Opt = { value: string; label: string };
interface Props {
  quoteNo: string;
  r: string | null;
  housingTypes: Opt[];
  payMethods: Opt[];
  feeHours: number;
  feeAmount: number;
}
type Preview = { items: { itemType: string; name: string; quantity: number; amount: number }[]; totalAmount: number };

export function ConfirmStep(p: Props) {
  return (
    <ReserveFlowProvider quoteNo={p.quoteNo} r={p.r}>
      <Inner {...p} />
    </ReserveFlowProvider>
  );
}

function Inner({ quoteNo, r, housingTypes, payMethods, feeHours, feeAmount }: Props) {
  const router = useRouter();
  const { draft, ready, clear } = useReserveDraft();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [payMethod, setPayMethod] = useState('PREPAY');
  const [agreed, setAgreed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [slotFull, setSlotFull] = useState(false);
  const [duplicates, setDuplicates] = useState<string[] | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!ready) return;
    if (draft.slotDate === null || draft.slotHour === null) return router.replace(reservePath(quoteNo, r));
    if (!draft.address || !draft.detailAddress || !draft.housingType) return router.replace(reservePath(quoteNo, r, '/visit'));
    previewReservation({ quoteNo, r, slotDate: draft.slotDate, slotHour: draft.slotHour }).then((res) =>
      res.ok ? setPreview(res.data as Preview) : setMessage(res.message ?? '금액을 불러오지 못했습니다.'),
    );
  }, [ready, draft.slotDate, draft.slotHour, draft.address, draft.detailAddress, draft.housingType, quoteNo, r, router]);

  const submit = (duplicateConfirmed: boolean) =>
    start(async () => {
      setMessage(null);
      const res = await confirmReservation(
        {
          quoteNo,
          slotDate: draft.slotDate,
          slotHour: draft.slotHour,
          address: draft.address,
          detailAddress: draft.detailAddress,
          housingType: draft.housingType,
          hasElevator: draft.hasElevator,
          parkingNote: draft.parkingNote,
          customerRequest: draft.customerRequest,
          payMethod,
          cancelPolicyAgreed: agreed,
          duplicateConfirmed,
        },
        r,
      );
      if (!res.ok) return setMessage(res.message ?? Object.values(res.fieldErrors ?? {})[0] ?? '예약에 실패했습니다.');
      const d = res.data as { ok: true; path: string } | { ok: false; reason: 'SLOT_FULL' | 'DUPLICATE'; duplicates?: string[] };
      if (!d.ok) {
        if (d.reason === 'SLOT_FULL') return setSlotFull(true);
        return setDuplicates(d.duplicates ?? []);
      }
      if (!d.path.startsWith('/reserve/pay/')) clear();
      router.replace(d.path);
    });

  const housing = housingTypes.find((h) => h.value === draft.housingType)?.label ?? '';
  return (
    <>
      <main className="cus-flow__body">
        <ReserveStepHeader step={3} backHref={reservePath(quoteNo, r, '/visit')} title="예약 내용을 확인해 주세요" />
        {message ? <Alert tone="danger">{message}</Alert> : null}
        {slotFull ? (
          <Alert tone="warning">
            방금 다른 분이 그 시간을 예약했어요. <Link href={reservePath(quoteNo, r)}>다른 시간 고르기</Link>
          </Alert>
        ) : null}
        <Card>
          <dl className="cus-kv ac-body">
            <dt>방문 일시</dt>
            <dd className="ac-num">{draft.slotDate && draft.slotHour !== null ? `${formatDateLabel(draft.slotDate)} ${formatHourLabel(draft.slotHour)}` : ''}</dd>
            <dt>방문 주소</dt>
            <dd>
              {draft.address?.roadAddress} {draft.detailAddress}
            </dd>
            <dt>주거 유형</dt>
            <dd>
              {housing}
              {draft.hasElevator ? ' · 엘리베이터 있음' : ''}
            </dd>
            {draft.parkingNote ? (
              <>
                <dt>주차</dt>
                <dd>{draft.parkingNote}</dd>
              </>
            ) : null}
            {draft.customerRequest ? (
              <>
                <dt>요청사항</dt>
                <dd>{draft.customerRequest}</dd>
              </>
            ) : null}
          </dl>
        </Card>
        <Card>
          <h2 className="ac-h3" style={{ marginTop: 0 }}>
            금액
          </h2>
          {preview ? (
            <>
              {preview.items.map((i, idx) => (
                <div key={idx} className="cus-amount-row ac-body">
                  <span>
                    {i.name}
                    {i.itemType === 'PRODUCT' || i.itemType === 'OPTION' ? <span className="ac-num"> × {i.quantity}</span> : null}
                  </span>
                  <span className={`ac-num${i.amount < 0 ? ' is-minus' : ''}`}>
                    {i.amount < 0 ? `−${formatWon(-i.amount)}` : i.itemType === 'SURCHARGE' ? `+${formatWon(i.amount)}` : formatWon(i.amount)}
                  </span>
                </div>
              ))}
              <div className="cus-amount-row cus-amount-row--total ac-body-lg">
                <span>결제 예정 금액</span>
                <span className="ac-num">{formatWon(preview.totalAmount)}</span>
              </div>
            </>
          ) : (
            <p className="ac-body-sm">금액을 계산하고 있어요…</p>
          )}
        </Card>
        <fieldset className="cus-section" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="ac-label">결제 방식</legend>
          {payMethods.map((m) => (
            <label key={m.value} className="ac-check">
              <input type="radio" name="payMethod" value={m.value} checked={payMethod === m.value} onChange={() => setPayMethod(m.value)} />
              <span>{m.label}</span>
            </label>
          ))}
        </fieldset>
        <Card>
          <h2 className="ac-h3" style={{ marginTop: 0 }}>
            취소 규정
          </h2>
          <ul className="cus-plain-list ac-body-sm">
            <li>기사님 출발 전까지 앱에서 바로 취소할 수 있어요.</li>
            <li>
              방문 <span className="ac-num">{feeHours}</span>시간 전부터는{' '}
              {feeAmount > 0 ? (
                <>
                  취소 수수료 <span className="ac-num">{formatWon(feeAmount)}</span>을 뺀 금액을 환불해요.
                </>
              ) : (
                '수수료 없이 환불해요.'
              )}
            </li>
            <li>일정 변경은 요청 후 상담원이 확인해 확정해요.</li>
          </ul>
          <Check label="취소 규정을 확인했어요 (필수)" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        </Card>
      </main>
      <QuoteBottomBar label="결제 예정 금액" amount={preview?.totalAmount ?? null}>
        <Button variant="primary" size="lg" disabled={!preview || !agreed} loading={pending} onClick={() => submit(false)}>
          예약 확정
        </Button>
      </QuoteBottomBar>
      <Modal
        open={duplicates !== null}
        title="이미 진행 중인 예약이 있어요"
        description={`같은 연락처나 주소로 진행 중인 예약이 있습니다(${(duplicates ?? []).join(', ')}). 그래도 새로 예약할까요?`}
        onClose={() => setDuplicates(null)}
        actions={
          <>
            <Button onClick={() => setDuplicates(null)}>취소</Button>
            <Button
              variant="primary"
              onClick={() => {
                setDuplicates(null);
                submit(true);
              }}
            >
              새로 예약
            </Button>
          </>
        }
      />
    </>
  );
}
