// T-HOM-010 기사 홈 (단계 4-1 기본: 주요 공지 · 오늘의 약속) · F-TEC-HOM-01·02
// 단계 4-2: 근무 시작/종료 토글 + 위치정보 수집 동의(F-TEC-AUTH-02). 단계 8: 주요 공지 3건(필독 우선)·팝업 공지·회신할 독촉 배지.
// 단계 10: 퀵메뉴 슬라이드(F-TEC-HOM-04) · 오늘의 메모 n/m + T-MEMO-020 팝업(F-TEC-HOM-02) · 오늘의 자재 ·
//          주간 할일 D-day~D+2(F-TEC-HOM-03) · 이번 달 VOC·NPS·평점·완료 배지(F-TEC-HOM-05)
import { kstDate, techQuickMenuOf } from '@aircon/domain';
import { Alert, Card, Empty, Tag } from '@aircon/ui';
import { Package } from 'lucide-react';
import { loadCodes } from '@/server/codes';
import { techMemosOn } from '@/server/tech-memos';
import { getQuickMenu, techHomeTodo, techMonthBadges } from '@/server/tech-support';
import { TodayMemos } from '@/tech/today-memos';
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
  const now = new Date();
  const [today, duty, notices, openFollowups, todo, badges, quick, memos, codes] = await Promise.all([
    todayAppointments(me.id),
    getDutyState(me.id),
    techNotices(me),
    techOpenFollowupCount(me.id),
    techHomeTodo(me, now),
    techMonthBadges(me.id, now),
    getQuickMenu(me.id),
    techMemosOn(me, kstDate(now)),
    loadCodes(['MEMO_HEADER', 'MEMO_PRIORITY_SOURCE']),
  ]);
  const label = (g: string, v: string | null) => (v ? (codes[g]?.find((c) => c.value === v)?.label ?? v) : null);
  const popup = notices.find((n) => n.isPopup && !n.read);
  const memoPopup = memos.some((m) => !m.mine && m.popupEnabled && !m.readAt);
  const quickMenus = quick.map(techQuickMenuOf).filter((m): m is NonNullable<typeof m> => Boolean(m));
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
      {popup && !memoPopup ? <NoticePopup notice={{ id: popup.id, title: popup.title, content: popup.content }} /> : null}
      <nav className="tec-quick" aria-label="퀵메뉴">
        {quickMenus.map((m) => (
          <Link key={m.code} href={m.href} className="ac-chip">
            {m.name}
          </Link>
        ))}
        <Link href="/tech/my/quick-menu" className="ac-chip">
          {quickMenus.length ? '편집' : '+ 퀵메뉴 추가'}
        </Link>
      </nav>
      <section className="tec-section" aria-label="오늘 할 일">
        <div className="tec-todo-row">
          <TodayMemos
            autoOpen={memoPopup}
            memos={memos.map((m) => ({
              id: m.id,
              header: label('MEMO_HEADER', m.headerCode),
              content: m.content,
              source: label('MEMO_PRIORITY_SOURCE', m.prioritySource) ?? '',
              sourceCode: m.prioritySource,
              mine: m.mine,
              isDone: m.isDone,
              read: Boolean(m.readAt),
              authorName: m.authorName,
              relatedOrderNo: m.relatedOrderNo,
            }))}
          />
          <Link href="/tech/materials/requests" className="tec-todo-card">
            <Package aria-hidden />
            <span className="ac-body">오늘의 자재</span>
            <strong className="ac-num">{todo.todayMaterials.length}</strong>
          </Link>
        </div>
        <Card>
          <h2 className="ac-h3">주간 할일</h2>
          <table className="ac-table tec-weekly">
            <thead>
              <tr>
                <th scope="col">
                  <span className="ac-sr-only">항목</span>
                </th>
                {todo.weekly.map((d) => (
                  <th key={d.date} scope="col">
                    <Link href={`/tech/calendar?month=${d.date.slice(0, 7)}&date=${d.date}`}>{d.label}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['memo', '메모'],
                  ['material', '자재'],
                  ['job', '약속'],
                ] as const
              ).map(([k, name]) => (
                <tr key={k}>
                  <th scope="row">{name}</th>
                  {todo.weekly.map((d) => (
                    <td key={d.date} className="is-num ac-num">
                      {d[k]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <dl className="tec-badges" aria-label={`${Number(badges.month.slice(5))}월 내 지표`}>
          <div>
            <dt>VOC</dt>
            <dd className="ac-num">{badges.vocCount}건</dd>
          </div>
          <div>
            <dt>NPS</dt>
            <dd className="ac-num">{badges.nps === null ? '–' : badges.nps}</dd>
          </div>
          <div>
            <dt>평점</dt>
            <dd className="ac-num">{badges.rating === null ? '–' : badges.rating.toFixed(1)}</dd>
          </div>
          <div>
            <dt>완료</dt>
            <dd className="ac-num">{badges.completed}건</dd>
          </div>
        </dl>
      </section>
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
