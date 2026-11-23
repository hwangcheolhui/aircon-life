// A-DSP-050 관할 지역 관리 (거점-법정동 매핑, 서비스 가능 여부, 권역외 출장비) · F-ADM-DSP-07
// 오픈 알림 대기 건수·미등록 지역 신청 현황 · F-ADM-DSP-11 (번호는 표시하지 않음, 01 §6)
import { branch, serviceArea } from '@aircon/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { areaOpenWaitingByDong } from '@/server/area-open';
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
  const demand = filter.kind === 'NONE' ? [] : await areaOpenWaitingByDong(db);
  const waitingByCode = Object.fromEntries(demand.map((d) => [d.legalDongCode, d.waiting]));
  // 관할 지역에 아직 없는 법정동의 신청 현황은 거점이 정해지지 않은 데이터라 전체 범위 관리자에게만 보인다(BR-102)
  const registered = new Set((await db.select({ code: serviceArea.legalDongCode }).from(serviceArea)).map((r) => r.code));
  const unregistered = filter.kind === 'ALL' ? demand.filter((d) => !registered.has(d.legalDongCode)) : [];
  return (
    <AreasScreen
      rows={rows}
      waitingByCode={waitingByCode}
      unregistered={unregistered}
      branches={branches.map((b) => ({ value: String(b.id), label: b.name }))}
      {...screenFlags(admin, 'A-DSP-050')}
    />
  );
}
