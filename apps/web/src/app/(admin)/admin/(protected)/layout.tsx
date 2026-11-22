// 관리자 공통 레이아웃 (03 §4.1): GNB / LNB / 거점 선택. 로그인한 관리자만 진입(requireAdmin). 임시 개발 모드면 읽기 전용 열람자.
import { branch } from '@aircon/db';
import { effectiveScope, visibleAdminMenu } from '@aircon/domain';
import { asc, isNull } from 'drizzle-orm';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { AdminShell } from '@/admin/admin-shell';
import { ADMIN_ROUTES } from '@/admin/routes';
import { requireAdmin } from '@/server/auth';
import { BRANCH_COOKIE } from '@/server/branch-selection';
import { getDb } from '@/server/db';

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();
  const menu = visibleAdminMenu(admin).map((g) => ({
    key: g.key,
    name: g.name,
    screens: g.screens.map((s) => ({ screenId: s.screenId, name: s.name, section: s.section, href: ADMIN_ROUTES[s.screenId] ?? '/admin' })),
  }));
  const scope = effectiveScope(admin);
  const branches =
    scope.kind === 'ALL'
      ? await getDb().select({ id: branch.id, name: branch.name }).from(branch).where(isNull(branch.deletedAt)).orderBy(asc(branch.name))
      : [];
  const selected = (await cookies()).get(BRANCH_COOKIE)?.value ?? '';
  return (
    <AdminShell
      menu={menu}
      user={{ name: admin.name, roleName: admin.roleName }}
      previewMode={admin.preview}
      branchSelector={scope.kind === 'ALL' ? { branches, selected } : { fixed: admin.branchName ?? '소속 거점 없음' }}
    >
      {children}
    </AdminShell>
  );
}
