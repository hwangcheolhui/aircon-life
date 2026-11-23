// C-RSV-030 예약 확인 (S7) · F-CUS-RSV-03(요약·결제 방식) · F-CUS-RSV-05(확정, 이중예약 경고 BR-020, 슬롯 차감 BR-021) · BR-030 취소 규정 동의
import { SETTING_KEYS } from '@aircon/domain';
import { loadCodes } from '@/server/codes';
import { getSettingNumber } from '@/server/settings';
import { reserveContext } from '../../context';
import { ConfirmStep } from './confirm-step';

export const metadata = { title: '예약 확인' };
export const dynamic = 'force-dynamic';

export default async function ConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ quoteNo: string }>;
  searchParams: Promise<{ r?: string }>;
}) {
  const { quoteNo } = await params;
  const { quote, r } = await reserveContext(quoteNo, (await searchParams).r, '/confirm');
  const [codes, feeHours, feeAmount] = await Promise.all([
    loadCodes(['HOUSING_TYPE', 'PAYMENT_STAGE']),
    getSettingNumber(SETTING_KEYS.CANCEL_FEE_HOURS),
    getSettingNumber(SETTING_KEYS.CANCEL_FEE_AMOUNT),
  ]);
  const payLabels = Object.fromEntries((codes.PAYMENT_STAGE ?? []).map((c) => [c.value, c.label]));
  return (
    <ConfirmStep
      quoteNo={quote.quoteNo}
      r={r}
      housingTypes={codes.HOUSING_TYPE ?? []}
      payMethods={[
        { value: 'PREPAY', label: payLabels.PREPAY ?? 'PREPAY' },
        { value: 'ONSITE', label: payLabels.ONSITE ?? 'ONSITE' },
      ]}
      feeHours={feeHours}
      feeAmount={feeAmount}
    />
  );
}
