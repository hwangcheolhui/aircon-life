'use client';
// C-DEV-010 기기 카드 목록 + [다시 예약] (F-CUS-DEV-02): 고른 기기(한 주소)를 이전 작업 범위로 견적 → 예약 화면
import { Alert, Button, Card, Empty, Tag } from '@aircon/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatDateLabel } from '@/customer/format';
import { rebook } from '../actions';

type Device = { id: number; name: string; brand: string; lastCleanedAt: string | null; lastCleanLevel: string | null; nextCleanDate: string | null; due: boolean };

export function DeviceList({ groups }: { groups: { id: number; title: string; devices: Device[] }[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<{ addressId: number; ids: number[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!groups.length) return <Empty>등록된 기기가 없어요. 청소를 마치면 자동으로 등록돼요.</Empty>;
  const toggle = (addressId: number, id: number) => {
    setError(null);
    setPicked((p) => {
      if (!p || p.addressId !== addressId) return { addressId, ids: [id] };
      const ids = p.ids.includes(id) ? p.ids.filter((x) => x !== id) : [...p.ids, id];
      return ids.length ? { addressId, ids } : null;
    });
  };
  const go = async () => {
    if (!picked) return;
    setBusy(true);
    const r = await rebook({ deviceIds: picked.ids });
    if (!r.ok) {
      setBusy(false);
      return setError(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '예약을 시작하지 못했어요.');
    }
    router.push(r.data!.path);
  };
  return (
    <>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {groups.map((g) => (
        <section key={g.id} className="ac-stack" aria-label={g.title}>
          <h2 className="ac-h3">{g.title}</h2>
          {g.devices.map((d) => {
            const on = picked?.addressId === g.id && picked.ids.includes(d.id);
            return (
              <Card key={d.id} className={on ? 'ac-card--selected' : undefined}>
                <div className="cus-device">
                  <label className="cus-device__head ac-body">
                    <input type="checkbox" checked={on} onChange={() => toggle(g.id, d.id)} aria-label={`${d.name} 다시 예약에 담기`} />
                    <strong>{d.name}</strong>
                    {d.due ? <Tag tone="warning">청소할 때예요</Tag> : null}
                  </label>
                  {d.brand ? <span className="ac-caption">{d.brand}</span> : null}
                  <span className="ac-body-sm">
                    최근 청소 <span className="ac-num">{d.lastCleanedAt ? formatDateLabel(d.lastCleanedAt) : '-'}</span>
                    {d.lastCleanLevel ? ` (${d.lastCleanLevel})` : ''} · 다음 권장 <span className="ac-num">{d.nextCleanDate ? formatDateLabel(d.nextCleanDate) : '-'}</span>
                  </span>
                  <Link href={`/my/devices/${d.id}`} className="ac-btn ac-btn--text ac-btn--sm">
                    수정
                  </Link>
                </div>
              </Card>
            );
          })}
        </section>
      ))}
      <Button variant="primary" size="lg" block disabled={!picked} loading={busy} onClick={go}>
        {picked ? `${picked.ids.length}대 다시 예약` : '다시 예약할 기기를 골라 주세요'}
      </Button>
    </>
  );
}
