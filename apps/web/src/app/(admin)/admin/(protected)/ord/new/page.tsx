// A-ORD-040 수동 주문 등록 · F-ADM-ORD-06: 고객 검색, 항목·견적, 일정 (전화·B2B·현장 접수)
import { hasPermission } from '@aircon/domain';
import { redirect } from 'next/navigation';
import { requireScreen } from '@/server/auth';
import { loadCodes } from '@/server/codes';
import { loadQuoteChoices } from '@/server/quote';
import { ManualOrderScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function NewOrderPage() {
  const admin = await requireScreen('A-ORD-040');
  if (!hasPermission(admin, 'A-ORD-040', 'CREATE')) redirect('/admin/ord/orders');
  const [choices, codes] = await Promise.all([
    loadQuoteChoices(null, { anyBranch: true }),
    loadCodes(['DEVICE_TYPE', 'CLEAN_LEVEL', 'HOUSING_TYPE', 'ORDER_TYPE', 'ORDER_CHANNEL', 'CUSTOMER_TYPE']),
  ]);
  return <ManualOrderScreen choices={choices} codes={codes} readOnly={admin.preview} />;
}
