// A-DSP-030 운영 슬롯 관리 · F-ADM-DSP-05: 거점·날짜·시간대별 수용/예약/잔여, 마감, 재계산 (슬롯은 F-SYS-01 이 매일 00:10 근무표로 만든다)
import { SETTING_KEYS, kstToday, slotDates } from '@aircon/domain';
import { branch } from '@aircon/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { requireScreen } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { loadCodes } from '@/server/codes';
import { screenFlags } from '@/server/crud';
import { getDb } from '@/server/db';
import { getSettingNumber } from '@/server/settings';
import { listSlots } from '@/server/slots';
import { SlotsScreen } from './screen';

export default async function SlotsPage() {
  const admin = await requireScreen('A-DSP-030');
  const filter = await currentBranchFilter(admin); // BR-102
  const days = await getSettingNumber(SETTING_KEYS.SLOT_DAYS_AHEAD);
  const dates = [kstToday(new Date()), ...slotDates(kstToday(new Date()), days)];
  const branchIds = filter.kind === 'ALL' ? null : filter.kind === 'BRANCH' ? [filter.branchId] : [-1];
  const [rows, branches, codes] = await Promise.all([
    listSlots(branchIds, dates[0]!, dates[dates.length - 1]!),
    getDb()
      .select({ id: branch.id, name: branch.name })
      .from(branch)
      .where(and(isNull(branch.deletedAt), branchIds ? eq(branch.id, branchIds[0]!) : undefined))
      .orderBy(asc(branch.name)),
    loadCodes(['SLOT_KIND']),
  ]);
  return (
    <SlotsScreen
      rows={rows}
      dates={dates}
      branches={branches.map((b) => ({ value: String(b.id), label: b.name }))}
      kinds={codes.SLOT_KIND ?? []}
      {...screenFlags(admin, 'A-DSP-030')}
    />
  );
}
