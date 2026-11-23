// C-AUTH-030 휴대폰 인증 · F-CUS-AUTH-02(비회원 → 예약 단계 인증 후 회원 생성) · F-CUS-AUTH-04(기존 전화고객 연동)
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { identityDriver, pendingSocial } from '@/server/customer-auth';
import { safeNext } from '@/server/customer-session';
import { loadCodes } from '@/server/codes';
import { PhoneForm } from './phone-form';

export const metadata = { title: '휴대폰 인증' };
export const dynamic = 'force-dynamic';

export default async function PhonePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  const social = await pendingSocial();
  const codes = social ? await loadCodes(['AUTH_PROVIDER']) : null;
  const socialName = social ? (codes?.AUTH_PROVIDER?.find((c) => c.value === social)?.label ?? social) : null;
  const driver = identityDriver();
  return (
    <>
      <div className="cus-topbar">
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="ac-btn ac-btn--ghost ac-btn--icon" aria-label="이전">
          <ChevronLeft aria-hidden />
        </Link>
      </div>
      <h1 className="ac-h2">휴대폰 번호를 인증해 주세요</h1>
      <p className="ac-body">
        {socialName ? `${socialName} 로그인을 확인했어요. ` : ''}
        예약 안내를 받을 번호예요. 전화로 예약한 적이 있는 번호라면 이전 예약 이력이 그대로 이어져요.
      </p>
      <PhoneForm
        next={next}
        driver={driver}
        portone={
          driver === 'portone'
            ? { storeId: process.env.PORTONE_STORE_ID ?? '', channelKey: process.env.PORTONE_IDENTITY_CHANNEL_KEY ?? '' }
            : null
        }
      />
    </>
  );
}
