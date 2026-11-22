'use server';
// 상단 거점 선택 (03 §4.1). 전체 범위 관리자만 바꿀 수 있고, 거점 소속자는 BR-102로 고정된다.
import { effectiveScope } from '@aircon/domain';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { getCurrentAdmin } from '@/server/auth';
// 거점 선택은 화면 필터용 쿠키만 바꾸므로 임시 개발 모드 열람자도 쓸 수 있다.
import { BRANCH_COOKIE } from '@/server/branch-selection';

export async function selectBranchAction(branchId: string) {
  const admin = await getCurrentAdmin();
  if (!admin || effectiveScope(admin).kind !== 'ALL') return;
  const store = await cookies();
  if (branchId) store.set(BRANCH_COOKIE, branchId, { httpOnly: true, sameSite: 'lax', path: '/admin' });
  else store.delete(BRANCH_COOKIE);
  revalidatePath('/admin', 'layout');
}
