// A-SYS-050 공휴일·시스템 설정 (공휴일 달력, 설정 키-값) · F-ADM-SYS-05
import { holiday, systemSetting } from '@aircon/db';
import { asc } from 'drizzle-orm';
import { requireScreen } from '@/server/auth';
import { screenFlags } from '@/server/crud';
import { getDb } from '@/server/db';
import { SettingsScreen } from './screen';

export default async function SettingsPage() {
  const admin = await requireScreen('A-SYS-050');
  const db = getDb();
  const [holidays, settings] = await Promise.all([
    db.select().from(holiday).orderBy(asc(holiday.holidayDate)),
    db.select().from(systemSetting).orderBy(asc(systemSetting.settingKey)),
  ]);
  return <SettingsScreen holidays={holidays} settings={settings} {...screenFlags(admin, 'A-SYS-050')} />;
}
