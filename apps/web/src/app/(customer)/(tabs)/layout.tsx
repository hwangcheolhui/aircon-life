// 고객 하단 탭 화면 틀 (C-HOM-010 · C-ORD-010·020 · C-MY-010·030·040 · C-NTF-010 · C-CS-010)
import type { ReactNode } from 'react';
import { CustomerTabbar } from '@/customer/tabbar';

export default function TabsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="cus-shell">
      {children}
      <CustomerTabbar />
    </div>
  );
}
