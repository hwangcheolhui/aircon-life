// C-MY-030 동의·알림 설정 · F-CUS-AUTH-03: 선택 동의(위치·마케팅 문자·마케팅 푸시) 토글. 필수 동의 철회는 회원 탈퇴(C-MY-040).
import { OPTIONAL_CONSENTS } from '@aircon/domain';
import { loadCodes } from '@/server/codes';
import { requireCustomer } from '@/server/customer-session';
import { getConsents } from '@/server/customers';
import { ConsentForm } from './consent-form';

export const metadata = { title: '동의·알림 설정' };
export const dynamic = 'force-dynamic';

export default async function ConsentsPage() {
  const me = await requireCustomer('/my/consents');
  const [state, codes] = await Promise.all([me.demo ? Promise.resolve({}) : getConsents(me.id), loadCodes(['CONSENT_TYPE'])]);
  const items = OPTIONAL_CONSENTS.filter((t) => t !== 'PRIVACY_OPTIONAL' && t !== 'THIRD_PARTY').map((t) => ({
    type: t,
    label: codes.CONSENT_TYPE?.find((c) => c.value === t)?.label ?? t,
    on: Boolean((state as Record<string, boolean>)[t]),
  }));
  return (
    <main className="cus-page-body">
      <h1 className="ac-h2">동의·알림 설정</h1>
      <p className="ac-body-sm">예약·방문 안내 같은 서비스 알림은 설정과 관계없이 보내 드려요.</p>
      <ConsentForm items={items} demo={me.demo} />
    </main>
  );
}
