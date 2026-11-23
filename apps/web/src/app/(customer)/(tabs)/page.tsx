// C-HOM-010 홈 · F-CUS-HOM-01: 견적 받기 CTA, 진행 중 예약 카드(→ C-ORD-020), 알림 아이콘(→ C-NTF-010), 로그인 진입(C-AUTH-010)
import { Card, StatusBadge } from '@aircon/ui';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { formatVisit } from '@/customer/format';
import { getCurrentCustomer } from '@/server/customer-session';
import { nextActiveOrder } from '@/server/orders';

export const dynamic = 'force-dynamic';

export default async function CustomerHome() {
  const me = await getCurrentCustomer();
  const active = me && !me.demo ? await nextActiveOrder(me.id) : null;
  return (
    <main className="cus-page-body">
      <div className="cus-topbar">
        <span className="ac-h3">에어컨 청소</span>
        <div className="cus-topbar__actions">
          {me ? (
            <Link href="/notifications" className="ac-btn ac-btn--ghost ac-btn--icon" aria-label="알림함">
              <Bell aria-hidden />
            </Link>
          ) : (
            <Link href="/login" className="ac-btn ac-btn--ghost ac-btn--sm">
              로그인
            </Link>
          )}
        </div>
      </div>

      {active ? (
        <Link href={`/orders/${active.orderNo}`} className="ac-card cus-order-card">
          <div className="cus-order-card__head">
            <StatusBadge code={active.status} audience="customer" />
            <span className="ac-caption ac-num">{active.orderNo}</span>
          </div>
          <strong className="ac-body-lg">진행 중인 예약</strong>
          {active.promisedAt ? <span className="ac-body ac-num">{formatVisit(active.promisedAt)} 방문 예정</span> : null}
        </Link>
      ) : null}

      <section className="cus-home-hero">
        <h1 className="ac-display">에어컨 청소, 표준 가격으로</h1>
        <p className="ac-body-lg">위치와 기기, 대수만 고르면 로그인 없이 바로 견적을 알려 드려요.</p>
        <div>
          <Link href="/quote" className="ac-btn ac-btn--primary ac-btn--xl">
            견적 받기
          </Link>
        </div>
      </section>

      <Card>
        <h2 className="ac-h3" style={{ marginTop: 0 }}>
          이렇게 진행돼요
        </h2>
        <ol className="cus-plain-list ac-body-sm">
          <li>견적 받기: 기기와 대수로 표준 가격을 바로 확인해요.</li>
          <li>예약하기: 휴대폰 인증 후 원하는 날짜·시간을 골라요.</li>
          <li>방문 청소: 기사님이 약속한 시간에 방문해요. 추가요금은 동의한 경우에만 청구돼요.</li>
        </ol>
      </Card>
    </main>
  );
}
