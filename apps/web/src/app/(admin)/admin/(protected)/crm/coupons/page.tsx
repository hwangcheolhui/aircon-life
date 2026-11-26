// A-CRM-030 쿠폰 관리 · F-ADM-CRM-03: 쿠폰 등록(정액·정률·최대 할인·최소 주문·기간·발급 한도·대상 카테고리), 발급(고객번호 개별·마케팅 동의 고객 일괄), 사용 현황.
// 같은 쿠폰은 고객 1명당 1장, 1주문 1쿠폰. 발급 안내 알림은 마케팅 동의 고객에게만(BR-091·101).
import { branch, serviceCategory } from '@aircon/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { requireScreen } from '@/server/auth';
import { listCoupons } from '@/server/coupons';
import { screenFlags } from '@/server/crud';
import { getDb } from '@/server/db';
import { CouponsScreen } from './screen';

export const dynamic = 'force-dynamic';

export default async function CouponsPage() {
  const admin = await requireScreen('A-CRM-030');
  const db = getDb();
  const [rows, categories, branches] = await Promise.all([
    listCoupons(),
    db.select({ id: serviceCategory.id, name: serviceCategory.name }).from(serviceCategory).orderBy(asc(serviceCategory.sortOrder)),
    db.select({ id: branch.id, name: branch.name }).from(branch).where(and(eq(branch.status, 'ACTIVE'), isNull(branch.deletedAt))).orderBy(asc(branch.name)),
  ]);
  const flags = screenFlags(admin, 'A-CRM-030');
  const live = !admin.preview;
  return (
    <CouponsScreen
      rows={rows}
      categories={categories.map((c) => ({ value: String(c.id), label: c.name }))}
      branches={branches.map((b) => ({ value: String(b.id), label: b.name }))}
      canCreate={live && flags.canCreate}
      canUpdate={live && flags.canUpdate}
      canDelete={live && flags.canDelete}
    />
  );
}
