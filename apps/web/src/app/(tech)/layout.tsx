// 기사 웹앱 루트 레이아웃 (T-*). 채널 밀도: data-channel="tech" (05 §0.3, 터치 48px)
// 토스트는 여기 하나만 둔다: 현장작업 플로우((flow))에서 저장 후 작업 상세((app))로 넘어가도 안내가 사라지지 않게
import { ToastProvider } from '@aircon/ui';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@aircon/ui/styles/tokens.css';
import '@aircon/ui/styles/components.css';
import '@/tech/tech.css';

export const metadata: Metadata = { title: '기사 앱', robots: { index: false } };

export default function TechLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" data-channel="tech">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
