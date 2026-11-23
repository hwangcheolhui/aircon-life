'use client';
// C-ORD-030 일정 변경·취소 입력
import { Alert, Button, ConfirmModal, Field, Textarea } from '@aircon/ui';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { formatDateLabel, formatHourLabel, formatWon } from '@/customer/format';
import type { DayAvailability } from '@/server/slots';
import { submitChange } from '../../actions';

interface Props {
  orderNo: string;
  days: DayAvailability[];
  preview: { feeHours: number; withinFeeWindow: boolean; fee: number; refundAmount: number };
  paidAmount: number;
}

export function ChangeForm({ orderNo, days, preview, paidAmount }: Props) {
  const router = useRouter();
  const [type, setType] = useState<'RESCHEDULE' | 'CANCEL'>('RESCHEDULE');
  const [date, setDate] = useState<string | null>(days.find((d) => d.hours.length)?.date ?? null);
  const [hour, setHour] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const day = days.find((d) => d.date === date);

  const send = () =>
    start(async () => {
      setConfirm(false);
      const r = await submitChange({ orderNo, requestType: type, requestedDate: type === 'RESCHEDULE' ? date : null, requestedHour: type === 'RESCHEDULE' ? hour : null, reason });
      if (!r.ok) return setMessage(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '처리하지 못했습니다.');
      router.replace(`/orders/${orderNo}`);
      router.refresh();
    });

  return (
    <main className="cus-page-body">
      <div className="cus-topbar">
        <Link href={`/orders/${orderNo}`} className="ac-btn ac-btn--ghost ac-btn--icon" aria-label="예약 상세">
          <ChevronLeft aria-hidden />
        </Link>
      </div>
      <h1 className="ac-h2">일정 변경·취소</h1>
      {message ? <Alert tone="danger">{message}</Alert> : null}
      <div className="ac-segmented" role="group" aria-label="요청 유형">
        <button type="button" aria-pressed={type === 'RESCHEDULE'} onClick={() => setType('RESCHEDULE')}>
          일정 변경
        </button>
        <button type="button" aria-pressed={type === 'CANCEL'} onClick={() => setType('CANCEL')}>
          예약 취소
        </button>
      </div>
      {type === 'RESCHEDULE' ? (
        <>
          <p className="ac-body-sm">새 일정을 고르면 상담원이 확인 후 확정하고 알려 드려요. 확정 전까지는 기존 일정이 유지돼요.</p>
          <div className="ac-chip-row" role="group" aria-label="새 날짜">
            {days.map((d) => (
              <button key={d.date} type="button" className="ac-chip" aria-pressed={d.date === date} disabled={!d.hours.length} onClick={() => (setDate(d.date), setHour(null))}>
                {formatDateLabel(d.date)}
              </button>
            ))}
          </div>
          <div className="cus-time-grid" role="group" aria-label="새 시간">
            {day?.hours.map((h) => (
              <button
                key={h.hour}
                type="button"
                className={`ac-btn cus-time-btn ${hour === h.hour ? 'ac-btn--primary' : 'ac-btn--outline'}`}
                aria-pressed={hour === h.hour}
                onClick={() => setHour(h.hour)}
              >
                <span className="ac-num">{formatHourLabel(h.hour)}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <Alert tone="warning">
          {paidAmount > 0 ? (
            preview.withinFeeWindow && preview.fee > 0 ? (
              <>
                방문 <span className="ac-num">{preview.feeHours}</span>시간 전이 지나 취소 수수료 <span className="ac-num">{formatWon(preview.fee)}</span>을 빼고{' '}
                <span className="ac-num">{formatWon(preview.refundAmount)}</span>을 환불해요.
              </>
            ) : (
              <>
                결제한 <span className="ac-num">{formatWon(preview.refundAmount)}</span>을 모두 환불해요.
              </>
            )
          ) : (
            '결제 전 예약이라 수수료 없이 취소돼요.'
          )}
        </Alert>
      )}
      <Field label="사유">
        {(id, d) => <Textarea id={id} aria-describedby={d} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <Button
        variant={type === 'CANCEL' ? 'danger' : 'primary'}
        size="lg"
        block
        loading={pending}
        disabled={type === 'RESCHEDULE' && (date === null || hour === null)}
        onClick={() => (type === 'CANCEL' ? setConfirm(true) : send())}
      >
        {type === 'CANCEL' ? '예약 취소' : '변경 요청'}
      </Button>
      <ConfirmModal open={confirm} message="예약을 취소하시겠습니까?" danger onCancel={() => setConfirm(false)} onConfirm={send} confirmLabel="예약 취소" />
    </main>
  );
}
