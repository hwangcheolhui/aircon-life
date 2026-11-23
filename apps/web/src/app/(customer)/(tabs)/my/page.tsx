// C-MY-010 내 정보 / 주소록 · F-CUS-MY-01 (본인 화면이라 원문 표시). 쿠폰함(C-MY-020)은 단계 9.
import { Alert, Card } from '@aircon/ui';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { loadCodes } from '@/server/codes';
import { requireCustomer } from '@/server/customer-session';
import { getCustomerProfile } from '@/server/customers';
import { logout } from './actions';
import { AddressList } from './address-list';

export const metadata = { title: '마이' };
export const dynamic = 'force-dynamic';

export default async function MyPage() {
  const me = await requireCustomer('/my');
  const profile = me.demo ? null : await getCustomerProfile(me.id);
  const codes = await loadCodes(['AUTH_PROVIDER', 'HOUSING_TYPE']);
  const provider = codes.AUTH_PROVIDER?.find((c) => c.value === profile?.authProvider)?.label;
  return (
    <main className="cus-page-body">
      <h1 className="ac-h2">마이</h1>
      {me.demo ? <Alert tone="warning">체험 고객으로 로그인했어요. 정보는 저장되지 않습니다.</Alert> : null}
      {profile ? (
        <Card>
          <dl className="cus-kv ac-body">
            <dt>이름</dt>
            <dd>{profile.name}</dd>
            <dt>휴대폰</dt>
            <dd className="ac-num">{profile.phone}</dd>
            <dt>고객번호</dt>
            <dd className="ac-num">{profile.customerNo}</dd>
            {provider ? (
              <>
                <dt>로그인</dt>
                <dd>{provider}</dd>
              </>
            ) : null}
          </dl>
        </Card>
      ) : null}
      {profile ? (
        <Card>
          <h2 className="ac-h3" style={{ marginTop: 0 }}>
            주소록
          </h2>
          <AddressList
            addresses={profile.addresses.map((a) => ({
              id: a.id,
              text: `${a.roadAddress} ${a.detailAddress ?? ''}`.trim(),
              isDefault: a.isDefault,
              housing: codes.HOUSING_TYPE?.find((c) => c.value === a.housingType)?.label ?? null,
            }))}
          />
        </Card>
      ) : null}
      <ul className="ac-list ac-card">
        {[
          { href: '/notifications', label: '알림함' },
          { href: '/cs', label: '고객센터' },
          { href: '/my/consents', label: '동의·알림 설정' },
          { href: '/my/withdraw', label: '회원 탈퇴' },
        ].map((l) => (
          <li key={l.href} className="ac-list-item">
            <Link href={l.href} className="ac-list-item__body ac-body" style={{ color: 'inherit', textDecoration: 'none' }}>
              {l.label}
            </Link>
            <ChevronRight aria-hidden />
          </li>
        ))}
      </ul>
      <form action={logout}>
        <button type="submit" className="ac-btn ac-btn--ghost ac-btn--block">
          로그아웃
        </button>
      </form>
    </main>
  );
}
