// C-QUO-021 사진으로 기기 인식 (단계 9) · F-CUS-QUO-05: 사진 업로드 → 형태·브랜드·오염도 추정 → 확인/수정 후 대수 단계로
import { PhotoStep } from '@/customer/photo-step';
import { loadCodes } from '@/server/codes';
import { loadQuoteChoices } from '@/server/quote';

export const metadata = { title: '견적 받기 · 사진으로 알아보기' };
export const dynamic = 'force-dynamic';

export default async function QuotePhotoPage({ searchParams }: { searchParams: Promise<{ dong?: string }> }) {
  const { dong } = await searchParams;
  const legalDongCode = dong && /^\d{10}$/.test(dong) ? dong : null;
  const [choices, codes] = await Promise.all([loadQuoteChoices(legalDongCode, { anyBranch: legalDongCode === null }), loadCodes(['DEVICE_TYPE', 'DIRT_LEVEL', 'BRAND'])]);
  const deviceTypes = (codes.DEVICE_TYPE ?? []).filter((c) => choices.products.some((p) => p.deviceType === c.value));
  return <PhotoStep deviceTypes={deviceTypes} dirtLevels={codes.DIRT_LEVEL ?? []} brands={codes.BRAND ?? []} />;
}
