// 고객 로그인·가입 스텝 (C-AUTH-010~030): 하단 탭 없이 전체화면
import { Alert } from '@aircon/ui';
import type { ReactNode } from 'react';
import { isQuoteDemoMode } from '@/server/quote-demo';

export default function LoginLayout({ children }: { children: ReactNode }) {
  return (
    <div className="cus-flow">
      <main className="cus-flow__body">
        {isQuoteDemoMode() ? (
          <Alert tone="warning">체험 모드입니다. 인증만 흉내 내고 회원 정보는 저장하지 않습니다.</Alert>
        ) : null}
        {children}
      </main>
    </div>
  );
}
