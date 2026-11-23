'use client';
// C-QUO-030 대수·작업범위·옵션 · F-CUS-QUO-03 (하단 바 예상 금액은 F-CUS-QUO-04 공용 계산)
import { Alert, Button, Card } from '@aircon/ui';
import { Minus, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { previewQuote, submitQuote } from '@/app/(customer)/quote/actions';
import { formatWon } from './format';
import { QuoteBottomBar, StepHeader, useQuoteDraft } from './quote-flow';

type Opt = { value: string; label: string };
export interface CountStepProps {
  products: { id: number; deviceType: string; cleanLevel: string; name: string }[];
  options: { id: number; productId: number | null; name: string; price: number }[];
  deviceLabels: Opt[];
  cleanLevels: Opt[];
}

const MAX_QTY = 99;

function Stepper({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="ac-stepper" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`${label} 줄이기`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        <Minus aria-hidden size={18} />
      </button>
      <output aria-live="polite">{value}</output>
      <button
        type="button"
        aria-label={`${label} 늘리기`}
        disabled={value >= MAX_QTY}
        onClick={() => onChange(value + 1)}
      >
        <Plus aria-hidden size={18} />
      </button>
    </div>
  );
}

export function CountStep({ products, options, deviceLabels, cleanLevels }: CountStepProps) {
  const router = useRouter();
  const { draft, ready, update } = useQuoteDraft();
  const [amount, setAmount] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const devices = useMemo(
    () => draft.deviceTypes.filter((d) => products.some((p) => p.deviceType === d)),
    [draft.deviceTypes, products],
  );
  useEffect(() => {
    if (!ready) return;
    if (!draft.address) router.replace('/quote');
    else if (devices.length === 0) router.replace('/quote/device');
  }, [ready, draft.address, devices.length, router]);

  /** 기기 형태별 선택 가능한 작업 범위 (CLEAN_LEVEL 코드 순서) */
  const levelsOf = (deviceType: string) =>
    cleanLevels.filter((c) => products.some((p) => p.deviceType === deviceType && p.cleanLevel === c.value));
  const lineOf = (d: string) => {
    const saved = draft.lines[d];
    const levels = levelsOf(d);
    const level =
      saved && levels.some((l) => l.value === saved.cleanLevel) ? saved.cleanLevel : (levels[0]?.value ?? '');
    return { quantity: saved?.quantity ?? 1, cleanLevel: level };
  };
  const setLine = (d: string, patch: Partial<{ quantity: number; cleanLevel: string }>) =>
    update({ lines: { ...draft.lines, [d]: { ...lineOf(d), ...patch } } });

  const selectedProductIds = new Set(
    devices
      .map((d) => products.find((p) => p.deviceType === d && p.cleanLevel === lineOf(d).cleanLevel)?.id)
      .filter(Boolean),
  );
  const visibleOptions = options.filter((o) => o.productId === null || selectedProductIds.has(o.productId));

  const request = draft.address
    ? {
        legalDongCode: draft.address.legalDongCode,
        lines: devices.map((d) => ({ deviceType: d, ...lineOf(d) })),
        options: visibleOptions
          .map((o) => ({ optionId: o.id, quantity: draft.options[String(o.id)] ?? 0 }))
          .filter((o) => o.quantity > 0),
      }
    : null;
  const requestKey = JSON.stringify(request);

  useEffect(() => {
    const req = JSON.parse(requestKey) as typeof request;
    if (!req || req.lines.length === 0) return;
    let alive = true;
    const t = setTimeout(async () => {
      const r = await previewQuote(req);
      if (!alive) return;
      if (r.ok && r.data?.ok) {
        setAmount(r.data.totalAmount);
        setNotice(null);
      } else {
        setAmount(null);
        setNotice(
          r.ok
            ? r.data && !r.data.ok
              ? r.data.message
              : null
            : (r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? null),
        );
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [requestKey]);

  const submit = async () => {
    if (!request) return;
    setSubmitting(true);
    const r = await submitQuote(request);
    if (r.ok && r.data?.ok) {
      router.push(r.data.path);
      return;
    }
    setSubmitting(false);
    setNotice(
      r.ok
        ? r.data && !r.data.ok
          ? r.data.message
          : null
        : (r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? null),
    );
  };

  const label = (d: string) => deviceLabels.find((x) => x.value === d)?.label ?? d;
  return (
    <>
      <main className="cus-flow__body">
        <StepHeader
          step={3}
          backHref={`/quote/device?dong=${encodeURIComponent(draft.address?.legalDongCode ?? '')}`}
          title="몇 대를 어떻게 청소할까요?"
        />
        {devices.map((d) => {
          const line = lineOf(d);
          const levels = levelsOf(d);
          return (
            <Card key={d}>
              <div className="cus-line-head">
                <h2 className="ac-h3" style={{ margin: 0 }}>
                  {label(d)}
                </h2>
                <Stepper
                  label={`${label(d)} 대수`}
                  value={line.quantity}
                  min={1}
                  onChange={(v) => setLine(d, { quantity: v })}
                />
              </div>
              {levels.length > 1 ? (
                <div
                  className="ac-segmented"
                  role="group"
                  aria-label={`${label(d)} 작업 범위`}
                  style={{ marginTop: 'var(--space-4)' }}
                >
                  {levels.map((l) => (
                    <button
                      key={l.value}
                      type="button"
                      aria-pressed={line.cleanLevel === l.value}
                      onClick={() => setLine(d, { cleanLevel: l.value })}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="ac-caption" style={{ marginBottom: 0 }}>
                  작업 범위: {levels[0]?.label}
                </p>
              )}
            </Card>
          );
        })}
        {visibleOptions.length ? (
          <Card>
            <h2 className="ac-h3" style={{ marginTop: 0 }}>
              추가 옵션
            </h2>
            {visibleOptions.map((o) => (
              <div key={o.id} className="cus-line-head ac-list-item">
                <div className="ac-list-item__body">
                  <span className="ac-body">{o.name}</span>
                  <br />
                  <span className="ac-caption ac-num">+{formatWon(o.price)}</span>
                </div>
                <Stepper
                  label={o.name}
                  value={draft.options[String(o.id)] ?? 0}
                  min={0}
                  onChange={(v) => update({ options: { ...draft.options, [String(o.id)]: v } })}
                />
              </div>
            ))}
          </Card>
        ) : null}
        {notice ? <Alert tone="warning">{notice}</Alert> : null}
      </main>
      <QuoteBottomBar label="예상 금액" amount={amount}>
        <Button
          variant="primary"
          size="lg"
          disabled={!request || amount === null}
          loading={submitting}
          onClick={submit}
        >
          견적 보기
        </Button>
      </QuoteBottomBar>
    </>
  );
}
