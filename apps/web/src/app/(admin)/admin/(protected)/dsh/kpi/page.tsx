// A-DSH-020 KPI 대시보드 · F-ADM-DSH-02: ERD §5 KPI 카드(값·목표·달성 여부), 최근 6개월 매출 추이. 목표값은 system_setting KPI_TARGET_*
import { kstDate } from '@aircon/domain';
import { Tag } from '@aircon/ui';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { type KpiCard, kpiDashboard } from '@/server/ops';
import { Bars } from '../bars';
import { MonthPicker } from './month-picker';

const won = (n: number) => `${n.toLocaleString()}원`;
export const dynamic = 'force-dynamic';

const fmt = (v: number | null, unit: KpiCard['unit']) => (v === null ? '-' : unit === '원' ? won(v) : unit === '%' ? `${v}%` : `${v.toLocaleString()}건`);

export default async function KpiPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const admin = await requireScreen('A-DSH-020');
  const sp = await searchParams;
  const month = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : kstDate(new Date()).slice(0, 7);
  const d = await kpiDashboard(await currentBranchFilter(admin), month);
  return (
    <div className="ac-stack">
      <div className="adm-page-head">
        <h1 className="ac-h2">KPI 대시보드</h1>
        <MonthPicker month={month} />
      </div>
      <div className="adm-kpi-grid">
        {d.cards.map((c) => (
          <section key={c.key} className="ac-card adm-stat" aria-label={c.label}>
            <span className="adm-stat__label">{c.label}</span>
            <span className="adm-stat__value ac-num">{fmt(c.value, c.unit)}</span>
            <span className="adm-stat__meta">
              {c.target !== null ? (
                <>
                  목표 <span className="ac-num">{fmt(c.target, c.unit)}</span> {c.better === 'LOWER' ? '이하' : '이상'}{' '}
                  {c.state === 'MET' ? <Tag tone="success">달성</Tag> : c.state === 'BELOW' ? <Tag tone="danger">미달</Tag> : <Tag>집계 전</Tag>}
                </>
              ) : (
                '목표 없음'
              )}
            </span>
            {c.note ? <span className="adm-stat__meta">{c.note}</span> : null}
          </section>
        ))}
      </div>
      <section className="ac-card">
        <h2 className="ac-h3">최근 6개월 매출(완료 기준)</h2>
        <Bars title="최근 6개월 매출" items={d.trend.map((t) => ({ label: t.month, value: t.revenue, display: won(t.revenue) }))} />
        <table className="ac-table adm-gap-top">
          <thead>
            <tr>
              <th scope="col">월</th>
              <th scope="col" className="is-num">매출</th>
              <th scope="col" className="is-num">처리 건수</th>
            </tr>
          </thead>
          <tbody>
            {d.trend.map((t) => (
              <tr key={t.month}>
                <td className="ac-num">{t.month}</td>
                <td className="is-num ac-num">{won(t.revenue)}</td>
                <td className="is-num ac-num">{t.jobs.toLocaleString()}건</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
