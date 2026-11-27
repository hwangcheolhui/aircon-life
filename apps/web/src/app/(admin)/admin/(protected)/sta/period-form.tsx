'use client';
// 통계 화면 공통 기간 검색 (Enter = 조회)
import { Button, Field, Input } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function PeriodForm({ path, from, to }: { path: string; from: string; to: string }) {
  const router = useRouter();
  const [f, setF] = useState({ from, to });
  return (
    <form
      className="ac-search-panel"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(`${path}?${new URLSearchParams(f).toString()}`);
      }}
    >
      <Field label="기간(시작)">{(id) => <Input id={id} type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />}</Field>
      <Field label="기간(종료)">{(id) => <Input id={id} type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />}</Field>
      <div className="ac-search-panel__actions">
        <Button type="submit" variant="primary" size="sm">
          조회
        </Button>
      </div>
    </form>
  );
}

/** 비율 표시 (null = "-") */
export const pct = (v: number | null) => (v === null ? '-' : `${v}%`);
