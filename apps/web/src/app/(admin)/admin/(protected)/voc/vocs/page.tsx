// A-VOC-010 VOC 목록 · F-ADM-VOC-01: 상태·분류·등급·기간 필터, [VOC 등록](접수번호로 고객·기사 연결), 행 더블클릭 → A-VOC-011 VOC 카드
import { hasPermission } from '@aircon/domain';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { listVocs } from '@/server/voc';
import { dateOrNull, strOrNull } from '../query';
import { VocsScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function VocsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await requireScreen('A-VOC-010');
  const sp = await searchParams;
  const q = {
    status: strOrNull(sp.status),
    categoryL: strOrNull(sp.categoryL),
    severity: strOrNull(sp.severity),
    alertOnly: sp.alert === 'Y',
    dateFrom: dateOrNull(sp.from),
    dateTo: dateOrNull(sp.to),
  };
  const [rows, codes] = await Promise.all([
    listVocs(await currentBranchFilter(admin), q),
    loadCodes(['VOC_STATUS', 'VOC_TYPE', 'VOC_CHANNEL', 'VOC_CATEGORY_L', 'VOC_CATEGORY_M', 'VOC_SEVERITY']),
  ]);
  return <VocsScreen rows={rows} query={q} codes={codes} canCreate={!admin.preview && hasPermission(admin, 'A-VOC-010', 'CREATE')} />;
}
