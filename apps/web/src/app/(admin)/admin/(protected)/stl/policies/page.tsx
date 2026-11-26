// A-STL-010 수수료 정책 · F-ADM-STL-01: 등급·계약형태·거점별 기사 배분율(또는 대당 금액), 추가요금·지원기사 배분율, 원천징수율(BR-083).
// 정산 계산(A-STL-020)은 기사마다 가장 구체적인 정책 1개를 고른다(거점 > 등급 > 계약형태, 같으면 늦게 시작한 정책).
import { branch } from '@aircon/db';
import { asc, isNull } from 'drizzle-orm';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { screenFlags } from '@/server/crud';
import { getDb } from '@/server/db';
import { listPolicies } from '@/server/settlements';
import { PoliciesScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function CommissionPoliciesPage() {
  const admin = await requireScreen('A-STL-010');
  const [rows, branches, codes] = await Promise.all([
    listPolicies(await currentBranchFilter(admin)),
    getDb().select({ id: branch.id, name: branch.name }).from(branch).where(isNull(branch.deletedAt)).orderBy(asc(branch.name)),
    loadCodes(['TECH_GRADE', 'CONTRACT_TYPE', 'COMMISSION_CALC_TYPE']),
  ]);
  const flags = screenFlags(admin, 'A-STL-010');
  const live = !admin.preview;
  return (
    <PoliciesScreen
      rows={rows}
      branches={branches.map((b) => ({ value: String(b.id), label: b.name }))}
      codes={codes}
      today={new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })}
      canCreate={flags.canCreate && live}
      canUpdate={flags.canUpdate && live}
      canDelete={flags.canDelete && live}
    />
  );
}
