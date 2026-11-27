'use server';
// A-CRM-030 쿠폰 관리 서버 액션 · F-ADM-CRM-03: 등록·수정·삭제(발급 전만)·발급
import { couponInput, couponIssueInput, z } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { deleteCoupon, issueCoupons, saveCoupon } from '@/server/coupons';

export async function saveCouponAction(values: Record<string, string>, id: string | null) {
  return handle(async () => {
    const admin = await requirePermission('A-CRM-030', id ? 'UPDATE' : 'CREATE');
    const v = parse(couponInput, { ...values, id: id ?? '' });
    await saveCoupon(v, { type: 'ADMIN', id: admin.adminId });
    revalidatePath('/admin/crm/coupons');
  });
}

export async function deleteCouponAction(id: string) {
  return handle(async () => {
    const admin = await requirePermission('A-CRM-030', 'DELETE');
    await deleteCoupon(parse(z.coerce.number().int().positive(), id), { type: 'ADMIN', id: admin.adminId });
    revalidatePath('/admin/crm/coupons');
  });
}

export async function issueCouponAction(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-CRM-030', 'CREATE');
    const v = parse(couponIssueInput, values);
    const r = await issueCoupons(v, { type: 'ADMIN', id: admin.adminId });
    revalidatePath('/admin/crm/coupons');
    return r;
  });
}
