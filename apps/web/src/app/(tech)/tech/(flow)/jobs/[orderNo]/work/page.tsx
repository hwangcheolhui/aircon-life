// T-WRK-010 출발·도착 · F-TEC-WRK-01(출발 → 고객 "기사 출발" 알림·도착 예정, 확정 코스의 다음 방문지 기준) · F-TEC-WRK-02(도착)
import { Card, StatusBadge } from '@aircon/ui';
import { formatVisit } from '@/customer/format';
import { getTechJob } from '@/server/tech-jobs';
import { MoveStep } from '@/tech/work/work-forms';
import { WorkSteps } from '@/tech/work/work-steps';
import { loadStep } from './load';

export const metadata = { title: '출발·도착' };

export default async function WorkMovePage({ params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await params;
  const { me, s } = await loadStep(orderNo, 'move');
  const j = (await getTechJob(me.id, orderNo))!;
  return (
    <main className="tec-page__body">
      <WorkSteps orderNo={orderNo} current="move" title="출발·도착" />
      <Card>
        <div className="tec-job-card__top">
          <StatusBadge code={s.orderStatus} audience="staff" />
        </div>
        <p className="ac-h3 ac-num">{s.promisedAt ? formatVisit(s.promisedAt) : '일정 미정'}</p>
        <dl className="tec-kv ac-body">
          <dt>고객</dt>
          <dd>
            <span className="ac-masked">{j.customerName}</span>
          </dd>
          <dt>주소</dt>
          <dd>{j.roadAddress}</dd>
          <dt>기기</dt>
          <dd>{j.devices.map((d) => `${d.name} ${d.quantity}대`).join(', ') || '기기 정보 없음'}</dd>
        </dl>
      </Card>
      <MoveStep orderNo={orderNo} status={s.work?.status ?? null} roadAddress={j.roadAddress} canAct={s.role === 'MAIN'} />
    </main>
  );
}
