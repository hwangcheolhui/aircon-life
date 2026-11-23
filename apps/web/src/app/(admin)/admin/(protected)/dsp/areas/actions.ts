'use server';
// A-DSP-050 관할 지역 관리 · F-ADM-DSP-07 (BR-102: 거점 소속 관리자는 자기 거점만) · F-ADM-DSP-11 지역 오픈 안내(BR-003)
import { serviceAreaInput } from '@aircon/contracts';
import { shouldNotifyAreaOpened } from '@aircon/domain';
import { serviceArea } from '@aircon/db';
import { canAccessBranch } from '@aircon/domain';
import { eq } from 'drizzle-orm';
import { notifyAreaOpened } from '@/server/area-open';
import { type ActionResult, parse } from '@/server/action-result';
import { ForbiddenError, getCurrentAdmin } from '@/server/auth';
import { deleteRow, saveRow } from '@/server/crud';
import { getDb } from '@/server/db';

async function assertRowInScope(id: string, admin: Parameters<typeof canAccessBranch>[0]) {
  const [row] = await getDb().select({ branchId: serviceArea.branchId }).from(serviceArea).where(eq(serviceArea.id, Number(id)));
  if (!row || !canAccessBranch(admin, row.branchId)) throw new ForbiddenError('다른 거점의 관할 지역은 수정할 수 없습니다.');
}

const cfg = {
  menu: 'A-DSP-050',
  table: serviceArea,
  idColumn: serviceArea.id,
  schema: serviceAreaInput,
  path: '/admin/dsp/areas',
  check: async (data: { branchId: number }, admin: Parameters<typeof canAccessBranch>[0], id: string | null) => {
    if (!canAccessBranch(admin, data.branchId)) throw new ForbiddenError('다른 거점의 관할 지역은 등록할 수 없습니다.');
    if (id) await assertRowInScope(id, admin);
  },
  checkDelete: assertRowInScope,
};

/**
 * 관할 지역 저장(F-ADM-DSP-07). 저장 결과가 "서비스 가능 + 법정동 코드"이면 그 법정동 오픈 알림 대기 신청자에게
 * 안내를 보낸다(F-ADM-DSP-11). 발송 실패는 저장을 되돌리지 않고 F-SYS-19 배치가 다시 보낸다.
 */
export async function saveArea(
  values: Record<string, string>,
  id: string | null,
): Promise<ActionResult<{ notified: number; failed: number } | undefined>> {
  const saved = await saveRow(cfg, values, id);
  if (!saved.ok) return saved;
  const area = parse(serviceAreaInput, values);
  if (!shouldNotifyAreaOpened(area)) return { ok: true };
  try {
    const admin = await getCurrentAdmin();
    const r = await notifyAreaOpened(area, { actorId: admin?.adminId ?? null });
    return { ok: true, data: { notified: r.sent, failed: r.failed } };
  } catch (e) {
    console.error(e);
    return { ok: true, data: { notified: 0, failed: -1 } };
  }
}
export async function deleteArea(id: string) {
  return deleteRow(cfg, id);
}
