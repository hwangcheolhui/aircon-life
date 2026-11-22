// A-SYS-030 거점 관리 (거점 등록·상태·운영시간·반경·거점장) · F-ADM-SYS-03
import { adminUser, branch } from '@aircon/db';
import { maskName } from '@aircon/domain';
import { asc, isNull } from 'drizzle-orm';
import { requireScreen } from '@/server/auth';
import { loadCodes } from '@/server/codes';
import { screenFlags } from '@/server/crud';
import { getDb } from '@/server/db';
import { BranchesScreen } from './screen';

export default async function BranchesPage() {
  const admin = await requireScreen('A-SYS-030');
  const db = getDb();
  const [rows, admins, codes] = await Promise.all([
    db.select().from(branch).where(isNull(branch.deletedAt)).orderBy(asc(branch.branchCode)),
    db.select({ id: adminUser.id, loginId: adminUser.loginId, name: adminUser.name }).from(adminUser).where(isNull(adminUser.deletedAt)),
    loadCodes(['BRANCH_STATUS']),
  ]);
  return (
    <BranchesScreen
      rows={rows}
      codes={codes}
      managers={admins.map((a) => ({ value: String(a.id), label: `${a.loginId} (${maskName(a.name)})` }))}
      {...screenFlags(admin, 'A-SYS-030')}
    />
  );
}
