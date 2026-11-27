'use server';
// A-CRM-020 캠페인 관리 서버 액션 · F-ADM-CRM-02: 저장(작성 상태만)·대상 미리보기·예약/지금 발송/중지/작성으로
import { campaignActionInput, campaignInput, z } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { campaignAction, previewCampaign, saveCampaign } from '@/server/campaigns';
import { siteOrigin } from '@/server/site-origin';

export async function saveCampaignAction(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-CRM-020', values.id ? 'UPDATE' : 'CREATE');
    const v = parse(campaignInput, values);
    const id = await saveCampaign(v, { type: 'ADMIN', id: admin.adminId });
    revalidatePath('/admin/crm/campaigns');
    return id;
  });
}

export async function previewCampaignAction(id: number) {
  return handle(async () => {
    await requirePermission('A-CRM-020', 'READ');
    return previewCampaign(parse(z.coerce.number().int().positive(), id));
  });
}

export async function campaignStepAction(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-CRM-020', 'UPDATE');
    const v = parse(campaignActionInput, values);
    const r = await campaignAction(v, await siteOrigin(), { type: 'ADMIN', id: admin.adminId });
    revalidatePath('/admin/crm/campaigns');
    return r;
  });
}
