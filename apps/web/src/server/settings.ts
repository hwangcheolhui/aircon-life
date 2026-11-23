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

/** 문자열 기준값 (시각·버전 등) */
export async function getSettingString(key: string): Promise<string> {
  if (!isDbConfigured()) return SYSTEM_SETTING_SEEDS.find((s) => s.key === key)?.value ?? '';
  const [row] = await getDb().select().from(systemSetting).where(eq(systemSetting.settingKey, key));
  if (!row) throw new Error(`system_setting ${key} 값이 없습니다.`);
  return row.settingValue;
}
