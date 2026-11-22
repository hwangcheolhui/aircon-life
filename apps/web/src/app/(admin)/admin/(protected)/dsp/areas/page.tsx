// A-DSP-050 관할 지역 관리 (거점-법정동 매핑, 서비스 가능 여부, 권역외 출장비) · F-ADM-DSP-07
import { branch, serviceArea } from '@aircon/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { screenFlags } from '@/server/crud';
import { getDb } from '@/server/db';
import { AreasScreen } from './screen';

export default async function AreasPage() {
  const admin = await requireScreen('A-DSP-050');
  const filter = await currentBranchFilter(admin); // BR-102
  const db = getDb();
  const branchCond =
    filter.kind === 'BRANCH' ? eq(branch.id, filter.branchId) : filter.kind === 'NONE' ? eq(branch.id, -1) : undefined;
  const branches = await db
    .select({ id: branch.id, name: branch.name })
    .from(branch)
    .where(and(isNull(branch.deletedAt), branchCond))
    .orderBy(asc(branch.name));
  const rows =
    filter.kind === 'NONE'
      ? []
      : await db
          .select()
          .from(serviceArea)
          .where(filter.kind === 'BRANCH' ? eq(serviceArea.branchId, filter.branchId) : undefined)
          .orderBy(asc(serviceArea.sido), asc(serviceArea.sigungu), asc(serviceArea.eupmyeondong));
  return (
    <AreasScreen
      rows={rows}
      branches={branches.map((b) => ({ value: String(b.id), label: b.name }))}
      {...screenFlags(admin, 'A-DSP-050')}
    />
  );
}
