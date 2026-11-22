import 'server-only';
import { systemSetting } from '@aircon/db';
import { SYSTEM_SETTING_SEEDS } from '@aircon/domain';
import { eq } from 'drizzle-orm';
import { getDb, isDbConfigured } from './db';

/** 기준값은 system_setting에서 읽는다 (CLAUDE.md §5) */
export async function getSettingNumber(key: string): Promise<number> {
  // DB 미연결이면 시드 기본값
  if (!isDbConfigured()) return Number(SYSTEM_SETTING_SEEDS.find((s) => s.key === key)?.value);
  const [row] = await getDb().select().from(systemSetting).where(eq(systemSetting.settingKey, key));
  const n = Number(row?.settingValue);
  if (!row || Number.isNaN(n)) throw new Error(`system_setting ${key} 값이 없습니다.`);
  return n;
}
