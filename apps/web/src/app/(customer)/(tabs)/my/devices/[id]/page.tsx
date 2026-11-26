// C-DEV-020 기기 수정 (단계 9) · F-CUS-DEV-01
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadCodes } from '@/server/codes';
import { requireCustomer } from '@/server/customer-session';
import { getMyDevice } from '@/server/devices';
import { DeviceForm } from '../device-form';

export const metadata = { title: '기기 수정' };
export const dynamic = 'force-dynamic';

export default async function EditDevicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireCustomer(`/my/devices/${id}`);
  if (me.demo || !/^\d+$/.test(id)) notFound();
  const [{ device, addresses }, codes] = await Promise.all([getMyDevice(me.id, Number(id)), loadCodes(['DEVICE_TYPE', 'BRAND'])]);
  if (!device) notFound();
  return (
    <main className="cus-page-body">
      <div className="cus-topbar">
        <Link href="/my/devices" className="ac-btn ac-btn--ghost ac-btn--icon" aria-label="내 기기">
          <ChevronLeft aria-hidden />
        </Link>
      </div>
      <h1 className="ac-h2">기기 수정</h1>
      <DeviceForm
        initial={{
          id: device.id,
          addressId: device.addressId,
          deviceType: device.deviceType,
          brand: device.brand ?? '',
          modelName: device.modelName ?? '',
          installYear: device.installYear ? String(device.installYear) : '',
          locationInHouse: device.locationInHouse ?? '',
          isInverter: device.isInverter,
          hasHeating: device.hasHeating,
        }}
        addresses={addresses.map((a) => ({ value: String(a.id), label: a.alias ? `${a.alias} · ${a.roadAddress}` : a.roadAddress }))}
        deviceTypes={codes.DEVICE_TYPE ?? []}
        brands={codes.BRAND ?? []}
      />
    </main>
  );
}
