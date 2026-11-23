// C-MY-040 회원 탈퇴 · F-CUS-AUTH-05: 유의사항, 사유. 진행 중 예약이 있으면 탈퇴할 수 없다.
import { SETTING_KEYS } from '@aircon/domain';
import { requireCustomer } from '@/server/customer-session';
import { getSettingNumber } from '@/server/settings';
import { WithdrawForm } from './withdraw-form';

export const metadata = { title: '회원 탈퇴' };
export const dynamic = 'force-dynamic';

export default async function WithdrawPage() {
  const me = await requireCustomer('/my/withdraw');
  const years = await getSettingNumber(SETTING_KEYS.PURGE_YEARS);
  return (
    <main className="cus-page-body">
      <h1 className="ac-h2">회원 탈퇴</h1>
      <ul className="cus-plain-list ac-body-sm">
        <li>진행 중인 예약이 있으면 탈퇴할 수 없어요. 예약을 취소하거나 완료된 뒤 탈퇴해 주세요.</li>
        <li>
          거래 기록은 관련 법령에 따라 <span className="ac-num">{years}</span>년 보관한 뒤 파기해요.
        </li>
        <li>탈퇴하면 마케팅 수신 동의는 바로 철회되고, 같은 번호로 다시 가입할 수 있어요.</li>
      </ul>
      <WithdrawForm demo={me.demo} />
    </main>
  );
}
