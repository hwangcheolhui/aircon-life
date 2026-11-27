'use client';
// C-PAY-010 쿠폰 적용 (단계 9, F-CUS-PAY-04): 보유 쿠폰 중 조건을 채운 쿠폰만 고를 수 있다. 결제 전에만 바꿀 수 있다
import { Alert, Card, Select } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { chooseCoupon } from '@/app/(customer)/(tabs)/orders/actions';
import { formatWon } from './format';

export interface CouponChoices {
  editable: boolean;
  choices: { id: number; name: string; discount: number; reason: string | null; applied: boolean }[];
}

export function CouponPicker({ orderNo, data }: { orderNo: string; data: CouponChoices }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const applied = data.choices.find((c) => c.applied);
  if (!data.choices.length) return null;
  return (
    <Card>
      <label className="ac-label" htmlFor="coupon-select">
        쿠폰
      </label>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Select
        id="coupon-select"
        value={applied ? String(applied.id) : ''}
        disabled={!data.editable || pending}
        onChange={(e) =>
          start(async () => {
            setError(null);
            const r = await chooseCoupon({ orderNo, customerCouponId: e.target.value || null });
            if (!r.ok) setError(r.message ?? '쿠폰을 적용하지 못했어요.');
            router.refresh();
          })
        }
      >
        <option value="">쿠폰 쓰지 않기</option>
        {data.choices.map((c) => (
          <option key={c.id} value={c.id} disabled={Boolean(c.reason)}>
            {c.name} {c.reason ? `(${c.reason})` : `−${formatWon(c.discount)}`}
          </option>
        ))}
      </Select>
    </Card>
  );
}
