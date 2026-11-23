// A-CUS-010 고객 목록 (단계 3) · F-ADM-CUS-01: 이름·전화(해시)·주소·등급·태그·최근작업일 검색, 목록 마스킹(BR-100), 거점 범위(BR-102)
import { listCustomers } from '@/server/admin-customers';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { parseCustomerQuery } from './query';
import { CustomersScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await requireScreen('A-CUS-010');
  const sp = await searchParams;
  const [rows, codes] = await Promise.all([
    listCustomers(await currentBranchFilter(admin), parseCustomerQuery(sp)),
    loadCodes(['CUSTOMER_GRADE', 'CUSTOMER_TAG', 'CUSTOMER_TYPE', 'CUSTOMER_STATUS', 'JOIN_CHANNEL', 'PRIVACY_AGREE_STATUS']),
  ]);
  return <CustomersScreen rows={rows} query={sp} codes={codes} />;
}
