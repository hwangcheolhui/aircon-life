import 'server-only';
import { resolveBranchFilter } from '@aircon/domain';
import { cookies } from 'next/headers';
import type { CurrentAdmin } from './auth';

export const BRANCH_COOKIE = 'ac_branch';

/** 상단 거점 선택(03 §4.1) + BR-102 실효 필터 */
export async function currentBranchFilter(admin: CurrentAdmin) {
  const raw = (await cookies()).get(BRANCH_COOKIE)?.value;
  const requested = raw ? Number(raw) : null;
  return resolveBranchFilter(admin, Number.isFinite(requested) ? requested : null);
}
