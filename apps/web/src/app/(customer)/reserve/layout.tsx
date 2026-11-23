// 고객 예약 스텝 플로우 공통 틀 (C-RSV-010~040, C-PAY-010): 하단 탭 없이 전체화면
import { Alert } from '@aircon/ui';
import type { ReactNode } from 'react';
import { isQuoteDemoMode } from '@/server/quote-demo';

export default function ReserveLayout({ children }: { children: ReactNode }) {
  return (
    <div className="cus-flow">
      {isQuoteDemoMode() ? (
        <div className="cus-flow__body" style={{ flex: 'none', paddingBottom: 0 }}>
          <Alert tone="warning">체험 모드입니다. 예시 일정으로 예약 흐름을 보여 드리며 예약·결제는 저장되지 않습니다.</Alert>
        </div>
      ) : null}
      {children}
    </div>
  );
}
