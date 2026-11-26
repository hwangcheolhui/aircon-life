'use client';
// A-DSH-020 조회 월 선택
import { Input } from '@aircon/ui';
import { useRouter } from 'next/navigation';

export function MonthPicker({ month }: { month: string }) {
  const router = useRouter();
  return (
    <label className="ac-row">
      <span className="ac-body-sm">조회 월</span>
      <Input type="month" value={month} onChange={(e) => e.target.value && router.push(`/admin/dsh/kpi?month=${e.target.value}`)} />
    </label>
  );
}
