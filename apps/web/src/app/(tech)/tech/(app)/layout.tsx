// 기사 앱 하단 탭 화면 틀 (T-HOM-010 · T-JOB-010·020 · T-MAP-010 · T-RTE-010·020 · T-MY-010 · T-NTF-010 · T-MORE-010). 로그인 필요(F-TEC-AUTH-01)
// 근무 중이면 어느 화면에서든 위치를 보낸다(F-TEC-MAP-05, BR-115).
import { ToastProvider } from '@aircon/ui';
import type { ReactNode } from 'react';
import { getDutyState } from '@/server/tech-duty';
import { requireTech } from '@/server/tech-session';
import { LocationReporter } from '@/tech/location-reporter';
import { TechTabbar } from '@/tech/tabbar';

export const dynamic = 'force-dynamic';

export default async function TechAppLayout({ children }: { children: ReactNode }) {
  const me = await requireTech();
  const duty = await getDutyState(me.id);
  return (
    <ToastProvider>
      <div className="tec-shell">
        {duty.onDuty && duty.locationAgreed ? <LocationReporter intervalSec={duty.intervalSec} /> : null}
        {children}
        <TechTabbar />
      </div>
    </ToastProvider>
  );
}
