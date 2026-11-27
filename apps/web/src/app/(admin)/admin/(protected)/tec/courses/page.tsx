// A-TEC-040 교육 과정 · F-ADM-TEC-05: 과정 코드·유형(기본·심화·안전·리더)·수강료·시간·수료 기준·거점(비우면 전체 공통)·기간·정원·상태, 수강/수료 인원
// 수료 판정 기준값은 system_setting TRAINING_PASS_ATTENDANCE·TRAINING_PASS_SCORE
import { branch } from '@aircon/db';
import { SETTING_KEYS, resolveBranchFilter } from '@aircon/domain';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { screenFlags } from '@/server/crud';
import { getDb } from '@/server/db';
import { getSettingNumber } from '@/server/settings';
import { listCourses } from '@/server/training';
import { CoursesScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function CoursesPage() {
  const admin = await requireScreen('A-TEC-040');
  const scope = resolveBranchFilter(admin, null);
  const [rows, codes, branches, passAttendance, passScore] = await Promise.all([
    listCourses(await currentBranchFilter(admin)),
    loadCodes(['COURSE_TYPE', 'COURSE_STATUS']),
    getDb().select({ id: branch.id, name: branch.name }).from(branch).where(and(eq(branch.status, 'ACTIVE'), isNull(branch.deletedAt))).orderBy(asc(branch.name)),
    getSettingNumber(SETTING_KEYS.TRAINING_PASS_ATTENDANCE),
    getSettingNumber(SETTING_KEYS.TRAINING_PASS_SCORE),
  ]);
  const writable = scope.kind === 'ALL' ? branches : scope.kind === 'BRANCH' ? branches.filter((b) => b.id === scope.branchId) : [];
  const flags = screenFlags(admin, 'A-TEC-040');
  const live = !admin.preview;
  return (
    <CoursesScreen
      rows={rows.map((r) => ({ ...r, createdAt: undefined, updatedAt: undefined, deletedAt: undefined }))}
      codes={codes}
      branches={writable.map((b) => ({ value: String(b.id), label: b.name }))}
      allowCommon={scope.kind === 'ALL'}
      passNote={`수료 기준: 출석률 ${passAttendance}% 이상 · 실습 ${passScore}점 이상 (시스템 설정)`}
      canCreate={live && flags.canCreate}
      canUpdate={live && flags.canUpdate}
      canDelete={live && flags.canDelete}
    />
  );
}
