// T-STL-020 정산 상세 · F-TEC-STL-02: 기본 배분·추가요금·인센티브·공제·현장 수금 상계·원천세·실지급, 건별 내역, [확인] / [이의 제기(사유)].
// 회차가 확정되면 더 답할 수 없고, 확정 뒤 고칠 내용은 다음 회차 조정으로 들어온다(BR-084).
import { Card, Empty, Tag } from '@aircon/ui';
import { notFound } from 'next/navigation';
import { formatDateTime } from '@/customer/format';
import { loadCodes } from '@/server/codes';
import { getTechSettlement } from '@/server/settlements';
import { requireTech } from '@/server/tech-session';
import { TechTopbar } from '@/tech/topbar';
import { SETTLEMENT_TECH_TONE, signedWon, won } from '../format';
import { SettlementRespond } from './respond';

export const metadata = { title: '정산 상세' };
export const dynamic = 'force-dynamic';

export default async function TechSettlementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireTech();
  const id = Number((await params).id);
  const d = Number.isInteger(id) && id > 0 ? await getTechSettlement(me.id, id) : null;
  if (!d) notFound();
  const codes = await loadCodes(['SETTLEMENT_STATUS', 'SETTLEMENT_ITEM_TYPE', 'ASSIGN_ROLE']);
  const label = (g: string, v: string | null) => (v ? (codes[g]?.find((c) => c.value === v)?.label ?? v) : '');
  const s = d.settlement;
  return (
    <main className="tec-page__body">
      <TechTopbar title="정산 상세" back={{ href: '/tech/settlements', label: '정산 목록' }} />
      <Card>
        <div className="tec-job-card__top">
          <Tag tone={SETTLEMENT_TECH_TONE[s.status]}>{label('SETTLEMENT_STATUS', s.status)}</Tag>
          <span className="ac-body ac-num">{d.batch.batchNo}</span>
        </div>
        <p className="ac-body-sm ac-num">
          {d.batch.periodStart} ~ {d.batch.periodEnd}
          {s.paidAt ? ` · 지급 ${formatDateTime(new Date(s.paidAt))}` : d.batch.scheduledPayDate ? ` · 지급 예정 ${d.batch.scheduledPayDate}` : ''}
        </p>
        <dl className="tec-kv ac-body">
          <dt>처리 건수</dt>
          <dd className="ac-num">{s.jobCount}건</dd>
          <dt>기본 배분</dt>
          <dd className="ac-num">{won(s.basePay)}</dd>
          <dt>추가요금 배분</dt>
          <dd className="ac-num">{won(s.extraPay)}</dd>
          <dt>인센티브</dt>
          <dd className="ac-num">{won(s.incentive)}</dd>
          <dt>공제</dt>
          <dd className="ac-num">{s.deduction ? `−${won(s.deduction)}` : won(0)}</dd>
          <dt>원천세</dt>
          <dd className="ac-num">{s.withholdingTax ? `−${won(s.withholdingTax)}` : won(0)}</dd>
          <dt>현장 수금 상계</dt>
          <dd className="ac-num">{s.cashCollected ? `−${won(s.cashCollected)}` : won(0)}</dd>
          <dt>실지급액</dt>
          <dd className="ac-num">
            <strong>{signedWon(s.netPay)}</strong>
          </dd>
        </dl>
        {s.cashCollected ? <p className="ac-caption">현장에서 직접 받은 현금·계좌이체는 지급액에서 뺍니다.</p> : null}
        {s.netPay < 0 ? <p className="ac-caption">현장 수금이 지급액보다 많아 이번 회차는 이체가 없습니다. 차액은 다음 회차에서 정리합니다.</p> : null}
        {s.disputeNote ? <p className="ac-body-sm">내 이의 내용: {s.disputeNote}</p> : null}
      </Card>

      <h2 className="ac-h3 tec-section">건별 내역</h2>
      {d.items.length ? (
        <ul className="ac-list">
          {d.items.map((i) => (
            <li key={i.id} className="ac-list-item">
              <div className="ac-list-item__body">
                <div className="tec-head-row">
                  <span className="ac-body">
                    {label('SETTLEMENT_ITEM_TYPE', i.itemType)}
                    {i.role ? ` · ${label('ASSIGN_ROLE', i.role)}` : ''}
                  </span>
                  <strong className="ac-num">{signedWon(i.payAmount)}</strong>
                </div>
                <span className="ac-caption ac-num">
                  {[i.orderNo, i.salesAmount ? `매출 ${won(i.salesAmount)}` : null, i.shareRate !== null ? `${Number(i.shareRate)}%` : null, i.memo]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty />
      )}
      {s.status === 'CALCULATED' && d.batch.status === 'CALCULATED' ? <SettlementRespond settlementId={s.id} /> : null}
    </main>
  );
}
