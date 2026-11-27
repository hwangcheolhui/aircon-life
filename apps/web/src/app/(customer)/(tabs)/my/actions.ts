'use server';
// C-MY-010·030·040 마이 서버 액션 (F-CUS-MY-01, F-CUS-AUTH-03·05)
// 단계 9: C-DEV-010·020 내 기기·원클릭 재예약(F-CUS-DEV-01·02), C-MY-020 쿠폰 코드 등록(F-CUS-CPN-01)
import { consentSettingInput, couponCodeInput, customerDeviceInput, rebookInput, withdrawInput, z } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { registerCouponCode } from '@/server/coupons';
import { deleteMyDevice, rebookDevices, saveMyDevice } from '@/server/devices';
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

/* ---------- 단계 9 ---------- */

/** C-DEV-020 기기 등록·수정 (F-CUS-DEV-01) */
export async function saveDevice(values: Record<string, unknown>) {
  return handle(async () => {
    const c = await me();
    const v = parse(customerDeviceInput, values);
    const id = await saveMyDevice(c.id, { ...v, id: v.id ?? null });
    revalidatePath('/my/devices');
    return { id };
  });
}

export async function removeDevice(id: number) {
  return handle(async () => {
    const c = await me();
    await deleteMyDevice(c.id, parse(z.number().int().min(1), id));
    revalidatePath('/my/devices');
  });
}

/** C-DEV-010 [다시 예약] (F-CUS-DEV-02): 이전 조건으로 견적 발행 → 예약 화면 경로 */
export async function rebook(values: Record<string, unknown>) {
  return handle(async () => {
    const c = await me();
    const v = parse(rebookInput, values);
    const r = await rebookDevices(c.id, v.deviceIds);
    return { path: `/reserve/${r.quoteNo}`, skipped: r.skipped.length };
  });
}

/** C-MY-020 쿠폰 코드 등록 */
export async function registerCoupon(values: Record<string, unknown>) {
  return handle(async () => {
    const c = await me();
    const v = parse(couponCodeInput, values);
    const r = await registerCouponCode(c.id, v.code);
    revalidatePath('/my/coupons');
    return r;
  });
}
