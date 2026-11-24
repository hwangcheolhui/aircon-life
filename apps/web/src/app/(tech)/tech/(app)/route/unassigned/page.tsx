// T-RTE-020 관할 내 미배정 작업 · F-TEC-RTE-04: 관할 구역 지도 + 미배정 핀, 필터(날짜·기기), 담기 가능 여부, 삽입 위치·이동시간 증가 미리보기, [내 일정에 넣기]
// BR-110 내 관할(주·보조) 법정동의 배정 전(접수·배정대기) 주문만 보인다 · BR-111 보조 관할·2인 작업·설정에 따라 운영자 승인 필요.
import { kstDate } from '@aircon/domain';
import { loadCodes } from '@/server/codes';
import { listUnassignedInZone } from '@/server/self-assign';
import { requireTech } from '@/server/tech-session';
import { techZonesToday } from '@/server/zones';
import { TechTopbar } from '@/tech/topbar';
import { DateChips } from '@/tech/view-toggle';
import { UnassignedList } from './unassigned-list';

export const metadata = { title: '관할 내 미배정 작업' };

export default async function UnassignedPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; focus?: string }>;
}) {
  const me = await requireTech();
  const sp = await searchParams;
  const today = kstDate(new Date());
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') && sp.date! >= today ? sp.date! : today;
  const [items, zones, codes] = await Promise.all([
    listUnassignedInZone(me.id, { date, withInsertion: true }),
    techZonesToday(me.id, date),
    loadCodes(['DEVICE_TYPE']),
  ]);
  return (
    <main className="tec-page__body">
      <TechTopbar
        title="관할 내 미배정 작업"
        back={{ href: `/tech/map?date=${date}`, label: '출동 지도로' }}
      />
      <DateChips base="/tech/route/unassigned" date={date} />
      <UnassignedList
        key={date}
        date={date}
        items={items}
        zones={zones}
        deviceOptions={codes.DEVICE_TYPE ?? []}
        focus={sp.focus ?? null}
      />
    </main>
  );
}
