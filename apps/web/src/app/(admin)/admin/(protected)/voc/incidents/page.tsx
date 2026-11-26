// A-VOC-020 안전사고 관리 · F-ADM-VOC-02: 진행 상태·보험 접수번호·보상 금액, 수신자 통보 이력, 수신자 추가(BR-061). 접수는 상담 콘솔 A-CSL-040
import { hasPermission } from '@aircon/domain';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { listIncidents } from '@/server/incidents';
import { dateOrNull, strOrNull } from '../query';
import { IncidentsScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await requireScreen('A-VOC-020');
  const sp = await searchParams;
  const q = { status: strOrNull(sp.status), dateFrom: dateOrNull(sp.from), dateTo: dateOrNull(sp.to) };
  const [rows, codes] = await Promise.all([
    listIncidents(await currentBranchFilter(admin), q),
    loadCodes(['INCIDENT_STATUS', 'DAMAGE_TYPE', 'MEDIA_FLAG', 'INCIDENT_RECIPIENT_TYPE']),
  ]);
  return <IncidentsScreen rows={rows} query={q} codes={codes} canUpdate={!admin.preview && hasPermission(admin, 'A-VOC-020', 'UPDATE')} />;
}
