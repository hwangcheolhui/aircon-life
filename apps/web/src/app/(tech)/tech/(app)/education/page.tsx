// T-EDU-020 내 교육·등급 · F-TEC-EDU-02: 현재 등급·상태, 동행 실습 진행률, 수강 이력(출석률·실기·결과·수료증 번호), 등급 이력
import { Card, Empty, Tag } from '@aircon/ui';
import { loadCodes } from '@/server/codes';
import { techEducation } from '@/server/tech-support';
import { requireTech } from '@/server/tech-session';
import { TechTopbar } from '@/tech/topbar';

export const metadata = { title: '내 교육·등급' };
export const dynamic = 'force-dynamic';

const RESULT_TONE: Record<string, 'primary' | 'success' | 'warning' | 'danger' | undefined> = { ENROLLED: 'primary', PASSED: 'success', FAILED: 'danger', DROPPED: 'warning' };

export default async function TechEducationPage() {
  const me = await requireTech();
  const [e, codes] = await Promise.all([techEducation(me.id), loadCodes(['TECH_GRADE', 'TECH_STATUS', 'COURSE_TYPE', 'ENROLLMENT_RESULT'])]);
  const label = (g: string, v: string | null) => (v ? (codes[g]?.find((c) => c.value === v)?.label ?? v) : '–');
  const pct = e.accompany.required ? Math.round((e.accompany.done / e.accompany.required) * 100) : 100;
  return (
    <main className="tec-page__body">
      <TechTopbar title="내 교육·등급" back={{ href: '/tech/more', label: '더보기로' }} />
      <Card>
        <dl className="tec-kv">
          <dt>등급</dt>
          <dd>
            <strong>{label('TECH_GRADE', e.grade)}</strong>
          </dd>
          <dt>상태</dt>
          <dd>{label('TECH_STATUS', e.status)}</dd>
          <dt>입사일</dt>
          <dd className="ac-num">{e.joinedAt ?? '–'}</dd>
          <dt>동행 실습</dt>
          <dd>
            <span className="ac-num">
              {e.accompany.done}/{e.accompany.required}회 ({pct}%)
            </span>
            <div className="ac-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="동행 실습 진행률">
              <span style={{ width: `${pct}%` }} />
            </div>
          </dd>
        </dl>
      </Card>
      <section className="tec-section" aria-labelledby="enr-title">
        <h2 id="enr-title" className="ac-h3">
          수강 이력
        </h2>
        {e.enrollments.length ? (
          <ul className="tec-job-list">
            {e.enrollments.map((r) => (
              <li key={r.id} className={`tec-job-card${r.result === 'ENROLLED' ? '' : ' is-done'}`}>
                <div className="tec-job-card__top">
                  <Tag tone={RESULT_TONE[r.result]}>{label('ENROLLMENT_RESULT', r.result)}</Tag>
                  <span className="ac-body">{r.courseName}</span>
                  <span className="tec-job-card__time ac-caption">{label('COURSE_TYPE', r.courseType)}</span>
                </div>
                <span className="ac-body-sm ac-num">
                  {r.startDate ?? ''} ~ {r.endDate ?? ''}
                  {r.totalHours ? ` · ${r.totalHours}시간` : ''}
                </span>
                <span className="ac-body-sm ac-num">
                  출석률 {r.attendanceRate ?? '–'}% · 실기 {r.practicalScore ?? '–'}점
                  {r.certificateNo ? ` · 수료증 ${r.certificateNo}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>조회 결과가 없습니다.</Empty>
        )}
      </section>
      <section className="tec-section" aria-labelledby="grade-title">
        <h2 id="grade-title" className="ac-h3">
          등급 이력
        </h2>
        {e.grades.length ? (
          <ul className="ac-list">
            {e.grades.map((g) => (
              <li key={g.id} className="ac-list-item">
                <span className="ac-num ac-body-sm">{g.effectiveDate}</span>
                <span className="ac-list-item__body ac-body">
                  {label('TECH_GRADE', g.fromGrade)} → <strong>{label('TECH_GRADE', g.toGrade)}</strong>
                </span>
                {g.reason ? <span className="ac-caption">{g.reason}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>조회 결과가 없습니다.</Empty>
        )}
      </section>
    </main>
  );
}
