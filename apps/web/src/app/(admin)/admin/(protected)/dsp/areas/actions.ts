'use server';
// A-DSP-050 관할 지역 관리 · F-ADM-DSP-07 (BR-102: 거점 소속 관리자는 자기 거점만)
import { serviceAreaInput } from '@aircon/contracts';
import { serviceArea } from '@aircon/db';
import { canAccessBranch } from '@aircon/domain';
import { eq } from 'drizzle-orm';
import { ForbiddenError } from '@/server/auth';
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

export async function saveArea(values: Record<string, string>, id: string | null) {
  return saveRow(cfg, values, id);
}
export async function deleteArea(id: string) {
  return deleteRow(cfg, id);
}
