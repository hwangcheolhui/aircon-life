// 관리자 웹 루트 레이아웃 (A-*). 채널 밀도: data-channel="admin" (05 §0.3, 1440px 기준)
import { ToastProvider } from '@aircon/ui';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@aircon/ui/styles/tokens.css';
import '@aircon/ui/styles/components.css';
import '@/admin/admin.css';

export const metadata: Metadata = { title: '관리자', robots: { index: false, follow: false } };

export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" data-channel="admin">
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
