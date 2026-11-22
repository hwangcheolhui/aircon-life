'use server';
// A-PRD-020 가격 정책 · F-ADM-PRD-02 (적용 예정 가격 미리보기: BR-010 단가 선택 규칙)
import { pricePolicyInput, pricePreviewInput } from '@aircon/contracts';
import { pricePolicy } from '@aircon/db';
import { selectPricePolicy } from '@aircon/domain';
import { eq } from 'drizzle-orm';
import { handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { deleteRow, saveRow } from '@/server/crud';
import { getDb } from '@/server/db';

const cfg = { menu: 'A-PRD-020', table: pricePolicy, idColumn: pricePolicy.id, schema: pricePolicyInput, path: '/admin/prd/prices' };
export async function savePrice(values: Record<string, string>, id: string | null) {
  return saveRow(cfg, values, id);
}
export async function deletePrice(id: string) {
  return deleteRow(cfg, id);
}

export async function previewPrice(values: Record<string, string>) {
  return handle(async () => {
    await requirePermission('A-PRD-020', 'READ');
    const q = parse(pricePreviewInput, values);
    const policies = await getDb().select().from(pricePolicy).where(eq(pricePolicy.productId, q.productId));
    const picked = selectPricePolicy(
      policies.map((p) => ({ ...p, customerType: p.customerType as 'PERSONAL' | 'BUSINESS' | null })),
      q,
    );
    return picked ? { policyId: picked.id, unitPrice: picked.unitPrice, tiers: picked.multiUnitDiscountJson ?? [] } : null;
  });
}
