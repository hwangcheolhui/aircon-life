// C-QUO-020 기기 형태 선택 (S2) · F-CUS-QUO-02
import { DeviceStep } from '@/customer/device-step';
import { loadCodes } from '@/server/codes';
import { loadQuoteChoices } from '@/server/quote';

export const metadata = { title: '견적 받기 · 기기 형태' };
export const dynamic = 'force-dynamic';

export default async function QuoteDevicePage({
  searchParams,
}: {
  searchParams: Promise<{ dong?: string }>;
}) {
  const { dong } = await searchParams;
  const legalDongCode = dong && /^\d{10}$/.test(dong) ? dong : null;
  const [choices, codes] = await Promise.all([
    loadQuoteChoices(legalDongCode, { anyBranch: legalDongCode === null }),
    loadCodes(['DEVICE_TYPE']),
  ]);
  // 견적 가능한(사용 중인 상품·가격이 있는) 기기 형태만 보여 준다
  const deviceTypes = (codes.DEVICE_TYPE ?? []).filter((c) =>
    choices.products.some((p) => p.deviceType === c.value),
  );
  return <DeviceStep deviceTypes={deviceTypes} />;
}
