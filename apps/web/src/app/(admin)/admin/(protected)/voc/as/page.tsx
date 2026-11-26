// A-VOC-030 AS 요청 · F-ADM-VOC-03: 보증 판정(BR-050 보증기간 내 무상), 재방문 주문 생성 → 배정 보드(A-DSP-010), 반려(사유 알림)·완료. BR-051 진행 중 AS 1건
import { hasPermission } from '@aircon/domain';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { listAs } from '@/server/voc';
import { strOrNull } from '../query';
import { AsScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function AsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await requireScreen('A-VOC-030');
  const status = strOrNull((await searchParams).status);
  const [rows, codes] = await Promise.all([listAs(await currentBranchFilter(admin), status), loadCodes(['AS_STATUS', 'AS_REASON'])]);
  return (
    <AsScreen
      rows={rows}
      status={status}
      codes={codes}
      canCreate={!admin.preview && hasPermission(admin, 'A-VOC-030', 'CREATE')}
      canUpdate={!admin.preview && hasPermission(admin, 'A-VOC-030', 'UPDATE')}
    />
  );
}
