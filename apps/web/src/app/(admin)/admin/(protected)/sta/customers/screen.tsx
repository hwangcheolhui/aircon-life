'use client';
// A-STA-040 고객·CRM 통계: 기간 안 완료 고객의 신규·재방문, 캠페인별 전환율, 지역·주거유형 분포(건수 + 비율)
import { Empty } from '@aircon/ui';
import { type Option, labelOf } from '@/admin/crud-screen';
import type { customerStats } from '@/server/stats';
import { PeriodForm, pct } from '../period-form';

type Data = Awaited<ReturnType<typeof customerStats>>;

function Dist({ title, rows, label }: { title: string; rows: { key: string; count: number; rate: number | null }[]; label: (k: string) => string }) {
  return (
    <section className="ac-card">
      <h2 className="ac-h3">{title}</h2>
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <table className="ac-table">
          <thead>
            <tr>
              <th scope="col">구분</th>
              <th scope="col" className="is-num">고객 주문</th>
              <th scope="col" className="is-num">비율</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{label(r.key)}</td>
                <td className="is-num ac-num">{r.count.toLocaleString()}</td>
                <td className="is-num ac-num">{pct(r.rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function CustomerStatsScreen({ data, query, codes }: { data: Data; query: { from: string; to: string }; codes: Record<string, Option[]> }) {
  const s = data.split;
  return (
    <div className="ac-stack">
      <div className="adm-page-head">
        <h1 className="ac-h2">고객·CRM 통계</h1>
      </div>
      <PeriodForm path="/admin/sta/customers" from={query.from} to={query.to} />
      <div className="adm-stat-grid">
        {[
          { label: '완료 고객', value: `${s.total.toLocaleString()}명` },
          { label: '신규 고객', value: `${s.fresh.toLocaleString()}명` },
          { label: '재방문 고객', value: `${s.repeat.toLocaleString()}명` },
          { label: '재방문율', value: pct(s.repeatRate) },
          ...(data.signups !== null ? [{ label: '가입 고객', value: `${data.signups.toLocaleString()}명` }] : []),
        ].map((x) => (
          <section key={x.label} className="ac-card adm-stat">
            <span className="adm-stat__label">{x.label}</span>
            <span className="adm-stat__value ac-num">{x.value}</span>
          </section>
        ))}
      </div>
      <section className="ac-card">
        <h2 className="ac-h3">캠페인 전환율 (기간 안 발송)</h2>
        {data.campaigns.length === 0 ? (
          <Empty />
        ) : (
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">캠페인</th>
                <th scope="col">유형</th>
                <th scope="col" className="is-num">발송</th>
                <th scope="col" className="is-num">예약 전환</th>
                <th scope="col" className="is-num">전환율</th>
              </tr>
            </thead>
            <tbody>
              {data.campaigns.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{labelOf(codes.CAMPAIGN_TYPE, c.campaignType)}</td>
                  <td className="is-num ac-num">{c.sent.toLocaleString()}</td>
                  <td className="is-num ac-num">{c.converted.toLocaleString()}</td>
                  <td className="is-num ac-num">{pct(c.conversionRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <div className="adm-two-col">
        <Dist title="지역 분포 (상위 15)" rows={data.regions} label={(k) => (k === 'UNKNOWN' ? '모름' : k)} />
        <Dist title="주거 유형 분포" rows={data.housing} label={(k) => (k === 'UNKNOWN' ? '모름' : labelOf(codes.HOUSING_TYPE, k))} />
      </div>
    </div>
  );
}
