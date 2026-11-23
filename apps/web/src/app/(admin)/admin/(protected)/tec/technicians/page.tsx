// A-TEC-010 기사 목록 (단계 2 기본 등록) · 근무표(A-DSP-040)·슬롯 자동 생성(F-SYS-01)의 기준
import { branch, technician } from '@aircon/db';
import { maskPhone } from '@aircon/domain';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { screenFlags } from '@/server/crud';
import { getDb } from '@/server/db';
import { decrypt } from '@/server/pii';
import { TechniciansScreen } from './screen';

export default async function TechniciansPage() {
  const admin = await requireScreen('A-TEC-010');
  const filter = await currentBranchFilter(admin); // BR-102
  const db = getDb();
  const cond = filter.kind === 'BRANCH' ? eq(technician.branchId, filter.branchId) : filter.kind === 'NONE' ? eq(technician.id, -1) : undefined;
  const [rows, branches, codes] = await Promise.all([
    db
      .select({ t: technician, branchName: branch.name })
      .from(technician)
      .innerJoin(branch, eq(branch.id, technician.branchId))
      .where(and(isNull(technician.deletedAt), cond))
      .orderBy(asc(technician.techCode)),
    db
      .select({ id: branch.id, name: branch.name })
      .from(branch)
      .where(and(isNull(branch.deletedAt), filter.kind === 'BRANCH' ? eq(branch.id, filter.branchId) : filter.kind === 'NONE' ? eq(branch.id, -1) : undefined))
      .orderBy(asc(branch.name)),
    loadCodes(['TECH_GRADE', 'CONTRACT_TYPE', 'TECH_STATUS']),
  ]);
  return (
    <TechniciansScreen
      rows={rows.map((r) => ({
        id: r.t.id,
        techCode: r.t.techCode,
        name: r.t.name,
        displayName: r.t.displayName,
        phoneMasked: maskPhone(decrypt(r.t.phone)),
        branchId: r.t.branchId,
        branchName: r.branchName,
        grade: r.t.grade,
        contractType: r.t.contractType,
        status: r.t.status,
        joinedAt: r.t.joinedAt,
      }))}
      branches={branches.map((b) => ({ value: String(b.id), label: b.name }))}
      codes={codes}
      {...screenFlags(admin, 'A-TEC-010')}
    />
  );
}
