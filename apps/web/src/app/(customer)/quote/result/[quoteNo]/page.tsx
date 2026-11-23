// C-QUO-040 견적 결과 (S4) · F-CUS-QUO-04 · 단계 2: [예약하기] → C-RSV-010 — 항목별 금액·할인·할증·총액·소요시간·포함/불포함·현장 추가요금 조건·유효기한
import { customerQuoteInput } from '@aircon/contracts';
import { SETTING_KEYS, isQuoteExpired, quoteExpiresAt } from '@aircon/domain';
import { Alert, Button, Card } from '@aircon/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDuration, formatWon } from '@/customer/format';
import { QuoteBottomBar, StepHeader } from '@/customer/quote-flow';
import { computeQuote, getQuoteByNo } from '@/server/quote';
import { DEMO_QUOTE_NO, decodeDemoRequest, isQuoteDemoMode } from '@/server/quote-demo';
import { getSettingNumber } from '@/server/settings';

export const metadata = { title: '견적 결과' };
export const dynamic = 'force-dynamic';

const kst = (d: Date) =>
  d.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** 체험 모드(DB 미연결): 저장된 견적 대신 주소에 담긴 입력값으로 같은 공용 계산을 다시 한다 */
async function demoQuote(raw: string | undefined) {
  const parsed = customerQuoteInput.safeParse(decodeDemoRequest(raw));
  if (!parsed.success) return null;
  const r = await computeQuote({ ...parsed.data, customerType: 'PERSONAL', visit: null });
  if (!r.ok) return null;
  const now = new Date();
  return {
    quoteNo: '체험용(저장 안 됨)',
    status: 'ISSUED',
    totalAmount: r.totalAmount,
    estimatedDurationMin: r.estimatedDurationMin,
    expiresAt: quoteExpiresAt(now, await getSettingNumber(SETTING_KEYS.QUOTE_EXPIRE_DAYS)),
    snapshot: r.snapshot,
  };
}

export default async function QuoteResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ quoteNo: string }>;
  searchParams: Promise<{ r?: string }>;
}) {
  const { quoteNo } = await params;
  const demo = isQuoteDemoMode();
  const q = demo
    ? quoteNo === DEMO_QUOTE_NO
      ? await demoQuote((await searchParams).r)
      : null
    : /^Q\d{10}$/.test(quoteNo)
      ? await getQuoteByNo(quoteNo)
      : null;
  if (!q || !q.snapshot) notFound();
  const s = q.snapshot;
  const expired = isQuoteExpired(q, new Date());
  const lines = s.items.filter((i) => i.itemType === 'PRODUCT' || i.itemType === 'OPTION');
  const discounts = s.items.filter((i) => i.itemType === 'DISCOUNT');
  const surcharges = s.items.filter((i) => i.itemType === 'SURCHARGE');
  // C-RSV-010 로 (비로그인이면 휴대폰 인증을 거쳐 돌아온다, F-CUS-AUTH-02)
  const r = demo ? (await searchParams).r : undefined;
  const reserveHref = `/reserve/${demo ? DEMO_QUOTE_NO : quoteNo}${r ? `?r=${encodeURIComponent(r)}` : ''}`;

  return (
    <>
      <main className="cus-flow__body">
        <StepHeader step={4} backHref="/quote/device" title="표준 견적이 나왔어요" />
        <p className="ac-caption" style={{ margin: 0 }}>
          견적번호 <span className="ac-num">{q.quoteNo}</span>
        </p>
        {expired ? <Alert tone="warning">유효기간이 지난 견적입니다. 다시 견적을 받아 주세요.</Alert> : null}
        {s.needsSiteSurvey ? (
          <Alert tone="warning">
            시스템·천장형이 여러 대라 현장 확인 후 최종 견적을 드려요. 학교·사무실·매장 등 대량 문의는
            고객센터로 연락해 주세요.
          </Alert>
        ) : null}

        <Card>
          <h2 className="ac-h3" style={{ marginTop: 0 }}>
            견적 내역
          </h2>
          {lines.map((i, idx) => (
            <div key={`l${idx}`} className="cus-amount-row ac-body">
              <span>
                {i.name} <span className="ac-num">× {i.quantity}</span>
              </span>
              <span className="ac-num">{formatWon(i.amount)}</span>
            </div>
          ))}
          {discounts.map((i, idx) => (
            <div key={`d${idx}`} className="cus-amount-row ac-body">
              <span>{i.name}</span>
              <span className="ac-num is-minus">−{formatWon(-i.amount)}</span>
            </div>
          ))}
          {surcharges.map((i, idx) => (
            <div key={`s${idx}`} className="cus-amount-row ac-body">
              <span>{i.name}</span>
              <span className="ac-num">+{formatWon(i.amount)}</span>
            </div>
          ))}
          <div className="cus-amount-row cus-amount-row--total ac-body-lg">
            <span>총 견적 금액</span>
            <span className="ac-num">{formatWon(q.totalAmount)}</span>
          </div>
          <p className="ac-caption" style={{ marginBottom: 0 }}>
            부가세 포함 · 예상 소요시간{' '}
            <span className="ac-num">{formatDuration(q.estimatedDurationMin ?? 0)}</span>
            {q.expiresAt ? (
              <>
                {' '}
                · <span className="ac-num">{kst(q.expiresAt)}</span>까지 유효
              </>
            ) : null}
          </p>
        </Card>

        {s.products.some((p) => p.includedItems || p.excludedItems) ? (
          <Card>
            <h2 className="ac-h3" style={{ marginTop: 0 }}>
              작업 범위
            </h2>
            {s.products.map((p) => (
              <div key={p.productId} style={{ marginBottom: 'var(--space-3)' }}>
                <p className="ac-body" style={{ margin: 0, fontWeight: 600 }}>
                  {p.name}
                </p>
                {p.includedItems ? (
                  <p className="ac-body-sm" style={{ margin: 0 }}>
                    포함: {p.includedItems}
                  </p>
                ) : null}
                {p.excludedItems ? (
                  <p className="ac-body-sm" style={{ margin: 0 }}>
                    불포함: {p.excludedItems}
                  </p>
                ) : null}
              </div>
            ))}
          </Card>
        ) : null}

        {s.onSiteRules.length ? (
          <Card>
            <h2 className="ac-h3" style={{ marginTop: 0 }}>
              현장에서 추가요금이 생길 수 있는 경우
            </h2>
            <ul className="cus-plain-list ac-body-sm">
              {s.onSiteRules.map((r) => (
                <li key={r.ruleCode}>
                  {r.name}{' '}
                  <span className="ac-num">
                    {r.amountType === 'RATE' ? `${r.amount}%` : formatWon(r.amount)}
                  </span>
                  {r.perUnit ? ' (대당)' : ''}
                  {r.customerNotice ? <span className="ac-caption"> · {r.customerNotice}</span> : null}
                </li>
              ))}
            </ul>
            <p className="ac-caption" style={{ marginBottom: 0 }}>
              추가요금은 기사님이 현장에서 설명하고 고객님이 동의한 경우에만 청구됩니다.
            </p>
          </Card>
        ) : null}

        <Link href="/quote" className="ac-btn ac-btn--ghost">
          처음부터 다시 견적 받기
        </Link>
      </main>
      <QuoteBottomBar label="총 견적 금액" amount={q.totalAmount}>
        {expired || s.needsSiteSurvey ? (
          <Button variant="primary" size="lg" disabled>
            예약하기
          </Button>
        ) : (
          <Link href={reserveHref} className="ac-btn ac-btn--primary ac-btn--lg">
            예약하기
          </Link>
        )}
      </QuoteBottomBar>
    </>
  );
}
