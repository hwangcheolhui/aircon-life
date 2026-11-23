'use server';
// A-ORD-040 수동 주문 등록 · F-ADM-ORD-06: 고객 검색/등록 → 공용 견적 모듈 금액 → 슬롯 차감(BR-021) → 접수 알림. 중복 접수 경고(BR-020).
import { customerQuoteInput, manualOrderInput, phoneInput } from '@aircon/contracts';
import { maskName, quoteFailureMessage } from '@aircon/domain';
import { revalidatePath } from 'next/cache';
import { createManualOrder } from '@/server/admin-orders';
import { UserError, handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { findCustomerByPhone, getCustomerContact } from '@/server/customers';
import { findDuplicateReservations } from '@/server/orders';
import { computeQuote } from '@/server/quote';
import { getAvailability } from '@/server/slots';

const MENU = 'A-ORD-040';

/** 연락처로 기존 고객 찾기 (이름은 마스킹) */
export async function lookupCustomer(phone: string) {
  return handle(async () => {
    await requirePermission(MENU, 'CREATE');
    const p = parse(phoneInput('연락처'), phone);
    const c = await findCustomerByPhone(p);
    if (!c) return null;
    const contact = await getCustomerContact(c.id);
    return { id: c.id, nameMasked: maskName(contact?.name) };
  });
}

/** 금액·소요시간 미리보기 + 예약 가능 시각 */
export async function previewManual(values: unknown, customerType: 'PERSONAL' | 'BUSINESS') {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'CREATE');
    const q = parse(customerQuoteInput, values);
    const r = await computeQuote({ ...q, customerType, visit: null });
    if (!r.ok) throw new UserError(quoteFailureMessage(r));
    const filter = await currentBranchFilter(admin);
    if (filter.kind === 'NONE' || (filter.kind === 'BRANCH' && filter.branchId !== r.branchId)) throw new UserError('다른 거점 관할 주소는 접수할 수 없습니다.');
    const days = await getAvailability({ branchId: r.branchId, durationMin: r.estimatedDurationMin });
    return { totalAmount: r.totalAmount, durationMin: r.estimatedDurationMin, days };
  });
}

export async function submitManual(values: unknown) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'CREATE');
    const v = parse(manualOrderInput, values);
    if (!v.duplicateConfirmed) {
      const dup = await findDuplicateReservations({
        customerId: v.customerId,
        phone: v.phone,
        roadAddress: v.address.roadAddress,
        detailAddress: v.detailAddress,
      });
      if (dup.length) return { ok: false as const, duplicates: dup.map((d) => d.orderNo) };
    }
    const r = await createManualOrder(v, await currentBranchFilter(admin), { type: 'ADMIN', id: admin.adminId });
    revalidatePath('/admin/ord/orders');
    return { ok: true as const, id: r.id };
  });
}

export type ManualPreview = { totalAmount: number; durationMin: number; days: { date: string; hours: { hour: number; label: string; surcharge: string | null }[] }[] };
