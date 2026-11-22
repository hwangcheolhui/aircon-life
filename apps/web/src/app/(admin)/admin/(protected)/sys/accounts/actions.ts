'use server';
// A-SYS-010 관리자 계정 (생성·역할·소속 거점·잠금 해제) · F-ADM-SYS-01
// 인증 계정은 Supabase Auth(AUTH_DRIVER=supabase) 또는 Mock에 만들고 admin_user.auth_user_id로 연결한다.
import { adminUserCreateInput, adminUserUpdateInput } from '@aircon/contracts';
import { adminUser } from '@aircon/db';
import { SETTING_KEYS, unlockAccount, validatePasswordRule } from '@aircon/domain';
import { createAuthAdapter } from '@aircon/integrations';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { UserError, ValidationFailed, handle, parse } from '@/server/action-result';
import { writeAudit } from '@/server/audit';
import { requirePermission } from '@/server/auth';
import { getDb } from '@/server/db';
import { decrypt, encrypt } from '@/server/pii';
import { getSettingNumber } from '@/server/settings';

const MENU = 'A-SYS-010';
const PATH = '/admin/sys/accounts';
/** 계정 관리용 인증 어댑터 (세션 쿠키를 건드리지 않는다) */
const adminAuth = () => createAuthAdapter({ getAll: () => [], setAll: () => undefined });

async function checkPassword(pw: string, field: string) {
  const err = validatePasswordRule(pw, await getSettingNumber(SETTING_KEYS.ADMIN_PASSWORD_MIN_LENGTH));
  if (err) throw new ValidationFailed({ [field]: err });
}

export async function saveAccount(values: Record<string, string>, id: string | null) {
  return handle(async () => {
    const actor = await requirePermission(MENU, id ? 'UPDATE' : 'CREATE');
    const db = getDb();
    if (!id) {
      const data = parse(adminUserCreateInput, values);
      await checkPassword(data.initialPassword, 'initialPassword');
      const [row] = await db
        .insert(adminUser)
        .values({
          loginId: data.loginId,
          name: data.name,
          email: data.email,
          phone: encrypt(data.phone),
          roleId: data.roleId,
          branchId: data.branchId,
          status: 'ACTIVE',
          createdBy: actor.adminId,
          updatedBy: actor.adminId,
        })
        .returning({ id: adminUser.id });
      try {
        const authUserId = await adminAuth().createUser(data.email, data.initialPassword);
        await db.update(adminUser).set({ authUserId }).where(eq(adminUser.id, row!.id));
      } catch (e) {
        await db.delete(adminUser).where(eq(adminUser.id, row!.id));
        throw new UserError(`인증 계정을 만들지 못했습니다. ${(e as Error).message}`);
      }
      await writeAudit({ actorId: actor.adminId, action: 'PERMISSION_CHANGE', targetTable: 'admin_user', targetId: row!.id, detail: { op: 'CREATE', roleId: data.roleId, branchId: data.branchId } });
    } else {
      const data = parse(adminUserUpdateInput, { ...values, id });
      const [before] = await db.select().from(adminUser).where(eq(adminUser.id, data.id));
      if (!before || before.deletedAt) throw new UserError('계정을 찾을 수 없습니다.');
      const newPassword = values.newPassword?.trim();
      if (newPassword) await checkPassword(newPassword, 'newPassword');
      // 잠금 해제: LOCKED → ACTIVE 이면 실패 횟수 초기화
      const unlock = before.status === 'LOCKED' && data.status === 'ACTIVE' ? unlockAccount() : {};
      await db
        .update(adminUser)
        .set({
          name: data.name,
          email: data.email,
          phone: encrypt(data.phone),
          roleId: data.roleId,
          branchId: data.branchId,
          status: data.status,
          ...unlock,
          updatedAt: new Date(),
          updatedBy: actor.adminId,
        })
        .where(eq(adminUser.id, data.id));
      if (before.authUserId) {
        if (before.email !== data.email) await adminAuth().setEmail(before.authUserId, data.email);
        if (newPassword) await adminAuth().setPassword(before.authUserId, newPassword);
      }
      const permChanged = before.roleId !== data.roleId || before.branchId !== data.branchId;
      await writeAudit({
        actorId: actor.adminId,
        action: permChanged ? 'PERMISSION_CHANGE' : 'UPDATE',
        targetTable: 'admin_user',
        targetId: data.id,
        detail: {
          roleId: [before.roleId, data.roleId],
          branchId: [before.branchId, data.branchId],
          status: [before.status, data.status],
          passwordReset: Boolean(newPassword),
        },
      });
    }
    revalidatePath(PATH);
  });
}

export async function deleteAccount(id: string) {
  return handle(async () => {
    const actor = await requirePermission(MENU, 'DELETE');
    if (Number(id) === actor.adminId) throw new UserError('본인 계정은 삭제할 수 없습니다.');
    await getDb()
      .update(adminUser)
      .set({ deletedAt: new Date(), status: 'RETIRED', updatedAt: new Date(), updatedBy: actor.adminId })
      .where(eq(adminUser.id, Number(id)));
    await writeAudit({ actorId: actor.adminId, action: 'DELETE', targetTable: 'admin_user', targetId: id });
    revalidatePath(PATH);
  });
}

/** 상세 열람(원문 이름·연락처·이메일) — 감사 로그 VIEW_PII (BR-100) */
export async function getAccountDetail(id: string) {
  return handle(async () => {
    const actor = await requirePermission(MENU, 'UPDATE');
    const [row] = await getDb().select().from(adminUser).where(eq(adminUser.id, Number(id)));
    if (!row) throw new UserError('계정을 찾을 수 없습니다.');
    await writeAudit({ actorId: actor.adminId, action: 'VIEW_PII', targetTable: 'admin_user', targetId: id, detail: { fields: ['name', 'phone', 'email'] } });
    return {
      loginId: row.loginId,
      name: row.name,
      email: row.email,
      phone: decrypt(row.phone) ?? '',
      roleId: String(row.roleId),
      branchId: row.branchId ? String(row.branchId) : '',
      status: row.status,
    };
  });
}
