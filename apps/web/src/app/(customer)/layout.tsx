// 고객 웹 루트 레이아웃 (C-*). 채널 밀도: data-channel="customer" (05 §0.3)
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@aircon/ui/styles/tokens.css';
import '@aircon/ui/styles/components.css';
import '@/customer/customer.css';

export const metadata: Metadata = { title: '에어컨 청소' };

export default function CustomerLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" data-channel="customer">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
