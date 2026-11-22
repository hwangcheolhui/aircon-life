'use server';
// A-SYS-040 공통 코드 · F-ADM-SYS-04
import { commonCodeInput } from '@aircon/contracts';
import { commonCode } from '@aircon/db';
import { deleteRow, saveRow } from '@/server/crud';

const cfg = { menu: 'A-SYS-040', table: commonCode, idColumn: commonCode.id, schema: commonCodeInput, hasAudit: false, path: '/admin/sys/codes' };
export async function saveCode(values: Record<string, string>, id: string | null) {
  return saveRow(cfg, values, id);
}
export async function deleteCode(id: string) {
  return deleteRow(cfg, id);
}
