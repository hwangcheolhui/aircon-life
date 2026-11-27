// A-TEC-050 정착·이탈 분석 · F-ADM-TEC-07: 입사 월 코호트별 6개월 정착률(01_ERD §5: 6개월이 지난 기사 중 이탈하지 않은 비율), 이탈 사유 분포·평균 근속, 이탈 처리
import { Empty } from '@aircon/ui';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { screenFlags } from '@/server/crud';
import { retentionReport } from '@/server/training';
import { LeaveForm } from './leave-form';

export const dynamic = 'force-dynamic';

const pct = (v: number | null) => (v === null ? '-' : `${v}%`);

export default async function RetentionPage() {
  const admin = await requireScreen('A-TEC-050');
  const [r, codes] = await Promise.all([retentionReport(await currentBranchFilter(admin)), loadCodes(['LEAVE_REASON', 'TECH_STATUS'])]);
  const label = (g: string, v: string | null) => (v ? (codes[g]?.find((c) => c.value === v)?.label ?? v) : '미입력');
  const canUpdate = !admin.preview && screenFlags(admin, 'A-TEC-050').canUpdate;
  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">정착·이탈 분석</h1>
        <p className="ac-caption">기준일 {r.today} · 6개월 정착률 = 입사 후 6개월이 지난 기사 중 이탈하지 않은 비율</p>
      </div>
      <div className="adm-kpi-grid">
        <div className="ac-card">
          <p className="ac-caption">6개월 정착률(전체)</p>
          <p className="ac-h2 ac-num">{pct(r.retention.total.rate)}</p>
          <p className="ac-caption ac-num">
            정착 {r.retention.total.retained} / 대상 {r.retention.total.matured}명
          </p>
        </div>
        <div className="ac-card">
          <p className="ac-caption">재직(교육중·활동·휴직)</p>
          <p className="ac-h2 ac-num">{r.active.length}명</p>
        </div>
        <div className="ac-card">
          <p className="ac-caption">이탈</p>
          <p className="ac-h2 ac-num">{r.left.length}명</p>
        </div>
      </div>

      <section className="adm-section" aria-labelledby="cohort-title">
        <h2 id="cohort-title" className="ac-h3">
          입사 월 코호트
        </h2>
        {r.retention.cohorts.length ? (
          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th scope="col">입사 월</th>
                  <th scope="col" className="is-num">
                    입사
                  </th>
                  <th scope="col" className="is-num">
                    6개월 경과
                  </th>
                  <th scope="col" className="is-num">
                    정착
                  </th>
                  <th scope="col" className="is-num">
                    이탈
                  </th>
                  <th scope="col" className="is-num">
                    정착률
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.retention.cohorts.map((c) => (
                  <tr key={c.cohort}>
                    <td className="ac-num">{c.cohort}</td>
                    <td className="is-num ac-num">{c.joined}</td>
                    <td className="is-num ac-num">{c.matured}</td>
                    <td className="is-num ac-num">{c.retained}</td>
                    <td className="is-num ac-num">{c.left}</td>
                    <td className="is-num ac-num">{pct(c.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty />
        )}
      </section>

      <section className="adm-section" aria-labelledby="reason-title">
        <h2 id="reason-title" className="ac-h3">
          이탈 사유
        </h2>
        {r.reasons.length ? (
          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th scope="col">사유</th>
                  <th scope="col" className="is-num">
                    인원
                  </th>
                  <th scope="col" className="is-num">
                    비율
                  </th>
                  <th scope="col" className="is-num">
                    평균 근속(개월)
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.reasons.map((x) => (
                  <tr key={x.reason}>
                    <td>{label('LEAVE_REASON', x.reason === 'UNKNOWN' ? null : x.reason)}</td>
                    <td className="is-num ac-num">{x.count}</td>
                    <td className="is-num ac-num">{pct(x.share)}</td>
                    <td className="is-num ac-num">{x.avgTenureMonths ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty />
        )}
      </section>

      {canUpdate ? (
        <section className="adm-section" aria-labelledby="leave-title">
          <h2 id="leave-title" className="ac-h3">
            이탈 처리
          </h2>
          <LeaveForm techs={r.active.map((t) => ({ value: String(t.id), label: `${t.name} (${t.techCode}) · ${t.branchName}` }))} reasons={codes.LEAVE_REASON ?? []} today={r.today} />
        </section>
      ) : null}

      <section className="adm-section" aria-labelledby="left-title">
        <h2 id="left-title" className="ac-h3">
          이탈 기사
        </h2>
        {r.left.length ? (
          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th scope="col">기사</th>
                  <th scope="col">거점</th>
                  <th scope="col">입사일</th>
                  <th scope="col">이탈일</th>
                  <th scope="col">사유</th>
                </tr>
              </thead>
              <tbody>
                {r.left.map((t) => (
                  <tr key={t.id}>
                    <td>
                      {t.name} <span className="ac-caption ac-num">{t.techCode}</span>
                    </td>
                    <td>{t.branchName}</td>
                    <td className="ac-num">{t.joinedAt ?? ''}</td>
                    <td className="ac-num">{t.leftAt ?? ''}</td>
                    <td>{label('LEAVE_REASON', t.leaveReason)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty />
        )}
      </section>
    </div>
  );
}
