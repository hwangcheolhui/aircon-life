'use server';
// 결제 관리 서버 액션 (단계 6): A-PAY-010 PG 대사 F-ADM-PAY-01 · A-PAY-020 결제 링크 재발송 F-ADM-PAY-02 · A-PAY-030 환불 F-ADM-PAY-03 ·
// A-PAY-040 미수금 메모·입금 확인·결제 링크 F-ADM-PAY-04 (BR-081) · A-PAY-050 증빙 발행·취소·원문 보기 F-ADM-PAY-05 (BR-100 감사 로그).
// 모든 액션 첫 줄에서 requirePermission(화면 ID, 행위), 거점 범위는 currentBranchFilter(BR-102).
import {
  adminCollectInput,
  receivableMemoInput,
  refundInput,
  resendPaymentLinkInput,
  taxDocActionInput,
  z,
} from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import {
  addReceivableMemo,
  adminCollect,
  createRefund,
  reconcilePayment,
  refundablePayments,
  resendPaymentLink,
  revealTaxIdentity,
  taxDocAction,
} from '@/server/payments';
import { siteOrigin } from '@/server/site-origin';

const idOf = (v: unknown) => parse(z.coerce.number().int().positive(), v);

/** F-ADM-PAY-01 PG 대사 (PG 서버 재조회) */
export async function reconcile(paymentId: number) {
  return handle(async () => {
    const admin = await requirePermission('A-PAY-010', 'READ');
    return reconcilePayment(idOf(paymentId), await currentBranchFilter(admin));
  });
}

/** F-ADM-PAY-02 결제 링크 다시 보내기 */
export async function resendLink(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-PAY-020', 'UPDATE');
    const v = parse(resendPaymentLinkInput, values);
    await resendPaymentLink(v.orderId, await currentBranchFilter(admin), await siteOrigin());
  });
}

/** F-ADM-PAY-03 환불 등록 창: 접수번호 → 승인 결제·환불 가능 금액 */
export async function findRefundable(orderNo: string) {
  return handle(async () => {
    const admin = await requirePermission('A-PAY-030', 'CREATE');
    return refundablePayments(parse(z.string().trim().min(1, '접수번호는 필수 입력값입니다.').max(20), orderNo), await currentBranchFilter(admin));
  });
}

/** F-ADM-PAY-03 환불 (PG 취소 또는 현장 결제 환불 기록) */
export async function saveRefund(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-PAY-030', 'CREATE');
    const v = parse(refundInput, values);
    await createRefund(v, await currentBranchFilter(admin), admin.adminId);
    revalidatePath('/admin/pay', 'layout');
  });
}

/** F-ADM-PAY-04 [미수금] 메모 */
export async function saveReceivableMemo(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-PAY-040', 'CREATE');
    const v = parse(receivableMemoInput, values);
    await addReceivableMemo(v, await currentBranchFilter(admin), admin.adminId);
    revalidatePath('/admin/pay/receivables');
  });
}

/** F-ADM-PAY-04 입금 확인 → 전액이면 주문 완료(BR-081 정산 대상) */
export async function confirmDeposit(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-PAY-040', 'UPDATE');
    const v = parse(adminCollectInput, values);
    await adminCollect(v, await currentBranchFilter(admin), admin.adminId);
    revalidatePath('/admin/pay', 'layout');
  });
}

/** F-ADM-PAY-04 미수 고객에게 결제 링크 */
export async function sendReceivableLink(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-PAY-040', 'UPDATE');
    const v = parse(resendPaymentLinkInput, values);
    await resendPaymentLink(v.orderId, await currentBranchFilter(admin), await siteOrigin());
  });
}

/** F-ADM-PAY-05 증빙 발행·취소 */
export async function actTaxDoc(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-PAY-050', 'UPDATE');
    const v = parse(taxDocActionInput, values);
    await taxDocAction(v, await currentBranchFilter(admin), admin.adminId);
    revalidatePath('/admin/pay/receipts');
  });
}

/** 증빙 번호 원문 보기 (감사 로그) */
export async function viewTaxIdentity(id: number) {
  return handle(async () => {
    const admin = await requirePermission('A-PAY-050', 'UPDATE');
    return revealTaxIdentity(idOf(id), await currentBranchFilter(admin), admin.adminId);
  });
}
