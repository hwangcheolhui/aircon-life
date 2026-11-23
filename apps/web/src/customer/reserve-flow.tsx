'use client';
/**
 * 고객 예약 스텝 플로우 공통 (C-RSV-010 → 020 → 030 → C-PAY-010 → C-RSV-040).
 * 고른 일정·방문 정보는 확정 전까지 브라우저 sessionStorage 에만 둔다. 확정(C-RSV-030)할 때 서버가 슬롯 잔여·금액을 다시 확인한다(BR-021).
 * 주소는 견적 단계(ac.quote.v1)에서 고른 주소를 이어받는다.
 */
import type { AddressResult } from '@aircon/integrations/address';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';

export interface ReserveDraft {
  quoteNo: string;
  /** 체험 모드 견적 입력값 (?r=) */
  r: string | null;
  slotDate: string | null;
  slotHour: number | null;
  surcharge: string | null;
  address: AddressResult | null;
  detailAddress: string;
  housingType: string;
  hasElevator: boolean;
  parkingNote: string;
  customerRequest: string;
}

const KEY = 'ac.reserve.v1';
const QUOTE_KEY = 'ac.quote.v1';
const empty = (quoteNo: string, r: string | null): ReserveDraft => ({
  quoteNo,
  r,
  slotDate: null,
  slotHour: null,
  surcharge: null,
  address: null,
  detailAddress: '',
  housingType: '',
  hasElevator: false,
  parkingNote: '',
  customerRequest: '',
});

const Ctx = createContext<{ draft: ReserveDraft; ready: boolean; update: (p: Partial<ReserveDraft>) => void; clear: () => void } | null>(null);

export function ReserveFlowProvider({ quoteNo, r, children }: { quoteNo: string; r: string | null; children: ReactNode }) {
  const [draft, setDraft] = useState<ReserveDraft>(() => empty(quoteNo, r));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let next = empty(quoteNo, r);
    try {
      const saved = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as ReserveDraft | null;
      if (saved && saved.quoteNo === quoteNo && (saved.r ?? null) === r) next = { ...next, ...saved };
      if (!next.address) {
        const q = JSON.parse(sessionStorage.getItem(QUOTE_KEY) ?? 'null') as { address?: AddressResult | null } | null;
        next.address = q?.address ?? null;
      }
    } catch {
      // 저장소를 쓸 수 없으면 메모리에서만 진행
    }
    setDraft(next);
    setReady(true);
  }, [quoteNo, r]);
  const update = useCallback((p: Partial<ReserveDraft>) => {
    setDraft((d) => {
      const n = { ...d, ...p };
      try {
        sessionStorage.setItem(KEY, JSON.stringify(n));
      } catch {
        // 무시
      }
      return n;
    });
  }, []);
  const clear = useCallback(() => {
    try {
      sessionStorage.removeItem(KEY);
      sessionStorage.removeItem(QUOTE_KEY);
    } catch {
      // 무시
    }
  }, []);
  return <Ctx.Provider value={{ draft, ready, update, clear }}>{children}</Ctx.Provider>;
}

export function useReserveDraft() {
  const c = useContext(Ctx);
  if (!c) throw new Error('ReserveFlowProvider 안에서만 쓸 수 있습니다.');
  return c;
}

/** 예약 경로 (체험 모드는 ?r= 를 이어 붙인다) */
export const reservePath = (quoteNo: string, r: string | null, step = '') =>
  `/reserve/${quoteNo}${step}${r ? `?r=${encodeURIComponent(r)}` : ''}`;

export const RESERVE_STEPS = ['일정', '방문 정보', '확인', '결제'] as const;

export function ReserveStepHeader({ step, backHref, title }: { step: 1 | 2 | 3 | 4; backHref: string; title: string }) {
  return (
    <header className="cus-step-head">
      <div className="ac-row">
        <Link href={backHref} className="ac-btn ac-btn--ghost ac-btn--icon" aria-label="이전 단계">
          <ChevronLeft aria-hidden />
        </Link>
        <span className="ac-caption ac-num">
          {step} / {RESERVE_STEPS.length}
        </span>
      </div>
      <div className="ac-progress" role="progressbar" aria-label="예약 진행" aria-valuemin={1} aria-valuemax={RESERVE_STEPS.length} aria-valuenow={step}>
        <span style={{ width: `${(step / RESERVE_STEPS.length) * 100}%` }} />
      </div>
      <ol className="ac-steps" aria-hidden>
        {RESERVE_STEPS.map((s, i) => (
          <li key={s} className={i + 1 === step ? 'is-current' : undefined}>
            {s}
          </li>
        ))}
      </ol>
      <h1 className="ac-h2">{title}</h1>
    </header>
  );
}
