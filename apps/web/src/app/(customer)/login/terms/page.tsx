// C-AUTH-020 약관 동의 · F-CUS-AUTH-03: 전체 동의, 필수(이용약관·개인정보)·선택(위치·마케팅 문자·마케팅 푸시)
import { CONSENT_ITEMS, SETTING_KEYS } from '@aircon/domain';
import { redirect } from 'next/navigation';
import { hasVerifiedSignup } from '@/server/customer-auth';
import { safeNext } from '@/server/customer-session';
import { loadCodes } from '@/server/codes';
import { getSettingString } from '@/server/settings';
import { TermsForm } from './terms-form';

export const metadata = { title: '약관 동의' };
export const dynamic = 'force-dynamic';

export default async function TermsPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (!(await hasVerifiedSignup())) redirect(`/login/phone?next=${encodeURIComponent(next)}`);
  const [codes, version] = await Promise.all([loadCodes(['CONSENT_TYPE']), getSettingString(SETTING_KEYS.TERMS_VERSION)]);
  const items = CONSENT_ITEMS.map((c) => ({
    type: c.type,
    required: c.required,
    label: codes.CONSENT_TYPE?.find((x) => x.value === c.type)?.label ?? c.type,
  }));
  return (
    <>
      <h1 className="ac-h2">약관에 동의해 주세요</h1>
      <p className="ac-caption">약관 버전 {version}</p>
      <TermsForm items={items} next={next} />
    </>
  );
}
