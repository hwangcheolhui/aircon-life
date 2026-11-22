'use server';
// A-AUTH-010 로그인 · F-ADM-SYS-01 (5회 실패 잠금: system_setting ADMIN_LOGIN_MAX_FAIL)
import { loginInput } from '@aircon/contracts';
import { adminUser } from '@aircon/db';
import { SETTING_KEYS, evaluateLogin } from '@aircon/domain';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { type ActionResult, ValidationFailed, handle, parse } from '@/server/action-result';
import { writeAudit } from '@/server/audit';
import { getAuth } from '@/server/auth';
import { getDb } from '@/server/db';
import { getSettingNumber } from '@/server/settings';

const INVALID = 'ID 또는 비밀번호가 올바르지 않습니다.';

export async function loginAction(_: unknown, form: FormData): Promise<ActionResult> {
  const result = await handle(async () => {
    const { loginId, password } = parse(loginInput, Object.fromEntries(form));
    const db = getDb();
    const [admin] = await db.select().from(adminUser).where(eq(adminUser.loginId, loginId));
    if (!admin || admin.deletedAt) throw new ValidationFailed({ _: INVALID });

    if (admin.status === 'LOCKED') {
      throw new ValidationFailed({ _: '로그인 실패가 반복되어 계정이 잠겼습니다. 슈퍼관리자에게 잠금 해제를 요청하세요.' });
    }
    if (admin.status !== 'ACTIVE') throw new ValidationFailed({ _: INVALID });

    const auth = await getAuth();
    const signed = await auth.signInWithPassword(admin.email, password);
    const ok = signed !== null && signed.authUserId === admin.authUserId;
    if (signed && !ok) await auth.signOut();

    const maxFail = await getSettingNumber(SETTING_KEYS.ADMIN_LOGIN_MAX_FAIL);
    const outcome = evaluateLogin(
      { status: admin.status as 'ACTIVE', loginFailCount: admin.loginFailCount, deleted: false },
      ok,
      maxFail,
    );
    if (outcome.result === 'UNAVAILABLE') throw new ValidationFailed({ _: INVALID });
    await db
      .update(adminUser)
      .set({ ...outcome.next, ...(ok ? { lastLoginAt: new Date() } : {}), updatedAt: new Date() })
      .where(eq(adminUser.id, admin.id));
    await writeAudit({
      actorId: admin.id,
      action: 'LOGIN',
      targetTable: 'admin_user',
      targetId: admin.id,
      detail: { result: outcome.result },
    });
    if (outcome.result === 'LOCKED') {
      throw new ValidationFailed({ _: `비밀번호를 ${maxFail}회 틀려 계정이 잠겼습니다. 슈퍼관리자에게 잠금 해제를 요청하세요.` });
    }
    if (outcome.result === 'INVALID_CREDENTIALS') {
      throw new ValidationFailed({ _: `${INVALID} (남은 시도 ${outcome.remaining}회)` });
    }
  });
  if (result.ok) redirect('/admin');
  return result;
}

export async function logoutAction() {
  await (await getAuth()).signOut();
  redirect('/admin/login');
}
