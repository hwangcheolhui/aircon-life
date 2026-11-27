// C-DEV-010 내 기기 (단계 9) · F-CUS-DEV-01·02: 주소별 기기 카드, 최근/다음 청소일, 기기를 골라 [다시 예약]
import { Alert } from '@aircon/ui';
import { ChevronLeft, Plus } from 'lucide-react';
import Link from 'next/link';
import { loadCodes } from '@/server/codes';
import { requireCustomer } from '@/server/customer-session';
import { listMyDevices } from '@/server/devices';
import { DeviceList } from './device-list';

export const metadata = { title: '내 기기' };
export const dynamic = 'force-dynamic';

export default async function MyDevicesPage() {
  const me = await requireCustomer('/my/devices');
  const data = me.demo ? { devices: [], addresses: [] } : await listMyDevices(me.id);
  const codes = await loadCodes(['DEVICE_TYPE', 'BRAND', 'CLEAN_LEVEL']);
  const label = (g: string, v: string | null) => (v ? (codes[g]?.find((c) => c.value === v)?.label ?? v) : null);
  const groups = data.addresses
    .map((a) => ({
      id: a.id,
      title: a.alias ? `${a.alias} · ${a.roadAddress}` : a.roadAddress,
      devices: data.devices
        .filter((d) => d.addressId === a.id)
        .map((d) => ({
          id: d.id,
          name: [label('DEVICE_TYPE', d.deviceType), d.locationInHouse].filter(Boolean).join(' · '),
          brand: [label('BRAND', d.brand), d.modelName].filter(Boolean).join(' '),
          lastCleanedAt: d.lastCleanedAt,
          lastCleanLevel: label('CLEAN_LEVEL', d.lastCleanLevel),
          nextCleanDate: d.nextCleanDate,
          due: d.due,
        })),
    }))
    .filter((g) => g.devices.length);
  return (
    <main className="cus-page-body">
      <div className="cus-topbar">
        <Link href="/my" className="ac-btn ac-btn--ghost ac-btn--icon" aria-label="마이">
          <ChevronLeft aria-hidden />
        </Link>
      </div>
      <h1 className="ac-h2">내 기기</h1>
      {me.demo ? <Alert tone="warning">체험 고객은 기기를 저장하지 않아요.</Alert> : null}
      <p className="ac-body-sm">작업을 마치면 청소한 기기가 자동으로 등록돼요. 다시 예약할 기기를 골라 주세요.</p>
      <DeviceList groups={groups} />
      {!me.demo && data.addresses.length ? (
        <Link href="/my/devices/new" className="ac-btn ac-btn--outline ac-btn--block">
          <Plus aria-hidden /> 기기 직접 등록
        </Link>
      ) : null}
    </main>
  );
}
