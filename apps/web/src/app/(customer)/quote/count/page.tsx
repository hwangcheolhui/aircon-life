// C-QUO-030 대수·작업범위·옵션 (S3) · F-CUS-QUO-03
import { CountStep } from '@/customer/count-step';
import { loadCodes } from '@/server/codes';
import { loadQuoteChoices } from '@/server/quote';

export const metadata = { title: '견적 받기 · 대수·작업 범위' };
export const dynamic = 'force-dynamic';

export default async function QuoteCountPage({ searchParams }: { searchParams: Promise<{ dong?: string }> }) {
  const { dong } = await searchParams;
  const legalDongCode = dong && /^\d{10}$/.test(dong) ? dong : null;
  const [choices, codes] = await Promise.all([
    loadQuoteChoices(legalDongCode, { anyBranch: legalDongCode === null }),
    loadCodes(['DEVICE_TYPE', 'CLEAN_LEVEL']),
  ]);
  return (
    <CountStep
      products={choices.products}
      options={choices.options}
      deviceLabels={codes.DEVICE_TYPE ?? []}
      cleanLevels={codes.CLEAN_LEVEL ?? []}
    />
  );
}
