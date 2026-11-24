// T-MAP-010 출동 지도 · F-TEC-MAP-01(날짜별 출동지 핀·번호) · F-TEC-MAP-02(관할 구역 경계) · F-TEC-MAP-03(관할 내 미배정 핀, BR-110)
// F-TEC-MAP-04(핀 미리보기·길찾기·전화) · F-TEC-MAP-05(근무 중 내 위치, BR-115). [코스 짜기] → T-RTE-010.
import { kstDate } from '@aircon/domain';
import { getRouteView } from '@/server/route-plans';
import { listUnassignedInZone } from '@/server/self-assign';
import { myLatestLocation } from '@/server/tech-duty';
import { requireTech } from '@/server/tech-session';
import { techZonesToday } from '@/server/zones';
import { TechTopbar } from '@/tech/topbar';
import { DateChips, JobViewToggle } from '@/tech/view-toggle';
import { TechMapView } from './map-view';

export const metadata = { title: '출동 지도' };

export default async function TechMapPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const me = await requireTech();
  const sp = await searchParams;
  const today = kstDate(new Date());
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') && sp.date! >= today ? sp.date! : today;
  const [zones, route, unassigned, myLoc] = await Promise.all([
    techZonesToday(me.id, date),
    getRouteView(me.id, date),
    listUnassignedInZone(me.id, { date }),
    date === today ? myLatestLocation(me.id) : Promise.resolve(null),
  ]);
  return (
    <main className="tec-page__body">
      <TechTopbar title="작업" />
      <JobViewToggle view="map" date={date} />
      <DateChips base="/tech/map" date={date} />
      <TechMapView date={date} zones={zones} route={route} unassigned={unassigned} myLoc={myLoc} />
    </main>
  );
}
