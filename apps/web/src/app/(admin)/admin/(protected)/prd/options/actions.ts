'use server';
// A-PRD-040 옵션·자재 마스터 · F-ADM-PRD-04
import { materialInput, serviceOptionInput } from '@aircon/contracts';
import { material, serviceOption } from '@aircon/db';
import { deleteRow, saveRow } from '@/server/crud';

const optionCfg = { menu: 'A-PRD-040', table: serviceOption, idColumn: serviceOption.id, schema: serviceOptionInput, path: '/admin/prd/options' };
const materialCfg = { menu: 'A-PRD-040', table: material, idColumn: material.id, schema: materialInput, path: '/admin/prd/options' };

export async function saveOption(values: Record<string, string>, id: string | null) {
  return saveRow(optionCfg, values, id);
}
export async function deleteOption(id: string) {
  return deleteRow(optionCfg, id);
}
export async function saveMaterial(values: Record<string, string>, id: string | null) {
  return saveRow(materialCfg, values, id);
}
export async function deleteMaterial(id: string) {
  return deleteRow(materialCfg, id);
}
