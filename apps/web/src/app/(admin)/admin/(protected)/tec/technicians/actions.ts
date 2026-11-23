'use server';
// A-TEC-010 기사 목록·기본 등록 (단계 2 선행: 근무표·슬롯 자동 생성에 필요한 기사 기본 정보만, 상세 프로필은 단계 4-1)
// BR-102: 거점 소속 관리자는 자기 거점 기사만. 연락처는 🔒 암호화 저장, 원문 열람은 감사 로그.
import { technicianInput } from '@aircon/contracts';
import { technician } from '@aircon/db';
import { canAccessBranch } from '@aircon/domain';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { writeAudit } from '@/server/audit';
import { ForbiddenError, requirePermission } from '@/server/auth';
import { getDb } from '@/server/db';
import { decrypt, encrypt } from '@/server/pii';

const MENU = 'A-TEC-010';

async function rowInScope(id: number, admin: Parameters<typeof canAccessBranch>[0]) {
  const [row] = await getDb().select().from(technician).where(eq(technician.id, id));
  if (!row || !canAccessBranch(admin, row.branchId)) throw new ForbiddenError('다른 거점의 기사는 볼 수 없습니다.');
  return row;
}

export async function saveTechnician(values: Record<string, string>, id: string | null) {
  return handle(async () => {
    const admin = await requirePermission(MENU, id ? 'UPDATE' : 'CREATE');
    const v = parse(technicianInput, values);
    if (!canAccessBranch(admin, v.branchId)) throw new ForbiddenError('다른 거점 소속으로 등록할 수 없습니다.');
    const data = { ...v, phone: encrypt(v.phone)! };
    if (id) {
      await rowInScope(Number(id), admin);
      await getDb()
        .update(technician)
        .set({ ...data, updatedAt: new Date(), updatedBy: admin.adminId })
        .where(eq(technician.id, Number(id)));
    } else {
      await getDb()
        .insert(technician)
        .values({ ...data, createdBy: admin.adminId, updatedBy: admin.adminId });
    }
    revalidatePath('/admin/tec/technicians');
  });
}

/** 수정 모달: 연락처 원문 (감사 로그 VIEW_PII) */
export async function technicianDetail(id: number) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'UPDATE');
    const row = await rowInScope(id, admin);
    await writeAudit({ actorId: admin.adminId, action: 'VIEW_PII', targetTable: 'technician', targetId: id, detail: { field: 'phone' } });
    return { ...row, phone: decrypt(row.phone) ?? '' };
  });
}
