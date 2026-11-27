'use client';
// A-STA-030 기사 성과: 건수 많은 순, 숫자·금액 열 우측 정렬. AS율 = 귀책 AS ÷ 처리 건수(BR-051)
import { Empty } from '@aircon/ui';
import { won } from '@/admin/crud-screen';
import type { techStats } from '@/server/stats';
import { PeriodForm, pct } from '../period-form';

type Row = Awaited<ReturnType<typeof techStats>>[number];

export function TechStatsScreen({ rows, query }: { rows: Row[]; query: { from: string; to: string } }) {
  return (
    <div className="ac-stack">
      <div className="adm-page-head">
        <h1 className="ac-h2">기사 성과</h1>
      </div>
      <PeriodForm path="/admin/sta/technicians" from={query.from} to={query.to} />
      <section className="ac-card">
        {rows.length === 0 ? (
          <Empty />
        ) : (
          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th scope="col">기사</th>
                  <th scope="col" className="is-num">처리 건수</th>
                  <th scope="col" className="is-num">매출</th>
                  <th scope="col" className="is-num">평점(후기 수)</th>
                  <th scope="col" className="is-num">불만 VOC</th>
                  <th scope="col" className="is-num">귀책 AS(AS율)</th>
                  <th scope="col" className="is-num">평균 작업시간(분)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.techId}>
                    <td>{r.name}</td>
                    <td className="is-num ac-num">{r.jobs.toLocaleString()}</td>
                    <td className="is-num ac-num">{won(r.sales)}</td>
                    <td className="is-num ac-num">
                      {r.ratingAvg ?? '-'} ({r.reviewCount})
                    </td>
                    <td className="is-num ac-num">{r.vocComplaints}</td>
                    <td className="is-num ac-num">
                      {r.asCount} ({pct(r.asRate)})
                    </td>
                    <td className="is-num ac-num">{r.avgWorkMinutes ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
