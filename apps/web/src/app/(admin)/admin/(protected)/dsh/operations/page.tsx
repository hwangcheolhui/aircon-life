// A-DSH-010 운영 현황(오늘) · F-ADM-DSH-01: 상태별 카운트 카드, 거점 슬롯 가동률, 긴급(약속 임박 미배정)·장기 미처리 목록, 기사 현황
import { StatusBadge } from '@aircon/ui';
import Link from 'next/link';
import { labelOf } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { operationsToday } from '@/server/ops';
import { purgeCandidateCount } from '@/server/purge';
import { hasPermission } from '@aircon/domain';

export const dynamic = 'force-dynamic';

export default async function OperationsPage() {
  const admin = await requireScreen('A-DSH-010');
  const filter = await currentBranchFilter(admin);
  const [d, codes, purgeDue] = await Promise.all([
    operationsToday(filter),
    loadCodes(['PENDING_REASON']),
    hasPermission(admin, 'A-CUS-030', 'APPROVE') ? purgeCandidateCount(filter) : Promise.resolve(0),
  ]);
  const cards = [
    { label: '오늘 접수', value: d.counts.received, href: '/admin/ord/orders' },
    { label: '배정 대기', value: d.counts.assignWait, href: '/admin/dsp/board' },
    { label: '작업 중', value: d.counts.inProgress, href: '/admin/dsp/board' },
    { label: '오늘 작업 완료', value: d.counts.workDone, href: '/admin/ord/orders' },
    { label: '미처리', value: d.counts.pending, href: '/admin/prc/pending' },
  ];
  return (
    <div className="ac-stack">
      <div className="adm-page-head">
        <h1 className="ac-h2">운영 현황</h1>
        <span className="ac-body-sm ac-num">{d.today} 기준</span>
      </div>
      {purgeDue > 0 ? (
        <div className="ac-alert ac-alert--warning" role="status">
          <div>
            파기 예정일이 지난 고객이 <strong className="ac-num">{purgeDue}</strong>명 있습니다. <Link href="/admin/cus/purge">파기 대상 관리</Link>
          </div>
        </div>
      ) : null}
      <div className="adm-stat-grid">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="ac-card adm-stat">
            <span className="adm-stat__label">{c.label}</span>
            <span className="adm-stat__value ac-num">{c.value.toLocaleString()}건</span>
          </Link>
        ))}
      </div>
      <div className="adm-two-col">
        <section className="ac-card">
          <h2 className="ac-h3">거점 슬롯 가동률 (오늘)</h2>
          {d.slots.length === 0 ? (
            <p className="ac-body-sm">오늘 열린 슬롯이 없습니다.</p>
          ) : (
            <table className="ac-table">
              <thead>
                <tr>
                  <th scope="col">거점</th>
                  <th scope="col" className="is-num">예약/전체</th>
                  <th scope="col" className="is-num">가동률</th>
                </tr>
              </thead>
              <tbody>
                {d.slots.map((s) => (
                  <tr key={s.branchId}>
                    <td>{s.name}</td>
                    <td className="is-num ac-num">
                      {s.booked} / {s.capacity}
                    </td>
                    <td className="is-num ac-num">{s.rate === null ? '-' : `${s.rate}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="ac-card">
          <h2 className="ac-h3">기사 현황</h2>
          {d.techs.length === 0 ? (
            <p className="ac-body-sm">등록된 기사가 없습니다.</p>
          ) : (
            <table className="ac-table">
              <thead>
                <tr>
                  <th scope="col">거점</th>
                  <th scope="col" className="is-num">활동</th>
                  <th scope="col" className="is-num">근무 중</th>
                  <th scope="col" className="is-num">작업 중</th>
                </tr>
              </thead>
              <tbody>
                {d.techs.map((t) => (
                  <tr key={t.branchName}>
                    <td>{t.branchName}</td>
                    <td className="is-num ac-num">{t.active}명</td>
                    <td className="is-num ac-num">{t.onDuty}명</td>
                    <td className="is-num ac-num">{t.working}명</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      <div className="adm-two-col">
        <section className="ac-card">
          <h2 className="ac-h3">긴급: 약속 임박 미배정 ({d.urgent.length})</h2>
          {d.urgent.length === 0 ? (
            <p className="ac-body-sm">조회 결과가 없습니다.</p>
          ) : (
            <table className="ac-table">
              <thead>
                <tr>
                  <th scope="col">상태</th>
                  <th scope="col">접수번호</th>
                  <th scope="col">거점</th>
                  <th scope="col">약속일시</th>
                </tr>
              </thead>
              <tbody>
                {d.urgent.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <StatusBadge code={o.status} audience="staff" />
                    </td>
                    <td className="ac-num">
                      <Link href={`/admin/ord/orders/${o.id}`}>{o.orderNo}</Link>
                    </td>
                    <td>{o.branchName}</td>
                    <td className="ac-num">{formatDateTime(o.promisedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="ac-card">
          <h2 className="ac-h3">장기 미처리 48시간 경과 ({d.longPending.length})</h2>
          {d.longPending.length === 0 ? (
            <p className="ac-body-sm">조회 결과가 없습니다.</p>
          ) : (
            <table className="ac-table">
              <thead>
                <tr>
                  <th scope="col">상태</th>
                  <th scope="col">접수번호</th>
                  <th scope="col">거점</th>
                  <th scope="col">사유</th>
                </tr>
              </thead>
              <tbody>
                {d.longPending.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <StatusBadge code={o.status} audience="staff" overdue48h />
                    </td>
                    <td className="ac-num">
                      <Link href={`/admin/ord/orders/${o.id}`}>{o.orderNo}</Link>
                    </td>
                    <td>{o.branchName}</td>
                    <td>{o.pendingReason ? labelOf(codes.PENDING_REASON, o.pendingReason) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
