// A-CUS-020 고객 상세 (One View, 단계 3) · F-ADM-CUS-02·03: 8개 탭 [기본 | 주소·기기 | 주문 | 결제 | VOC·AS | 쿠폰 | 동의이력 | 메모], 등급·태그
import { hasPermission } from '@aircon/domain';
import { notFound } from 'next/navigation';
import { getCustomerOneView } from '@/server/admin-customers';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { CustomerDetailScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireScreen('A-CUS-020');
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) notFound();
  const d = await getCustomerOneView(id, await currentBranchFilter(admin));
  if (!d) notFound();
  const codes = await loadCodes([
    'CUSTOMER_GRADE',
    'CUSTOMER_TAG',
    'CUSTOMER_TYPE',
    'CUSTOMER_STATUS',
    'JOIN_CHANNEL',
    'AUTH_PROVIDER',
    'PRIVACY_AGREE_STATUS',
    'CONSENT_TYPE',
    'CONSENT_ACTION',
    'CONSENT_CHANNEL',
    'HOUSING_TYPE',
    'ORDER_CHANNEL',
    'ORDER_TYPE',
    'PAYMENT_STATUS',
    'PAYMENT_STAGE',
    'PAYMENT_METHOD',
    'CONSULT_TYPE',
    'CONSULT_STATUS',
    'INQUIRY_SUB_TYPE',
  ]);
  return <CustomerDetailScreen d={d} codes={codes} canUpdate={hasPermission(admin, 'A-CUS-020', 'UPDATE') && !admin.preview} />;
}
