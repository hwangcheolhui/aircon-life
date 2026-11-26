'use client';
// A-STA-010 매출 통계: 검색 Enter = 조회, 금액 열 우측 정렬, [CSV 다운로드]
import { Button, Empty, Field, Input, Select } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf, won } from '@/admin/crud-screen';
import type { salesStats } from '@/server/ops';
import { Bars } from '../../dsh/bars';

type Data = Awaited<ReturnType<typeof salesStats>>;
type Q = { from: string; to: string; unit: string; dimension: string };
const UNITS = [
  { value: 'DAY', label: '일' },
  { value: 'WEEK', label: '주' },
  { value: 'MONTH', label: '월' },
];
const DIMS = [
  { value: 'BRANCH', label: '거점' },
  { value: 'PRODUCT', label: '상품' },
  { value: 'CHANNEL', label: '채널' },
  { value: 'CUSTOMER_TYPE', label: '고객 유형' },
];

export function SalesScreen({ data, query, codes, canExport }: { data: Data; query: Q; codes: Record<string, Option[]>; canExport: boolean }) {
  const router = useRouter();
  const [f, setF] = useState(query);
  const qs = new URLSearchParams(query).toString();
  const groupLabel = (l: string) => (query.dimension === 'CHANNEL' ? labelOf(codes.ORDER_CHANNEL, l) : query.dimension === 'CUSTOMER_TYPE' ? labelOf(codes.CUSTOMER_TYPE, l) : l);
  const seasonTotal = data.season.peak + data.season.off;
  return (
    <div className="ac-stack">
      <div className="adm-page-head">
        <h1 className="ac-h2">매출 통계</h1>
      </div>
      <form
        className="ac-search-panel"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/admin/sta/sales?${new URLSearchParams(f).toString()}`);
        }}
      >
        <Field label="기간(시작)">{(id) => <Input id={id} type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />}</Field>
        <Field label="기간(종료)">{(id) => <Input id={id} type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />}</Field>
        <Field label="단위">
          {(id) => (
            <Select id={id} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>
              {UNITS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="기준">
          {(id) => (
            <Select id={id} value={f.dimension} onChange={(e) => setF({ ...f, dimension: e.target.value })}>
              {DIMS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="ac-search-panel__actions">
          <Button type="submit" variant="primary" size="sm">
            조회
          </Button>
        </div>
      </form>
      <div className="adm-stat-grid">
        {[
          { label: '매출(완료)', value: won(data.total.revenue) },
          { label: '환불', value: won(data.total.refund) },
          { label: '순매출', value: won(data.total.net) },
          { label: '완료 건수', value: `${data.total.count.toLocaleString()}건` },
          { label: '성수기 비중(5~8월)', value: seasonTotal ? `${Math.round((data.season.peak / seasonTotal) * 1000) / 10}%` : '-' },
        ].map((c) => (
          <section key={c.label} className="ac-card adm-stat">
            <span className="adm-stat__label">{c.label}</span>
            <span className="adm-stat__value ac-num">{c.value}</span>
          </section>
        ))}
      </div>
      <section className="ac-card">
        <div className="adm-toolbar">
          <h2 className="ac-h3">기간별 매출</h2>
          {canExport ? (
            <a className="ac-btn ac-btn--sm ac-btn--outline" href={`/admin/sta/sales/export?${qs}`}>
              CSV 다운로드
            </a>
          ) : null}
        </div>
        {data.buckets.length === 0 ? (
          <Empty />
        ) : (
          <>
            {data.buckets.length <= 31 ? <Bars title="기간별 매출" items={data.buckets.map((b) => ({ label: b.key, value: b.revenue, display: won(b.revenue) }))} /> : null}
            <div className="ac-table-wrap adm-gap-top">
              <table className="ac-table">
                <thead>
                  <tr>
                    <th scope="col">기간</th>
                    <th scope="col" className="is-num">매출</th>
                    <th scope="col" className="is-num">건수</th>
                    <th scope="col" className="is-num">환불</th>
                    <th scope="col" className="is-num">순매출</th>
                  </tr>
                </thead>
                <tbody>
                  {data.buckets.map((b) => (
                    <tr key={b.key}>
                      <td className="ac-num">{b.key}</td>
                      <td className="is-num ac-num">{won(b.revenue)}</td>
                      <td className="is-num ac-num">{b.count.toLocaleString()}</td>
                      <td className="is-num ac-num">{won(b.refund)}</td>
                      <td className="is-num ac-num">{won(b.revenue - b.refund)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
      <section className="ac-card">
        <h2 className="ac-h3">{DIMS.find((d) => d.value === query.dimension)?.label}별 매출</h2>
        {data.groups.length === 0 ? (
          <Empty />
        ) : (
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">{DIMS.find((d) => d.value === query.dimension)?.label}</th>
                <th scope="col" className="is-num">매출</th>
                <th scope="col" className="is-num">{query.dimension === 'PRODUCT' ? '수량' : '건수'}</th>
                <th scope="col" className="is-num">비중</th>
              </tr>
            </thead>
            <tbody>
              {data.groups.map((g) => (
                <tr key={g.label}>
                  <td>{groupLabel(g.label)}</td>
                  <td className="is-num ac-num">{won(g.revenue)}</td>
                  <td className="is-num ac-num">{g.count.toLocaleString()}</td>
                  <td className="is-num ac-num">{data.total.revenue ? `${Math.round((g.revenue / data.total.revenue) * 1000) / 10}%` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
