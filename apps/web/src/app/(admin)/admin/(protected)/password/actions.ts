'use server';
// A-AUTH-020 비밀번호 변경
import { passwordChangeInput } from '@aircon/contracts';
import { adminUser } from '@aircon/db';
import { SETTING_KEYS, validatePasswordRule } from '@aircon/domain';
import { eq } from 'drizzle-orm';
import { type ActionResult, ValidationFailed, handle, parse } from '@/server/action-result';
import { writeAudit } from '@/server/audit';
import { ForbiddenError, getAuth, getCurrentAdmin } from '@/server/auth';
import { getDb } from '@/server/db';
import { getSettingNumber } from '@/server/settings';

export async function changePasswordAction(_: unknown, form: FormData): Promise<ActionResult> {
  return handle(async () => {
    const me = await getCurrentAdmin();
    if (!me || me.preview) throw new ForbiddenError('로그인이 필요합니다.');
    const data = parse(passwordChangeInput, Object.fromEntries(form));
    const err = validatePasswordRule(data.newPassword, await getSettingNumber(SETTING_KEYS.ADMIN_PASSWORD_MIN_LENGTH));
    if (err) throw new ValidationFailed({ newPassword: err });
    const [row] = await getDb().select().from(adminUser).where(eq(adminUser.id, me.adminId));
    const auth = await getAuth();
    // 현재 비밀번호 확인: 같은 계정으로 다시 로그인해 본다
    const ok = await auth.signInWithPassword(row!.email, data.currentPassword);
    if (!ok || ok.authUserId !== row!.authUserId) throw new ValidationFailed({ currentPassword: '현재 비밀번호가 올바르지 않습니다.' });
    await auth.setPassword(row!.authUserId!, data.newPassword);
    await writeAudit({ actorId: me.adminId, action: 'UPDATE', targetTable: 'admin_user', targetId: me.adminId, detail: { op: 'PASSWORD_CHANGE' } });
  });
}
