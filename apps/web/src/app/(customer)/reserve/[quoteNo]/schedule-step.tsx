'use client';
// C-RSV-010 일정 선택 화면 (날짜 칩 + 시간 버튼, 야간·휴일 할증 안내 모달)
import { Button, Empty, Modal, Tag } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatDateLabel, formatDuration, formatHourLabel } from '@/customer/format';
import { QuoteBottomBar } from '@/customer/quote-flow';
import { ReserveFlowProvider, ReserveStepHeader, reservePath, useReserveDraft } from '@/customer/reserve-flow';
import type { DayAvailability } from '@/server/slots';

interface Props {
  quoteNo: string;
  r: string | null;
  days: DayAvailability[];
  amount: number;
  durationMin: number;
}

export function ScheduleStep(p: Props) {
  return (
    <ReserveFlowProvider quoteNo={p.quoteNo} r={p.r}>
      <Inner {...p} />
    </ReserveFlowProvider>
  );
}

function Inner({ quoteNo, r, days, amount, durationMin }: Props) {
  const router = useRouter();
  const { draft, ready, update } = useReserveDraft();
  const firstOpen = days.find((d) => d.hours.length)?.date ?? days[0]?.date ?? null;
  const [date, setDate] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const current = date ?? (ready && draft.slotDate && days.some((d) => d.date === draft.slotDate) ? draft.slotDate : firstOpen);
  const day = days.find((d) => d.date === current);
  const picked = draft.slotDate === current ? draft.slotHour : null;
  const back = r ? `/quote/result/${quoteNo}?r=${encodeURIComponent(r)}` : `/quote/result/${quoteNo}`;

  return (
    <>
      <main className="cus-flow__body">
        <ReserveStepHeader step={1} backHref={back} title="방문 날짜와 시간을 골라 주세요" />
        <p className="ac-caption" style={{ margin: 0 }}>
          예상 소요시간 <span className="ac-num">{formatDuration(durationMin)}</span> · 시작 시각 기준으로 보여 드려요
        </p>
        <div className="ac-chip-row" role="group" aria-label="방문 날짜">
          {days.map((d) => (
            <button
              key={d.date}
              type="button"
              className="ac-chip"
              aria-pressed={d.date === current}
              onClick={() => setDate(d.date)}
              disabled={d.hours.length === 0}
            >
              {formatDateLabel(d.date)}
              {d.hours.length === 0 ? ' 마감' : ''}
            </button>
          ))}
        </div>
        {day && day.hours.length ? (
          <div className="cus-time-grid" role="group" aria-label="방문 시간">
            {day.hours.map((h) => (
              <button
                key={h.hour}
                type="button"
                className={`ac-btn cus-time-btn ${picked === h.hour ? 'ac-btn--primary' : 'ac-btn--outline'}`}
                aria-pressed={picked === h.hour}
                onClick={() => {
                  update({ slotDate: day.date, slotHour: h.hour, surcharge: h.surcharge });
                  if (h.surcharge) setNotice(h.surcharge);
                }}
              >
                <span className="ac-num">{formatHourLabel(h.hour)}</span>
                {h.surcharge ? <Tag tone="warning">할증</Tag> : null}
              </button>
            ))}
          </div>
        ) : (
          <Empty>이 날은 예약 가능한 시간이 없어요. 다른 날짜를 골라 주세요.</Empty>
        )}
        {days.every((d) => d.hours.length === 0) ? (
          <p className="ac-body-sm">2주 안에 예약 가능한 시간이 없어요. 고객센터로 연락해 주시면 일정을 잡아 드릴게요.</p>
        ) : null}
      </main>
      <QuoteBottomBar label={draft.surcharge ? '견적 금액 (할증 별도)' : '견적 금액'} amount={amount}>
        <Button
          variant="primary"
          size="lg"
          disabled={!ready || draft.slotDate === null || draft.slotHour === null}
          onClick={() => router.push(reservePath(quoteNo, r, '/visit'))}
        >
          다음
        </Button>
      </QuoteBottomBar>
      <Modal
        open={notice !== null}
        title="할증 시간대예요"
        description={`${notice ?? ''}이 붙는 시간이에요. 최종 금액은 예약 확인 화면에서 보여 드려요.`}
        onClose={() => setNotice(null)}
        actions={
          <Button variant="primary" onClick={() => setNotice(null)}>
            확인
          </Button>
        }
      />
    </>
  );
}
