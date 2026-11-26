'use client';
/**
 * 고객 견적 스텝 플로우 공통 (03 §2.1: 홈 CTA에서 시작하는 전체화면 스텝, 하단 탭 숨김, 상단 진행바).
 * 입력값은 브라우저 sessionStorage 에만 임시로 둔다. 견적 단계에서는 주소를 서버에 저장하지 않고(비회원, 개인정보 최소화)
 * 법정동 코드만 견적(quote.legal_dong_code)에 남긴다. 주소는 예약 단계(단계 2, customer_address)에서 저장한다.
 */
import type { AddressResult } from '@aircon/integrations/address';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';
import { formatWon } from './format';

export interface QuoteDraft {
  address: AddressResult | null;
  /** C-QUO-020 선택한 기기 형태(DEVICE_TYPE) */
  deviceTypes: string[];
  /** C-QUO-030 기기 형태별 대수·작업 범위 */
  lines: Record<string, { quantity: number; cleanLevel: string }>;
  /** C-QUO-030 옵션 ID → 수량 */
  options: Record<string, number>;
  /** 단계 9 C-QUO-021 사진 인식 이미지 ID (견적 발행 때 연결) */
  imageIds?: number[];
}

const EMPTY: QuoteDraft = { address: null, deviceTypes: [], lines: {}, options: {} };
const KEY = 'ac.quote.v1';

const Ctx = createContext<{
  draft: QuoteDraft;
  ready: boolean;
  update: (patch: Partial<QuoteDraft>) => void;
  reset: () => void;
}>({
  draft: EMPTY,
  ready: false,
  update: () => undefined,
  reset: () => undefined,
});

export function QuoteFlowProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<QuoteDraft>(EMPTY);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) setDraft({ ...EMPTY, ...(JSON.parse(raw) as Partial<QuoteDraft>) });
    } catch {
      // 저장소를 쓸 수 없으면(사생활 보호 모드 등) 메모리에서만 진행
    }
    setReady(true);
  }, []);
  const persist = (next: QuoteDraft) => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // 무시
    }
  };
  const update = useCallback((patch: Partial<QuoteDraft>) => {
    setDraft((d) => {
      const next = { ...d, ...patch };
      persist(next);
      return next;
    });
  }, []);
  const reset = useCallback(() => {
    setDraft(EMPTY);
    persist(EMPTY);
  }, []);
  return <Ctx.Provider value={{ draft, ready, update, reset }}>{children}</Ctx.Provider>;
}

export const useQuoteDraft = () => useContext(Ctx);

export const QUOTE_STEPS = ['위치', '기기', '대수', '견적'] as const;

/** 상단: 뒤로가기 + 진행바(.ac-progress / .ac-steps) */
export function StepHeader({
  step,
  backHref,
  title,
}: {
  step: 1 | 2 | 3 | 4;
  backHref: string;
  title: string;
}) {
  return (
    <header className="cus-step-head">
      <div className="ac-row">
        <Link href={backHref} className="ac-btn ac-btn--ghost ac-btn--icon" aria-label="이전 단계">
          <ChevronLeft aria-hidden />
        </Link>
        <span className="ac-caption ac-num">
          {step} / {QUOTE_STEPS.length}
        </span>
      </div>
      <div
        className="ac-progress"
        role="progressbar"
        aria-label="견적 진행"
        aria-valuemin={1}
        aria-valuemax={QUOTE_STEPS.length}
        aria-valuenow={step}
      >
        <span style={{ width: `${(step / QUOTE_STEPS.length) * 100}%` }} />
      </div>
      <ol className="ac-steps" aria-hidden>
        {QUOTE_STEPS.map((s, i) => (
          <li key={s} className={i + 1 === step ? 'is-current' : undefined}>
            {s}
          </li>
        ))}
      </ol>
      <h1 className="ac-h2">{title}</h1>
    </header>
  );
}

/** 금액 표시 하단 바 (CLAUDE.md §8: 고객 스텝 플로우 금액은 항상 .ac-bottom-bar) */
export function QuoteBottomBar({
  label,
  amount,
  children,
}: {
  label: string;
  amount: number | null;
  children: ReactNode;
}) {
  return (
    <div className="ac-bottom-bar">
      <div className="ac-bottom-bar__price">
        <span className="ac-caption">{label}</span>
        <strong className="ac-num" aria-live="polite">
          {amount == null ? '–' : formatWon(amount)}
        </strong>
      </div>
      {children}
    </div>
  );
}
