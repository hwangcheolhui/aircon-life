import 'server-only';
import { COMMON_CODE_SEED, commonCode } from '@aircon/db';
import { asc, inArray } from 'drizzle-orm';
import { getDb, isDbConfigured } from './db';

export type CodeOption = { value: string; label: string };
export type CodeMap = Record<string, CodeOption[]>;

/** 공통 코드 → 화면 표시명 (표시명을 코드에 하드코딩하지 않는다) */
export async function loadCodes(groups: string[]): Promise<CodeMap> {
  // DB 미연결이면 시드(01_ERD §4)로 표시명을 보여 준다
  if (!isDbConfigured()) {
    const map: CodeMap = Object.fromEntries(groups.map((g) => [g, []]));
    for (const r of COMMON_CODE_SEED) map[r.groupCode]?.push({ value: r.code, label: r.name });
    return map;
  }
  const rows = await getDb()
    .select()
    .from(commonCode)
    .where(inArray(commonCode.groupCode, groups))
    .orderBy(asc(commonCode.groupCode), asc(commonCode.sortOrder));
  const map: CodeMap = Object.fromEntries(groups.map((g) => [g, []]));
  for (const r of rows) if (r.isActive) map[r.groupCode]!.push({ value: r.code, label: r.name });
  return map;
}
