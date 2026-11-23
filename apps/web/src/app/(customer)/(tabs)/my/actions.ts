'use server';
// C-MY-010·030·040 마이 서버 액션 (F-CUS-MY-01, F-CUS-AUTH-03·05)
import { consentSettingInput, withdrawInput, z } from '@aircon/contracts';
import { redirect } from 'next/navigation';
import { UserError, handle, parse } from '@/server/action-result';
import { endCustomerSession, getCurrentCustomer } from '@/server/customer-session';
import { deleteAddress, updateConsents, withdrawCustomer } from '@/server/customers';

async function me() {
  const c = await getCurrentCustomer();
  if (!c) throw new UserError('로그인이 필요합니다.');
  if (c.demo) throw new UserError('체험 모드에서는 저장하지 않습니다.');
  return c;
}

export async function logout() {
  await endCustomerSession();
  redirect('/');
}

/** C-MY-010 주소록 삭제 */
export async function removeAddress(addressId: number) {
  return handle(async () => {
    const c = await me();
    await deleteAddress(c.id, parse(z.number().int().min(1), addressId));
  });
}

/** C-MY-030 선택 동의 변경 (BR-101 즉시 반영) */
export async function saveConsents(values: Record<string, boolean>) {
  return handle(async () => {
    const c = await me();
    await updateConsents(c.id, parse(consentSettingInput, values));
  });
}

/** C-MY-040 회원 탈퇴 (진행 중 주문이 없을 때만) */
export async function withdraw(values: Record<string, unknown>) {
  return handle(async () => {
    const c = await me();
    const v = parse(withdrawInput, values);
    await withdrawCustomer(c.id, v.reason);
    await endCustomerSession();
  });
}
