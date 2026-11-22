'use server';
// A-PRD-030 할증·추가요금 규칙 · F-ADM-PRD-03 (BR-011~013 금액·조건은 이 테이블에서 관리)
import { surchargeRuleInput } from '@aircon/contracts';
import { surchargeRule } from '@aircon/db';
import { deleteRow, saveRow } from '@/server/crud';

const cfg = { menu: 'A-PRD-030', table: surchargeRule, idColumn: surchargeRule.id, schema: surchargeRuleInput, path: '/admin/prd/surcharges' };
export async function saveSurcharge(values: Record<string, string>, id: string | null) {
  return saveRow(cfg, values, id);
}
export async function deleteSurcharge(id: string) {
  return deleteRow(cfg, id);
}
