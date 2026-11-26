'use server';
// 기사 앱 단계 8 서버 액션: T-NTF-020 독촉·전달 회신(F-TEC-NTF-02) · T-NTC-010 공지 읽음(F-TEC-HOM-01, 필독 확인)
import { followupReplyInput, z } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { readTechNotice } from '@/server/content';
import { replyTechFollowup } from '@/server/followups';
import { requireTechAction } from '@/server/tech-session';

export async function replyFollowup(values: Record<string, unknown>) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(followupReplyInput, values);
    await replyTechFollowup(me.id, v.id, v.reply);
    revalidatePath('/tech/notifications', 'layout');
    revalidatePath('/tech');
  });
}

export async function confirmNotice(id: number) {
  return handle(async () => {
    const me = await requireTechAction();
    await readTechNotice(me, parse(z.coerce.number().int().positive(), id));
    revalidatePath('/tech');
    revalidatePath('/tech/notices');
  });
}
