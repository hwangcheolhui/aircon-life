// A-VOC-011 VOC 카드 · F-ADM-VOC-01: 카드 정보, 처리(상태·등급·Alert·분류·담당·귀책 기사·원인·고객 조치), 처리 이력, 인쇄. 메뉴 권한은 A-VOC-010
import { hasPermission } from '@aircon/domain';
import { notFound } from 'next/navigation';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { getVoc } from '@/server/voc';
import { VocCardScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function VocCardPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireScreen('A-VOC-010');
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) notFound();
  const [v, codes] = await Promise.all([
    getVoc(id, await currentBranchFilter(admin)).catch(() => null),
    loadCodes(['VOC_STATUS', 'VOC_TYPE', 'VOC_CHANNEL', 'VOC_CATEGORY_L', 'VOC_CATEGORY_M', 'VOC_SEVERITY', 'AS_STATUS', 'AS_REASON']),
  ]);
  if (!v) notFound();
  return (
    <VocCardScreen
      v={v}
      codes={codes}
      canUpdate={!admin.preview && hasPermission(admin, 'A-VOC-010', 'UPDATE')}
      canCreateAs={!admin.preview && hasPermission(admin, 'A-VOC-030', 'CREATE')}
    />
  );
}
