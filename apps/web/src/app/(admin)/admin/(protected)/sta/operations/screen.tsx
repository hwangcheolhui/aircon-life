'use client';
// A-STA-020 운영 통계: 기간 조회, 지표 카드(색 + 숫자), 기기 유형별 평균 작업시간 표(숫자 우측 정렬)
import { Empty } from '@aircon/ui';
import { type Option, labelOf } from '@/admin/crud-screen';
import type { opsStats } from '@/server/stats';
import { PeriodForm, pct } from '../period-form';

type Data = Awaited<ReturnType<typeof opsStats>>;

export function OpsStatsScreen({ data, query, codes }: { data: Data; query: { from: string; to: string }; codes: Record<string, Option[]> }) {
  const c = data.counts;
  return (
    <div className="ac-stack">
      <div className="adm-page-head">
        <h1 className="ac-h2">운영 통계</h1>
      </div>
      <PeriodForm path="/admin/sta/operations" from={query.from} to={query.to} />
      <div className="adm-stat-grid">
        {[
          { label: '약속 주문(방문일 기준)', value: `${c.orders.toLocaleString()}건` },
          { label: '처리 완료', value: `${c.completed.toLocaleString()}건 (${pct(data.rates.completedRate)})` },
          { label: '취소율', value: `${pct(data.rates.cancelRate)} · ${c.canceled}건` },
          { label: '미처리율(취소 제외)', value: `${pct(data.rates.pendingRate)} · ${c.pendingEver}건` },
          { label: '슬롯 가동률', value: `${pct(data.rates.slotUtilization)} (${c.slotBooked}/${c.slotCapacity})` },
          { label: '끝난 작업', value: `${c.worksDone.toLocaleString()}건` },
        ].map((x) => (
          <section key={x.label} className="ac-card adm-stat">
            <span className="adm-stat__label">{x.label}</span>
            <span className="adm-stat__value ac-num">{x.value}</span>
          </section>
        ))}
      </div>
      <section className="ac-card">
        <h2 className="ac-h3">기기 유형별 평균 작업시간</h2>
        {data.byType.length === 0 ? (
          <Empty />
        ) : (
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">기기 유형</th>
                <th scope="col" className="is-num">작업 수</th>
                <th scope="col" className="is-num">평균 작업시간(분)</th>
              </tr>
            </thead>
            <tbody>
              {data.byType.map((r) => (
                <tr key={r.deviceType}>
                  <td>{labelOf(codes.DEVICE_TYPE, r.deviceType)}</td>
                  <td className="is-num ac-num">{r.jobs.toLocaleString()}</td>
                  <td className="is-num ac-num">{r.avgMinutes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="ac-caption">여러 유형이 섞인 작업은 각 유형에 같은 작업시간을 넣어 계산합니다.</p>
      </section>
    </div>
  );
}
