import 'server-only';
import { systemSetting } from '@aircon/db';
import { eq } from 'drizzle-orm';
import { getDb } from './db';

/** 기준값은 system_setting에서 읽는다 (CLAUDE.md §5) */
export async function getSettingNumber(key: string): Promise<number> {
  const [row] = await getDb().select().from(systemSetting).where(eq(systemSetting.settingKey, key));
  const n = Number(row?.settingValue);
  if (!row || Number.isNaN(n)) throw new Error(`system_setting ${key} 값이 없습니다.`);
  return n;
}
