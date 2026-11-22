// 관리자 홈: 권한 있는 첫 화면으로 이동 (운영 대시보드 A-DSH-010은 단계 8)
import { visibleAdminMenu } from '@aircon/domain';
import { Alert } from '@aircon/ui';
import { redirect } from 'next/navigation';
import { ADMIN_ROUTES } from '@/admin/routes';
import { requireAdmin } from '@/server/auth';

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const admin = await requireAdmin();
  const { denied } = await searchParams;
  const first = visibleAdminMenu(admin)[0]?.screens[0];
  if (first && !denied) redirect(ADMIN_ROUTES[first.screenId] ?? '/admin');
  return (
    <div className="ac-stack">
      <h1 className="ac-h2">관리자</h1>
      {denied ? <Alert tone="warning">{`${denied} 화면을 볼 권한이 없습니다.`}</Alert> : null}
      {!first ? <Alert>사용할 수 있는 메뉴가 없습니다. 슈퍼관리자에게 권한을 요청하세요.</Alert> : null}
    </div>
  );
}
