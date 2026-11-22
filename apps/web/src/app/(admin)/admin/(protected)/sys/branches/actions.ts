'use server';
// A-SYS-030 거점 관리 · F-ADM-SYS-03
import { branchInput } from '@aircon/contracts';
import { branch } from '@aircon/db';
import { deleteRow, saveRow } from '@/server/crud';

const cfg = { menu: 'A-SYS-030', table: branch, idColumn: branch.id, schema: branchInput, softDelete: true, path: '/admin/sys/branches' };

export async function saveBranch(values: Record<string, string>, id: string | null) {
  return saveRow(cfg, values, id);
}
export async function deleteBranch(id: string) {
  return deleteRow(cfg, id);
}
