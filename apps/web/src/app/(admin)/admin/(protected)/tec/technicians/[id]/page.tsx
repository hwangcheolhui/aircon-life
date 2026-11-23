// A-TEC-020 기사 상세·등록 · F-ADM-TEC-02(기본·계약·계좌·숙련·활동지역·자격·보험·등급이력·작업통계) · F-ADM-TEC-03(등급 변경)
// 탭 [기본·계약 | 숙련·지역 | 등급이력 | 작업통계 | 정산 | VOC]. 정산은 단계 7, VOC는 단계 8에서 채운다.
import { hasPermission } from '@aircon/domain';
import { notFound } from 'next/navigation';
import { getTechnicianDetail, recentTechnicianJobs } from '@/server/admin-technicians';
import { requireScreen } from '@/server/auth';
import { loadCodes } from '@/server/codes';
import { boardBranches } from '@/server/dispatch';
import { currentBranchFilter } from '@/server/branch-selection';
import { TechnicianDetailScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function TechnicianDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireScreen('A-TEC-020');
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) notFound();
  const d = await getTechnicianDetail(id, admin);
  if (!d) notFound();
  const [jobs, codes, branches] = await Promise.all([
    recentTechnicianJobs(id),
    loadCodes(['TECH_GRADE', 'CONTRACT_TYPE', 'TECH_STATUS', 'DEVICE_TYPE', 'SKILL_LEVEL', 'ASSIGN_ROLE']),
    boardBranches(await currentBranchFilter(admin)),
  ]);
  return (
    <TechnicianDetailScreen
      d={d}
      jobs={jobs.map((j) => ({ ...j, promisedAt: j.promisedAt?.toISOString() ?? null }))}
      codes={codes}
      branches={branches.map((b) => ({ value: String(b.id), label: b.name }))}
      canUpdate={hasPermission(admin, 'A-TEC-020', 'UPDATE') && !admin.preview}
    />
  );
}
