'use server';
// A-PRD-010 카테고리 관리 · F-ADM-PRD-01
import { serviceCategoryInput } from '@aircon/contracts';
import { serviceCategory } from '@aircon/db';
import { deleteRow, saveRow } from '@/server/crud';

const cfg = { menu: 'A-PRD-010', table: serviceCategory, idColumn: serviceCategory.id, schema: serviceCategoryInput, hasAudit: false, path: '/admin/prd/categories' };
export async function saveCategory(values: Record<string, string>, id: string | null) {
  return saveRow(cfg, values, id);
}
export async function deleteCategory(id: string) {
  return deleteRow(cfg, id);
}
