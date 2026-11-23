'use server';
// A-TEC-010 기사 목록·기본 등록 (단계 2 선행: 근무표·슬롯 자동 생성에 필요한 기사 기본 정보만, 상세 프로필은 단계 4-1)
// BR-102: 거점 소속 관리자는 자기 거점 기사만. 연락처는 🔒 암호화 저장, 원문 열람은 감사 로그.
import { technicianInput } from '@aircon/contracts';
import { technician, technicianGradeHistory } from '@aircon/db';
import { SETTING_KEYS, canAccessBranch, kstToday } from '@aircon/domain';
import { and, eq, ne } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { writeAudit } from '@/server/audit';
import { ForbiddenError, requirePermission } from '@/server/auth';
import { getDb } from '@/server/db';
import { decrypt, encrypt, phoneHash } from '@/server/pii';
import { getSettingNumber } from '@/server/settings';
import { UserError } from '@/server/action-result';

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
    // 로그인 ID = 휴대폰 번호 검색용 해시 (F-TEC-AUTH-01)
    const data = { ...v, phone: encrypt(v.phone)!, loginId: phoneHash(v.phone) };
    const [dup] = await getDb()
      .select({ id: technician.id })
      .from(technician)
      .where(and(eq(technician.loginId, data.loginId), id ? ne(technician.id, Number(id)) : undefined));
    if (dup) throw new UserError('같은 연락처로 등록된 기사가 있습니다.');
    if (id) {
      const row = await rowInScope(Number(id), admin);
      // 등급은 상세(A-TEC-020)의 등급 변경으로만 바꾼다 (사유·이력, F-ADM-TEC-03)
      if (row.grade !== v.grade) throw new UserError('등급은 기사 상세의 [등급 변경]에서 사유와 함께 바꿔 주세요.');
      await getDb()
        .update(technician)
        .set({ ...data, updatedAt: new Date(), updatedBy: admin.adminId })
        .where(eq(technician.id, Number(id)));
    } else {
      const accompanyRequiredCount = await getSettingNumber(SETTING_KEYS.TECH_ACCOMPANY_COUNT);
      await getDb().transaction(async (tx) => {
        const [t] = await tx
          .insert(technician)
          .values({ ...data, accompanyRequiredCount, createdBy: admin.adminId, updatedBy: admin.adminId })
          .returning({ id: technician.id });
        await tx.insert(technicianGradeHistory).values({
          technicianId: t!.id,
          fromGrade: null,
          toGrade: v.grade,
          reason: '신규 등록',
          approvedBy: admin.adminId,
          effectiveDate: v.joinedAt ?? kstToday(new Date()),
        });
      });
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
