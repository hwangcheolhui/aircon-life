// C-MY-020 쿠폰함 (단계 9) · F-CUS-CPN-01: 보유·사용·만료 탭, 코드 등록
import { Alert } from '@aircon/ui';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { listMyCoupons } from '@/server/coupons';
import { requireCustomer } from '@/server/customer-session';
import { CouponBox } from './coupon-box';

export const metadata = { title: '쿠폰함' };
export const dynamic = 'force-dynamic';

export default async function MyCouponsPage() {
  const me = await requireCustomer('/my/coupons');
  const coupons = me.demo ? [] : await listMyCoupons(me.id);
  return (
    <main className="cus-page-body">
      <div className="cus-topbar">
        <Link href="/my" className="ac-btn ac-btn--ghost ac-btn--icon" aria-label="마이">
          <ChevronLeft aria-hidden />
        </Link>
      </div>
      <h1 className="ac-h2">쿠폰함</h1>
      {me.demo ? <Alert tone="warning">체험 고객은 쿠폰을 받을 수 없어요.</Alert> : null}
      <CouponBox coupons={coupons} canRegister={!me.demo} />
    </main>
  );
}
