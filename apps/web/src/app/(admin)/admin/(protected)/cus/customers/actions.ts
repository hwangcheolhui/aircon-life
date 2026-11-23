'use server';
/**
 * A-CUS-020 고객 상세 서버 액션 (F-ADM-CUS-02·03).
 * 첫 줄에서 화면 권한을 서버가 확인하고, 거점 범위(BR-102)는 서비스(server/admin-customers)에서 적용한다.
 */
import { customerGradeInput, customerMemoInput, z } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { revealCustomerPii, updateCustomerMemo, updateGradeTags } from '@/server/admin-customers';
import { writeAudit } from '@/server/audit';
import { type CurrentAdmin, requirePermission } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';

const MENU = 'A-CUS-020';
const actorOf = (a: CurrentAdmin) => ({ type: 'ADMIN' as const, id: a.adminId });
const customerId = z.coerce.number().int().min(1);

/** [보기] 원문 열람 — 감사 로그(VIEW_PII) 기록 (BR-100) */
export async function viewCustomerPii(id: number) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'UPDATE');
    const cid = parse(customerId, id);
    const pii = await revealCustomerPii(cid, await currentBranchFilter(admin));
    await writeAudit({ actorId: admin.adminId, action: 'VIEW_PII', targetTable: 'customer', targetId: cid, detail: { screen: MENU, fields: ['name', 'phone1', 'phone2', 'detail_address'] } });
    return pii;
  });
}

/** F-ADM-CUS-03 등급·태그 지정 */
export async function saveGradeTags(input: unknown) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'UPDATE');
    const data = parse(customerGradeInput, input);
    await updateGradeTags(data, await currentBranchFilter(admin), actorOf(admin));
    revalidatePath(`/admin/cus/customers/${data.customerId}`);
  });
}

/** 상담원 공유 내부 메모 */
export async function saveMemo(input: unknown) {
  return handle(async () => {
    const admin = await requirePermission(MENU, 'UPDATE');
    const data = parse(customerMemoInput, input);
    await updateCustomerMemo(data, await currentBranchFilter(admin), actorOf(admin));
    revalidatePath(`/admin/cus/customers/${data.customerId}`);
  });
}
