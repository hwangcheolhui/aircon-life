// A-CSL-070 상담 이력 조회 (단계 3) · F-ADM-CSL-13: 기간·유형·상태·상담원·검색어 조회, 목록 마스킹(BR-100), 거점 범위(BR-102)
import { hasPermission } from '@aircon/domain';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { consultAgents, listConsultations } from '@/server/consult';
import { parseConsultQuery } from './query';
import { ConsultHistoryScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function ConsultHistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await requireScreen('A-CSL-070');
  const sp = await searchParams;
  const [rows, agents, codes] = await Promise.all([
    listConsultations(await currentBranchFilter(admin), parseConsultQuery(sp)),
    consultAgents(),
    loadCodes(['CONSULT_TYPE', 'CONSULT_STATUS', 'CONSULT_CHANNEL', 'INQUIRY_SUB_TYPE', 'ORDER_SYMPTOM']),
  ]);
  return (
    <ConsultHistoryScreen
      rows={rows}
      query={sp}
      codes={codes}
      agents={agents.map((a) => ({ value: String(a.id), label: a.name }))}
      canUpdate={hasPermission(admin, 'A-CSL-070', 'UPDATE') && !admin.preview}
    />
  );
}
