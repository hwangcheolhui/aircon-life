// T-AUTH-010 기사 로그인 · F-TEC-AUTH-01: 휴대폰 번호 + 비밀번호 또는 인증번호(OTP), 상태 ACTIVE·TRAINING만
import { Alert } from '@aircon/ui';
import { redirect } from 'next/navigation';
import { identityAutoVerify, identityDriver } from '@/server/customer-auth';
import { isDbConfigured } from '@/server/db';
import { getCurrentTech } from '@/server/tech-session';
import { TechLoginForm } from './login-form';

export const metadata = { title: '기사 로그인' };
export const dynamic = 'force-dynamic';

export default async function TechLoginPage() {
  if (await getCurrentTech()) redirect('/tech');
  const db = isDbConfigured();
  return (
    <main className="tec-page">
      <div className="tec-page__body tec-login">
        <section className="tec-section">
          <h1 className="ac-h1">기사 로그인</h1>
          <p className="ac-body ac-caption">거점에 등록한 휴대폰 번호로 로그인하세요.</p>
        </section>
        {db ? (
          <TechLoginForm driver={identityDriver()} autoVerify={identityAutoVerify()} portone={
              identityDriver() === 'portone' ? { storeId: process.env.PORTONE_STORE_ID ?? '', channelKey: process.env.PORTONE_IDENTITY_CHANNEL_KEY ?? '' } : null
            } />
        ) : (
          <Alert tone="warning">기사 앱은 데이터베이스를 연결한 뒤 사용할 수 있습니다.</Alert>
        )}
      </div>
    </main>
  );
}
