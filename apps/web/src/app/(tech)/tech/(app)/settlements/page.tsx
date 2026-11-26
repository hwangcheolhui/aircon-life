// T-STL-010 정산 목록 · F-TEC-STL-01: 회차 카드(기간·건수·실지급·상태, 상태 배지 좌상단). 월 수입 그래프(F-TEC-STL-03)는 단계 10.
import { Empty, Tag } from '@aircon/ui';
import Link from 'next/link';
import { loadCodes } from '@/server/codes';
import { listTechSettlements } from '@/server/settlements';
import { requireTech } from '@/server/tech-session';
import { TechTopbar } from '@/tech/topbar';
import { SETTLEMENT_TECH_TONE, signedWon } from './format';

export const metadata = { title: '정산' };
export const dynamic = 'force-dynamic';

export default async function TechSettlementsPage() {
  const me = await requireTech();
  const [rows, codes] = await Promise.all([listTechSettlements(me.id), loadCodes(['SETTLEMENT_STATUS'])]);
  const label = (v: string) => codes.SETTLEMENT_STATUS?.find((c) => c.value === v)?.label ?? v;
  const waiting = rows.filter((r) => r.status === 'CALCULATED').length;
  return (
    <main className="tec-page__body">
      <TechTopbar title="정산" />
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
