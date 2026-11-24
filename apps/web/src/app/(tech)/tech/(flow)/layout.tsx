// 기사 앱 현장작업 풀스크린 스텝 플로우 틀 (03 §3.1: T-WRK 는 작업 상세에서 들어가는 풀스크린, 하단 탭 없음). 로그인 필요(F-TEC-AUTH-01)
// 근무 중이면 위치를 보낸다(F-TEC-MAP-05, BR-115). 진행 중 작업 배너는 스텝 머리말이 대신한다.
import type { ReactNode } from 'react';
import { getDutyState } from '@/server/tech-duty';
import { requireTech } from '@/server/tech-session';
import { LocationReporter } from '@/tech/location-reporter';

export const dynamic = 'force-dynamic';

export default async function TechFlowLayout({ children }: { children: ReactNode }) {
  const me = await requireTech();
  const duty = await getDutyState(me.id);
  return (
    <div className="tec-flow">
      {duty.onDuty && duty.locationAgreed ? <LocationReporter intervalSec={duty.intervalSec} /> : null}
      {children}
    </div>
  );
}
