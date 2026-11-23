'use server';
// A-CNT-050 상담 스크립트 관리 · F-ADM-CNT-05. 상담 콘솔(A-CSL-010)이 사용 시점(SCRIPT_TRIGGER)별로 읽는다.
import { consultScriptInput } from '@aircon/contracts';
import { CONSULT_SCRIPT_SEED, consultScript } from '@aircon/db';
import { eq } from 'drizzle-orm';
import { UserError } from '@/server/action-result';
import { deleteRow, saveRow } from '@/server/crud';
import { getDb } from '@/server/db';

const SYSTEM_CODES = new Set(CONSULT_SCRIPT_SEED.map((s) => s.scriptCode));

const cfg = {
  menu: 'A-CNT-050',
  table: consultScript,
  idColumn: consultScript.id,
  schema: consultScriptInput,
  path: '/admin/cnt/scripts',
  checkDelete: async (id: string) => {
    const [row] = await getDb().select({ code: consultScript.scriptCode }).from(consultScript).where(eq(consultScript.id, Number(id)));
    if (row && SYSTEM_CODES.has(row.code)) throw new UserError('기본 멘트는 삭제할 수 없습니다. 사용 안 함으로 바꿔 주세요.');
  },
};

export async function saveScript(values: Record<string, string>, id: string | null) {
  return saveRow(cfg, values, id);
}
export async function deleteScript(id: string) {
  return deleteRow(cfg, id);
}
