'use server';
// A-CRM-040 알림 템플릿 수정 (F-SYS-03 접수·변경·취소·방문 전날 알림 문구). 템플릿 코드는 시스템이 쓰는 고정값이라 추가·삭제하지 않는다.
import { notificationTemplateInput } from '@aircon/contracts';
import { notificationTemplate } from '@aircon/db';
import { saveRow } from '@/server/crud';

const cfg = {
  menu: 'A-CRM-040',
  table: notificationTemplate,
  idColumn: notificationTemplate.id,
  schema: notificationTemplateInput,
  path: '/admin/crm/templates',
};

export async function saveTemplate(values: Record<string, string>, id: string | null) {
  if (!id) return { ok: false as const, message: '템플릿은 수정만 할 수 있습니다.' };
  return saveRow(cfg, values, id);
}
