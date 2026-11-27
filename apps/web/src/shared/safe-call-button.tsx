'use client';
/**
 * 안심번호 전화 버튼 (단계 9, 02 §6 안심번호): 누를 때 주문 단위 가상번호를 받아 전화 앱을 연다.
 * 실제 번호는 서로 보이지 않는다. 고객(C-ORD-020)·기사(T-JOB-020)가 각자 서버 액션을 넘긴다.
 */
import { Button, useToast } from '@aircon/ui';
import { Phone } from 'lucide-react';
import { useState } from 'react';

type Result = { ok: true; data?: { number: string } } | { ok: false; message?: string };

export function SafeCallButton({ orderNo, label, action }: { orderNo: string; label: string; action: (orderNo: string) => Promise<Result> }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      size="lg"
      block
      loading={busy}
      onClick={async () => {
        setBusy(true);
        const r = await action(orderNo);
        setBusy(false);
        if (!r.ok || !r.data) return toast(r.ok ? '안심번호를 받지 못했어요.' : (r.message ?? '안심번호를 받지 못했어요.'));
        toast(`안심번호 ${r.data.number} 로 연결해요.`);
        window.location.href = `tel:${r.data.number.replace(/-/g, '')}`;
      }}
    >
      <Phone aria-hidden /> {label}
    </Button>
  );
}
