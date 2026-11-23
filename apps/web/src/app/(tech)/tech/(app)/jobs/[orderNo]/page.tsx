// T-JOB-020 작업 상세 · F-TEC-JOB-02(고객·주소·기기·요청·전달사항·과거 이력·길찾기·전화) · F-TEC-JOB-05(이관 요청)
// [작업 시작]은 단계 5 현장작업, 안심번호는 단계 9. 연락처·상세주소는 [보기]를 눌러야 보이고 감사 로그를 남긴다(BR-100).
import { Alert, Card, Empty, StatusBadge, Tag } from '@aircon/ui';
import { notFound } from 'next/navigation';
import { formatDateTime, formatVisit } from '@/customer/format';
import { loadCodes } from '@/server/codes';
import { getTechJob } from '@/server/tech-jobs';
import { requireTech } from '@/server/tech-session';
import { timeLabel } from '@/tech/job-card';
import { TechTopbar } from '@/tech/topbar';
import { ContactReveal, TransferRequest } from './job-actions';

export const metadata = { title: '작업 상세' };

export default async function TechJobPage({ params }: { params: Promise<{ orderNo: string }> }) {
  const me = await requireTech();
  const { orderNo } = await params;
  const j = await getTechJob(me.id, orderNo);
  if (!j) notFound();
  const codes = await loadCodes(['ASSIGN_ROLE', 'HOUSING_TYPE', 'ORDER_TYPE']);
  const label = (g: string, v: string | null) => (v ? (codes[g]?.find((c) => c.value === v)?.label ?? v) : '');
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
          {j.promisedAt ? formatVisit(j.promisedAt) : '일정 미정'} <span className="ac-body ac-caption">({timeLabel(j.promisedAt, j.timeTo)})</span>
        </p>
        {j.transferRequested ? <Alert tone="warning">이관을 요청했습니다. 운영자가 확인하기 전까지는 예정대로 방문해 주세요. 사유: {j.transferReason}</Alert> : null}
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
              <dd>{j.team.map((t) => `${t.name}(${label('ASSIGN_ROLE', t.role)})`).join(', ') || '지정 전'}</dd>
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
                  <span className="ac-body ac-num">{p.promisedAt ? formatDateTime(p.promisedAt).slice(0, 10) : '일정 없음'}</span>
                  <span className="ac-caption"> · {p.devices.map((d) => `${d.name} ${d.quantity}대`).join(', ')}</span>
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

      {j.status === 'ASSIGNED' && !j.transferRequested ? <TransferRequest orderNo={j.orderNo} /> : null}
      {j.branchPhone ? (
        <a href={`tel:${j.branchPhone}`} className="ac-btn ac-btn--ghost ac-btn--block">
          {j.branchName} 거점 전화 <span className="ac-num">{j.branchPhone}</span>
        </a>
      ) : null}
    </main>
  );
}
