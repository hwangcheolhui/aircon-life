// T-STL-010 정산 목록 · F-TEC-STL-01: 회차 카드(기간·건수·실지급·상태, 상태 배지 좌상단)
// 단계 10 F-TEC-STL-03: 최근 6개월 월 수입 막대(회차 종료일이 속한 달의 실지급 합계, 값은 글자로도 표시)
import { Empty, Tag } from '@aircon/ui';
import Link from 'next/link';
import { loadCodes } from '@/server/codes';
import { listTechSettlements } from '@/server/settlements';
import { techMonthlyIncome } from '@/server/tech-support';
import { requireTech } from '@/server/tech-session';
import { TechTopbar } from '@/tech/topbar';
import { SETTLEMENT_TECH_TONE, signedWon, won } from './format';

export const metadata = { title: '정산' };
export const dynamic = 'force-dynamic';

export default async function TechSettlementsPage() {
  const me = await requireTech();
  const [rows, codes, income] = await Promise.all([listTechSettlements(me.id), loadCodes(['SETTLEMENT_STATUS']), techMonthlyIncome(me.id)]);
  const max = Math.max(1, ...income.map((m) => m.amount));
  const label = (v: string) => codes.SETTLEMENT_STATUS?.find((c) => c.value === v)?.label ?? v;
  const waiting = rows.filter((r) => r.status === 'CALCULATED').length;
  return (
    <main className="tec-page__body">
      <TechTopbar title="정산" />
      <section className="tec-section" aria-labelledby="income-title">
        <h2 id="income-title" className="ac-h3">
          월 수입
        </h2>
        <ul className="tec-bars" aria-label="최근 6개월 실지급">
          {income.map((m) => (
            <li key={m.month}>
              <span className="tec-bars__value ac-num">{m.amount ? `${Math.round(m.amount / 10_000).toLocaleString('ko-KR')}만` : '0'}</span>
              <span className="tec-bars__track" aria-hidden>
                <span className="tec-bars__bar" style={{ height: `${Math.max(m.amount > 0 ? 4 : 0, Math.round((Math.max(0, m.amount) / max) * 100))}%` }} />
              </span>
              <span className="ac-caption ac-num">{Number(m.month.slice(5))}월</span>
              <span className="ac-sr-only">{won(m.amount)}</span>
            </li>
          ))}
        </ul>
      </section>
      {waiting ? <p className="ac-body">확인할 정산이 {waiting}건 있습니다. 내역을 보고 [확인] 또는 [이의 제기]를 눌러 주세요.</p> : null}
      {rows.length ? (
        <ul className="tec-job-list">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/tech/settlements/${r.id}`} className={`tec-job-card${r.status === 'PAID' ? ' is-done' : ''}`}>
                <div className="tec-job-card__top">
                  <Tag tone={SETTLEMENT_TECH_TONE[r.status]}>{label(r.status)}</Tag>
                  <span className="ac-body ac-num">{r.batchNo}</span>
                  <strong className="tec-job-card__time ac-num">{signedWon(r.netPay)}</strong>
                </div>
                <span className="ac-body-sm ac-num">
                  {r.periodStart} ~ {r.periodEnd} · {r.jobCount}건
                  {r.scheduledPayDate && r.status !== 'PAID' ? ` · 지급 예정 ${r.scheduledPayDate}` : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>아직 정산 내역이 없습니다.</Empty>
      )}
    </main>
  );
}
