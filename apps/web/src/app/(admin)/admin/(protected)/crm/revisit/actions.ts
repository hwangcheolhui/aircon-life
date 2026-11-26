'use server';
// A-CRM-010 재방문 자동 캠페인 서버 액션 · F-ADM-CRM-01: 실행/중지·대상 거점 저장. 발송은 매일 10:00 배치(F-SYS-06)
import { revisitCampaignInput } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { saveRevisitCampaign } from '@/server/crm';

export async function saveRevisitAction(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-CRM-010', 'UPDATE');
    const v = parse(revisitCampaignInput, values);
    await saveRevisitCampaign(v, { type: 'ADMIN', id: admin.adminId });
    revalidatePath('/admin/crm/revisit');
  });
}
