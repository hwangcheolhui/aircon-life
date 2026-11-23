// 기사 앱 하단 탭 화면 틀 (T-HOM-010 · T-JOB-010·020 · T-MY-010 · T-NTF-010 · T-MORE-010). 로그인 필요(F-TEC-AUTH-01)
import { ToastProvider } from '@aircon/ui';
import type { ReactNode } from 'react';
import { requireTech } from '@/server/tech-session';
import { TechTabbar } from '@/tech/tabbar';

export const dynamic = 'force-dynamic';

export default async function TechAppLayout({ children }: { children: ReactNode }) {
  await requireTech();
  return (
    <ToastProvider>
      <div className="tec-shell">
        {children}
        <TechTabbar />
      </div>
    </ToastProvider>
  );
}
