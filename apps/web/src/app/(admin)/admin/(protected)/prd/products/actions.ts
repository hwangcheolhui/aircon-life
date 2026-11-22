'use server';
// A-PRD-011 상품 관리 · F-ADM-PRD-01
import { serviceProductInput } from '@aircon/contracts';
import { serviceProduct } from '@aircon/db';
import { deleteRow, saveRow } from '@/server/crud';

const cfg = { menu: 'A-PRD-011', table: serviceProduct, idColumn: serviceProduct.id, schema: serviceProductInput, softDelete: true, path: '/admin/prd/products' };
export async function saveProduct(values: Record<string, string>, id: string | null) {
  return saveRow(cfg, values, id);
}
export async function deleteProduct(id: string) {
  return deleteRow(cfg, id);
}
