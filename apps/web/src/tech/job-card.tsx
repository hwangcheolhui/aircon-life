// 기사 작업 카드 (T-JOB-010 · T-HOM-010 오늘의 약속): 상태 배지 좌상단, 시간·고객(마스킹)·주소·기기·경과시간. 처리완료는 배경색 구분
import { StatusBadge, Tag } from '@aircon/ui';
import Link from 'next/link';
import type { TechJob } from '@/server/tech-jobs';

const ROLE: Record<string, string> = { SUPPORT: '지원', ACCOMPANY: '동행' };

export function timeLabel(at: Date | null, timeTo: string | null) {
  if (!at) return '시간 미정';
  const from = at.toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
  return timeTo ? `${from}~${timeTo}` : from;
}

export function TechJobCard({ job: j, showDate }: { job: TechJob; showDate?: boolean }) {
  const done = j.tab === 'DONE';
  return (
    <Link href={`/tech/jobs/${j.orderNo}`} className={`tec-job-card${done ? ' is-done' : ''}`}>
      <div className="tec-job-card__top">
        <StatusBadge code={j.status} audience="staff" />
        {ROLE[j.role] ? <Tag>{ROLE[j.role]}</Tag> : null}
        {j.transferRequested ? <Tag tone="warning">이관 요청 중</Tag> : null}
        <span className="tec-job-card__time ac-num">
          {showDate && j.date ? `${j.date.slice(5).replace('-', '/')} ` : ''}
          {timeLabel(j.promisedAt, j.timeTo)}
        </span>
      </div>
      <span className="ac-body-lg">
        <span className="ac-masked">{j.customerName}</span> · {j.address}
      </span>
      <span className="ac-body-sm ac-caption">
        {j.devices.map((d) => `${d.name} ${d.quantity}대`).join(', ') || '기기 정보 없음'}
        {j.elapsedMin ? <span className="tec-elapsed"> · 약속 후 {j.elapsedMin}분 경과</span> : null}
      </span>
    </Link>
  );
}
