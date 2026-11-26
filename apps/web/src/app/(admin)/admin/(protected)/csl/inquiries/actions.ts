'use server';
// A-CSL-080 1:1 문의 관리 서버 액션 (F-CUS-CS-02 연계): 답변(→ 완료 + 고객 알림), 불만 문의 VOC 전환(F-ADM-VOC-01), FAQ 전환(F-ADM-CNT-02).
// 첫 줄 requirePermission, 거점 범위 currentBranchFilter(BR-102)
import { inquiryRefInput, inquiryReplyInput } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { type CurrentAdmin, requirePermission } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { inquiryToFaq, inquiryToVoc, replyInquiry } from '@/server/inquiries';

const actorOf = (a: CurrentAdmin) => ({ type: 'ADMIN' as const, id: a.adminId });

export async function replyInquiryAction(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-CSL-080', 'UPDATE');
    const v = parse(inquiryReplyInput, values);
    await replyInquiry(v, await currentBranchFilter(admin), actorOf(admin));
    revalidatePath('/admin/csl/inquiries');
  });
}

export async function inquiryToVocAction(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-VOC-010', 'CREATE');
    const v = parse(inquiryRefInput, values);
    const r = await inquiryToVoc(v.id, await currentBranchFilter(admin), actorOf(admin));
    revalidatePath('/admin/voc/vocs');
    return r;
  });
}

export async function inquiryToFaqAction(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-CNT-020', 'CREATE');
    const v = parse(inquiryRefInput, values);
    const r = await inquiryToFaq(v.id, await currentBranchFilter(admin), actorOf(admin));
    revalidatePath('/admin/cnt/faqs');
    return r;
  });
}
