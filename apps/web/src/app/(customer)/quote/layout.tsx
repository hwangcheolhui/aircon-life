// 고객 견적 스텝 플로우 공통 틀 (C-QUO-010~040): 하단 탭 없이 전체화면, 입력값은 브라우저에 임시 보관.
import { Alert } from '@aircon/ui';
import type { ReactNode } from 'react';
import { QuoteFlowProvider } from '@/customer/quote-flow';
import { isDbConfigured } from '@/server/db';
import '@/customer/customer.css';

export default function QuoteLayout({ children }: { children: ReactNode }) {
  return (
    <QuoteFlowProvider>
      <div className="cus-flow">
        {!isDbConfigured() ? (
          <div className="cus-flow__body" style={{ flex: 'none', paddingBottom: 0 }}>
            <Alert tone="warning">견적 서비스를 준비하고 있습니다. 지금은 견적을 받을 수 없습니다.</Alert>
          </div>
        ) : null}
        {children}
      </div>
    </QuoteFlowProvider>
  );
}
