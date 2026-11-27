// T-RTE-010 일자별 코스 편집 · F-TEC-RTE-01(순서 변경·고정·휴식/자재 지점, 변경 즉시 도착 예정 재계산)
// F-TEC-RTE-02(최적 코스 추천: 전/후 비교) · F-TEC-RTE-03(코스 확정 → 고객 방문 예정 시간 안내, BR-112 시간창 위반 시 확정 불가, BR-113 마감 18:00 자동 확정)
// 마감이 지난 미확정 코스는 이 화면을 열 때도 자동 확정된다(Vercel Hobby Cron 지연 대비).
import { SETTING_KEYS, kstDate } from '@aircon/domain';
import { Empty } from '@aircon/ui';
import Link from 'next/link';
import { getRouteView } from '@/server/route-plans';
import { getSettingNumber } from '@/server/settings';
import { requireTech } from '@/server/tech-session';
import { TechTopbar } from '@/tech/topbar';
import { DateChips } from '@/tech/view-toggle';
import { RouteEditor } from './route-editor';

export const metadata = { title: '코스 편집' };

export default async function TechRoutePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const me = await requireTech();
  const sp = await searchParams;
  const today = kstDate(new Date());
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') && sp.date! >= today ? sp.date! : today;
  const [view, delayAlertMin] = await Promise.all([getRouteView(me.id, date), getSettingNumber(SETTING_KEYS.ETA_DELAY_ALERT_MIN)]);
  return (
    <main className="tec-page__body">
      <TechTopbar title="코스 편집" back={{ href: `/tech/map?date=${date}`, label: '출동 지도로' }} />
      <div className="tec-head-row">
        <DateChips base="/tech/route" date={date} />
        <Link href={`/tech/route/week?start=${date}`} className="ac-btn ac-btn--text ac-btn--sm">
          주간 일정
        </Link>
      </div>
      {view ? (
        <RouteEditor key={`${date}-${view.planId}-${view.version}-${view.status}`} initial={view} delayAlertMin={delayAlertMin} />
      ) : (
        <Empty>이 날짜에 배정된 작업이 없습니다.</Empty>
      )}
    </main>
  );
}
