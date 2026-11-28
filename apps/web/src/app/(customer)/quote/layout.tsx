// 고객 견적 스텝 플로우 공통 틀 (C-QUO-010~040): 하단 탭 없이 전체화면, 입력값은 브라우저에 임시 보관.
import { Alert } from '@aircon/ui';
import type { ReactNode } from 'react';
import { QuoteFlowProvider } from '@/customer/quote-flow';
import { isQuoteDemoMode } from '@/server/quote-demo';

/**
 * 체험 모드 안내는 실행 중인 서버의 DATABASE_URL 로 판단해야 한다.
 * 정적 생성하면 빌드 시점 값(Vercel 빌드에서는 비어 있을 수 있음)으로 굳어 DB가 연결돼 있어도 체험 모드로 보인다.
 */
export const dynamic = 'force-dynamic';

export default function QuoteLayout({ children }: { children: ReactNode }) {
  return (
    <QuoteFlowProvider>
      <div className="cus-flow">
        {isQuoteDemoMode() ? (
          <div className="cus-flow__body" style={{ flex: 'none', paddingBottom: 0 }}>
            <Alert tone="warning">
              체험 모드입니다. 지정된 예시 지역 주소만 다음 단계로 넘어가고, 예시 가격으로 계산하며 견적은
              저장되지 않습니다.
            </Alert>
          </div>
        ) : null}
        {children}
      </div>
    </QuoteFlowProvider>
  );
}
