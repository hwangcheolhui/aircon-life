// T-HOM-010 기사 홈 (단계 4-1 기본: 주요 공지 · 오늘의 약속) · F-TEC-HOM-01·02
// 단계 4-2: 근무 시작/종료 토글 + 위치정보 수집 동의(F-TEC-AUTH-02). 단계 8: 주요 공지 3건(필독 우선)·팝업 공지·회신할 독촉 배지. 메모·자재·주간 할일·퀵메뉴는 단계 10.
import { Alert, Card, Empty, Tag } from '@aircon/ui';
import { techNotices } from '@/server/content';
import { techOpenFollowupCount } from '@/server/followups';
import { NoticePopup } from '@/tech/notice-popup';
import Link from 'next/link';
import { TechJobCard } from '@/tech/job-card';
import { TechTopbar } from '@/tech/topbar';
import { getDutyState } from '@/server/tech-duty';
import { todayAppointments } from '@/server/tech-jobs';
import { DutyToggle } from '@/tech/duty-toggle';
import { requireTech } from '@/server/tech-session';

export const metadata = { title: '홈' };

export default async function TechHomePage() {
  const me = await requireTech();
  const [today, duty, notices, openFollowups] = await Promise.all([todayAppointments(me.id), getDutyState(me.id), techNotices(me), techOpenFollowupCount(me.id)]);
  const popup = notices.find((n) => n.isPopup && !n.read);
  return (
    <main className="tec-page__body">
      <TechTopbar title={`${me.name} 기사님`} />
      <DutyToggle
        onDuty={duty.onDuty}
        since={duty.since}
        locationAgreed={duty.locationAgreed}
        intervalSec={duty.intervalSec}
      />
      {openFollowups > 0 ? (
        <Alert tone="warning">
          회신할 독촉·전달이 <strong className="ac-num">{openFollowups}</strong>건 있습니다. <Link href="/tech/notifications">확인하기</Link>
        </Alert>
      ) : null}
      {popup ? <NoticePopup notice={{ id: popup.id, title: popup.title, content: popup.content }} /> : null}
      <section className="tec-section" aria-labelledby="notice-title">
        <div className="tec-head-row">
          <h2 id="notice-title" className="ac-h3">
            주요 공지
          </h2>
          <Link href="/tech/notices" className="ac-btn ac-btn--text ac-btn--sm">
            더보기
          </Link>
        </div>
        <Card>
          {notices.length ? (
            <ul className="tec-notice-list">
              {notices.slice(0, 3).map((n) => (
                <li key={n.id}>
                  <Link href={`/tech/notices/${n.id}`}>
                    {n.required ? <Tag tone="danger">필독</Tag> : null}
                    {!n.read ? <Tag tone="primary">새 글</Tag> : null}
                    <span className="ac-body">{n.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>등록된 공지가 없습니다.</Empty>
          )}
        </Card>
      </section>
      <section className="tec-section" aria-labelledby="today-title">
        <div className="tec-head-row">
          <h2 id="today-title" className="ac-h3">
            오늘의 약속{' '}
            <span className="ac-num">
              {today.remaining}/{today.total}
            </span>
          </h2>
          <Link href="/tech/jobs" className="ac-btn ac-btn--text ac-btn--sm">
            더보기
          </Link>
        </div>
        {today.jobs.length ? (
          <ul className="tec-job-list">
            {today.jobs.map((j) => (
              <li key={j.orderNo}>
                <TechJobCard job={j} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>오늘 약속이 없습니다.</Empty>
        )}
      </section>
    </main>
  );
}
