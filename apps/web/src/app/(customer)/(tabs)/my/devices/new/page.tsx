// C-DEV-020 기기 등록 (단계 9) · F-CUS-DEV-01
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { loadCodes } from '@/server/codes';
import { requireCustomer } from '@/server/customer-session';
import { listMyDevices } from '@/server/devices';
import { DeviceForm } from '../device-form';

export const metadata = { title: '기기 등록' };
export const dynamic = 'force-dynamic';

export default async function NewDevicePage() {
  const me = await requireCustomer('/my/devices/new');
  if (me.demo) redirect('/my/devices');
  const [{ addresses }, codes] = await Promise.all([listMyDevices(me.id), loadCodes(['DEVICE_TYPE', 'BRAND'])]);
  return (
    <main className="cus-page-body">
      <div className="cus-topbar">
        <Link href="/my/devices" className="ac-btn ac-btn--ghost ac-btn--icon" aria-label="내 기기">
          <ChevronLeft aria-hidden />
        </Link>
      </div>
      <h1 className="ac-h2">기기 등록</h1>
      <DeviceForm
        initial={{ id: null, addressId: addresses[0]?.id ?? null, deviceType: '', brand: '', modelName: '', installYear: '', locationInHouse: '', isInverter: false, hasHeating: false }}
        addresses={addresses.map((a) => ({ value: String(a.id), label: a.alias ? `${a.alias} · ${a.roadAddress}` : a.roadAddress }))}
        deviceTypes={codes.DEVICE_TYPE ?? []}
        brands={codes.BRAND ?? []}
      />
    </main>
  );
}
