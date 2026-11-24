// T-JOB-020 작업 상세 · F-TEC-JOB-02(고객·주소·기기·요청·전달사항·과거 이력·길찾기·전화) · F-TEC-JOB-05(이관 요청)
// 단계 5-1: [작업 시작/이어서] → 현장작업 스텝(T-WRK-010~060), 활동내역(T-WRK-070, F-TEC-WRK-09).
// 단계 6: 작업완료면 [결제 받기](T-PAY-010), 완료면 결제 내역·현금영수증.
// 단계 5-2: [미처리 저장](T-WRK-061, 출발 전에도) · 미처리 사유·장기 미처리 표시(BR-031·032). 안심번호는 단계 9. 연락처·상세주소는 [보기]를 눌러야 보이고 감사 로그를 남긴다(BR-100).
import { Alert, Card, Empty, StatusBadge, Tag } from '@aircon/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDateTime, formatVisit } from '@/customer/format';
import { loadCodes } from '@/server/codes';
import { getTechJob } from '@/server/tech-jobs';
import { requireTech } from '@/server/tech-session';
import { timeLabel } from '@/tech/job-card';
import { TechTopbar } from '@/tech/topbar';
import { ActivitySheetButton } from '@/tech/work/activity';
import { listActivities, workSummary } from '@/server/work';
import { kstDate } from '@aircon/domain';
import { ContactReveal, TransferRequest } from './job-actions';

export const metadata = { title: '작업 상세' };

export default async function TechJobPage({ params }: { params: Promise<{ orderNo: string }> }) {
  const me = await requireTech();
  const { orderNo } = await params;
  const j = await getTechJob(me.id, orderNo);
  if (!j) notFound();
  const [codes, work, activities] = await Promise.all([
    loadCodes(['ASSIGN_ROLE', 'HOUSING_TYPE', 'ORDER_TYPE', 'ACTIVITY_TYPE', 'WORK_STATUS', 'PENDING_REASON']),
    workSummary(j.orderId),
    listActivities(j.orderId),
  ]);
  const workOpen = work && ['ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS'].includes(work.status);
  const canStart = j.status === 'ASSIGNED' && j.role === 'MAIN' && j.promisedAt !== null && kstDate(j.promisedAt) === kstDate(new Date());
  const label = (g: string, v: string | null) =>
    v ? (codes[g]?.find((c) => c.value === v)?.label ?? v) : '';
  return (
    <main className="tec-page__body">
      <TechTopbar title="작업 상세" back={{ href: '/tech/jobs', label: '작업 목록' }} />
      <section className="tec-section">
        <div className="tec-job-card__top">
          <StatusBadge code={j.status} audience="staff" />
          <Tag>{label('ASSIGN_ROLE', j.role)}</Tag>
          {j.orderType === 'URGENT' ? <Tag tone="danger">긴급</Tag> : null}
          <span className="ac-caption ac-num">{j.orderNo}</span>
        </div>
        <p className="ac-h2 ac-num">
          {j.promisedAt ? formatVisit(j.promisedAt) : '일정 미정'}{' '}
          <span className="ac-body ac-caption">({timeLabel(j.promisedAt, j.timeTo)})</span>
        </p>
        {j.status === 'PENDING' && work?.pendingCode ? (
          <Alert tone="warning">
            미처리: {label('PENDING_REASON', work.pendingCode)}. 재약속은 운영자가 정합니다.
          </Alert>
        ) : null}
        {j.transferRequested ? (
          <Alert tone="warning">
            이관을 요청했습니다. 운영자가 확인하기 전까지는 예정대로 방문해 주세요. 사유: {j.transferReason}
          </Alert>
        ) : null}
      </section>

      <Card>
        <dl className="tec-kv ac-body">
          <dt>고객</dt>
          <dd>
            <span className="ac-masked">{j.customerName}</span>
          </dd>
          <dt>주소</dt>
          <dd>{j.roadAddress}</dd>
          {j.housingType ? (
            <>
              <dt>주거 형태</dt>
              <dd>
                {label('HOUSING_TYPE', j.housingType)}
                {j.hasElevator === false ? ' · 엘리베이터 없음' : ''}
              </dd>
            </>
          ) : null}
          {j.parkingNote ? (
            <>
              <dt>주차</dt>
              <dd>{j.parkingNote}</dd>
            </>
          ) : null}
          <dt>기기</dt>
          <dd>{j.devices.map((d) => `${d.name} ${d.quantity}대`).join(', ') || '기기 정보 없음'}</dd>
          {j.requiredTechCount > 1 ? (
            <>
              <dt>함께 가는 기사</dt>
              <dd>
                {j.team.map((t) => `${t.name}(${label('ASSIGN_ROLE', t.role)})`).join(', ') || '지정 전'}
              </dd>
            </>
          ) : null}
        </dl>
        <ContactReveal orderNo={j.orderNo} phoneMasked={j.phoneMasked} roadAddress={j.roadAddress} />
      </Card>

      <section className="tec-section" aria-labelledby="req-title">
        <h2 id="req-title" className="ac-h3">
          요청사항 · 전달사항
        </h2>
        <Card>
          <dl className="tec-kv ac-body">
            <dt>고객 요청</dt>
            <dd className="tec-note">{j.customerRequest || '없음'}</dd>
            <dt>내부 전달</dt>
            <dd className="tec-note">{j.internalNote || '없음'}</dd>
          </dl>
        </Card>
      </section>

      <section className="tec-section" aria-labelledby="past-title">
        <h2 id="past-title" className="ac-h3">
          이 고객의 지난 작업
        </h2>
        {j.past.length ? (
          <ul className="ac-list">
            {j.past.map((p) => (
              <li key={p.orderNo} className="ac-list-item">
                <div className="ac-list-item__body">
                  <span className="ac-body ac-num">
                    {p.promisedAt ? formatDateTime(p.promisedAt).slice(0, 10) : '일정 없음'}
                  </span>
                  <span className="ac-caption">
                    {' '}
                    · {p.devices.map((d) => `${d.name} ${d.quantity}대`).join(', ')}
                  </span>
                </div>
                <StatusBadge code={p.status} audience="staff" />
              </li>
            ))}
          </ul>
        ) : (
          <Empty />
        )}
      </section>

      <section className="tec-section" aria-labelledby="hist-title">
        <h2 id="hist-title" className="ac-h3">
          진행 이력
        </h2>
        <ol className="ac-timeline">
          {j.history.map((h, i) => (
            <li key={h.id} className={i === j.history.length - 1 ? 'is-current' : 'is-done'}>
              <strong>
                <StatusBadge code={h.toStatus} audience="staff" />
              </strong>
              <span className="ac-caption ac-num">{formatDateTime(h.createdAt)}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="tec-section" aria-labelledby="act-title">
        <h2 id="act-title" className="ac-h3">
          활동내역
        </h2>
        {activities.length ? (
          <ul className="ac-list">
            {activities.map((a) => (
              <li key={a.id} className="ac-list-item">
                <div className="ac-list-item__body">
                  <Tag>{label('ACTIVITY_TYPE', a.activityType)}</Tag> <span className="ac-body">{a.content}</span>
                  <p className="ac-caption ac-num">
                    {formatDateTime(a.createdAt)}
                    {a.techName ? ` · ${a.techName}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty />
        )}
        <ActivitySheetButton orderNo={j.orderNo} types={(codes.ACTIVITY_TYPE ?? []).filter((c) => ['CALL', 'SMS', 'VISIT_TRY', 'NOTE'].includes(c.value))} />
      </section>

      {workOpen ? (
        <Link href={`/tech/jobs/${j.orderNo}/work`} className="ac-btn ac-btn--primary ac-btn--xl ac-btn--block">
          현장작업 이어서 ({label('WORK_STATUS', work!.status)})
        </Link>
      ) : canStart ? (
        <Link href={`/tech/jobs/${j.orderNo}/work`} className="ac-btn ac-btn--primary ac-btn--xl ac-btn--block">
          작업 시작 (출발)
        </Link>
      ) : j.role === 'MAIN' && j.status === 'WORK_DONE' ? (
        <Link href={`/tech/jobs/${j.orderNo}/pay`} className="ac-btn ac-btn--primary ac-btn--xl ac-btn--block">
          결제 받기 (현장 결제)
        </Link>
      ) : j.role === 'MAIN' && j.status === 'COMPLETED' ? (
        <Link href={`/tech/jobs/${j.orderNo}/pay`} className="ac-btn ac-btn--outline ac-btn--lg ac-btn--block">
          결제 내역·현금영수증
        </Link>
      ) : null}
      {j.role === 'MAIN' && ['ASSIGNED', 'ON_THE_WAY', 'IN_PROGRESS'].includes(j.status) ? (
        <Link href={`/tech/jobs/${j.orderNo}/work/pending`} className="ac-btn ac-btn--outline ac-btn--lg ac-btn--block">
          미처리 저장 (고객부재·연기 등)
        </Link>
      ) : null}
      {j.status === 'ASSIGNED' && !j.transferRequested ? <TransferRequest orderNo={j.orderNo} /> : null}
      {j.branchPhone ? (
        <a href={`tel:${j.branchPhone}`} className="ac-btn ac-btn--ghost ac-btn--block">
          {j.branchName} 거점 전화 <span className="ac-num">{j.branchPhone}</span>
        </a>
      ) : null}
    </main>
  );
}
