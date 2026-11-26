'use server';
// C-CS-020 1:1 문의 서버 액션 · F-CUS-CS-02: 상담(consultation) 채널 APP_CHAT·유형 INQUIRY·상태 OPEN 으로 등록
import { customerInquiryInput } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { UserError, handle, parse } from '@/server/action-result';
import { getCurrentCustomer } from '@/server/customer-session';
import { createCustomerInquiry } from '@/server/inquiries';

export async function submitInquiry(values: Record<string, unknown>) {
  return handle(async () => {
    const c = await getCurrentCustomer();
    if (!c || c.demo) throw new UserError('로그인이 필요합니다.');
    const v = parse(customerInquiryInput, values);
    await createCustomerInquiry(c.id, v);
    revalidatePath('/cs/inquiries');
  });
}
