'use server';
// A-SYS-050 공휴일·시스템 설정 · F-ADM-SYS-05
import { holidayInput, systemSettingInput } from '@aircon/contracts';
import { holiday, systemSetting } from '@aircon/db';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { UserError, handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { deleteRow, saveRow } from '@/server/crud';
import { getDb } from '@/server/db';

const holidayCfg = {
  menu: 'A-SYS-050',
  table: holiday,
  idColumn: holiday.holidayDate,
  schema: holidayInput,
  numericId: false,
  hasAudit: false,
  path: '/admin/sys/settings',
};
export async function saveHoliday(values: Record<string, string>, id: string | null) {
  return saveRow(holidayCfg, values, id);
}
export async function deleteHoliday(id: string) {
  return deleteRow(holidayCfg, id);
}

/** 설정 키는 ERD §2.13.8에 정의된 것만 쓰므로 값·설명만 수정한다 */
export async function saveSetting(values: Record<string, string>, id: string | null) {
  return handle(async () => {
    const admin = await requirePermission('A-SYS-050', 'UPDATE');
    if (!id) throw new UserError('설정 키는 문서(ERD §2.13.8)에 정의된 것만 사용합니다.');
    const data = parse(systemSettingInput, { ...values, settingKey: id });
    const res = await getDb()
      .update(systemSetting)
      .set({ settingValue: data.settingValue, description: data.description, updatedAt: new Date(), updatedBy: admin.adminId })
      .where(eq(systemSetting.settingKey, id))
      .returning();
    if (!res.length) throw new UserError('없는 설정 키입니다.');
    revalidatePath('/admin/sys/settings');
  });
}
