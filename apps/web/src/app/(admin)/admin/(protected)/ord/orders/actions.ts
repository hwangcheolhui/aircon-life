'use server';
// A-ORD-020 주문 상세 서버 액션: 원문 열람(감사 로그) · F-ADM-ORD-03 수정 · F-ADM-ORD-04 취소(환불 연계). BR-102 거점 범위는 서비스에서 일괄 적용.
import { orderCancelInput, orderUpdateInput, z } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { cancelOrderByAdmin, revealOrderPii, updateOrder } from '@/server/admin-orders';
import { handle, parse } from '@/server/action-result';
import { writeAudit } from '@/server/audit';
import { requirePermission } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';

export async function viewOrderPii(orderId: number) {
  return handle(async () => {
    const admin = await requirePermission('A-ORD-020', 'UPDATE');
    const id = parse(z.number().int().min(1), orderId);
    const pii = await revealOrderPii(id, await currentBranchFilter(admin));
    await writeAudit({ actorId: admin.adminId, action: 'VIEW_PII', targetTable: 'service_order', targetId: id, detail: { fields: ['name', 'phone', 'detail_address'] } });
    return pii;
  });
}

export async function saveOrder(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-ORD-020', 'UPDATE');
    const v = parse(orderUpdateInput, values);
    await updateOrder(v, await currentBranchFilter(admin), { type: 'ADMIN', id: admin.adminId });
    revalidatePath(`/admin/ord/orders/${v.orderId}`);
  });
}

export async function cancelOrderAction(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-ORD-020', 'UPDATE');
    const v = parse(orderCancelInput, values);
    const r = await cancelOrderByAdmin(v.orderId, v.cancelReason, v.memo, await currentBranchFilter(admin), { type: 'ADMIN', id: admin.adminId });
    revalidatePath(`/admin/ord/orders/${v.orderId}`);
    return r;
  });
}
