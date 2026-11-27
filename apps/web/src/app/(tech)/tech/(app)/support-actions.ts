'use server';
// 기사 업무지원 서버 액션 (단계 10)
// - 메모 F-TEC-MEMO-01(T-MEMO-010 등록·수정·삭제·완료) · 받은 메모 확인(T-MEMO-020)
// - 자재 요청 F-TEC-MAT-02(T-MAT-020 요청·취소·수령 확인)
// - 퀵메뉴 F-TEC-HOM-04(T-MY-020 · T-MORE-010 ★)
import { materialRequestInput, quickMenuInput, techMemoInput } from '@aircon/contracts';
import { toggleQuickMenu } from '@aircon/domain';
import { revalidatePath } from 'next/cache';
import { UserError, handle, parse } from '@/server/action-result';
import { confirmReceivedMemos, deleteTechMemo, saveTechMemo, setTechMemoDone } from '@/server/tech-memos';
import { changeMaterialRequest, createMaterialRequest, getQuickMenu, saveQuickMenu } from '@/server/tech-support';
import { requireTechAction } from '@/server/tech-session';

const memoPaths = () => {
  revalidatePath('/tech');
  revalidatePath('/tech/calendar');
};

/** F-TEC-MEMO-01 메모 저장 */
export async function saveMemoAction(values: Record<string, string>) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(techMemoInput, values);
    const id = await saveTechMemo(me.id, v);
    memoPaths();
    return { id };
  });
}

export async function deleteMemoAction(id: number) {
  return handle(async () => {
    const me = await requireTechAction();
    await deleteTechMemo(me.id, Number(id));
    memoPaths();
  });
}

/** 오늘의 메모 완료 체크 (내 메모만) */
export async function toggleMemoDoneAction(id: number, done: boolean) {
  return handle(async () => {
    const me = await requireTechAction();
    await setTechMemoDone(me.id, Number(id), Boolean(done));
    memoPaths();
  });
}

/** T-MEMO-020 받은 메모 [확인] → memo_recipient.read_at */
export async function confirmMemosAction(ids: number[]) {
  return handle(async () => {
    const me = await requireTechAction();
    if (!Array.isArray(ids) || !ids.length) throw new UserError('확인할 메모가 없습니다.');
    await confirmReceivedMemos(me.id, ids.map(Number).filter(Number.isFinite));
    memoPaths();
  });
}

/** F-TEC-MAT-02 자재 요청 */
export async function requestMaterialAction(values: Record<string, string>) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(materialRequestInput, values);
    await createMaterialRequest(me.id, v);
    revalidatePath('/tech/materials/requests');
    revalidatePath('/tech');
  });
}

/** [요청 취소] · [수령 확인] */
export async function changeMaterialRequestAction(id: number, to: 'CANCELED' | 'RECEIVED') {
  return handle(async () => {
    const me = await requireTechAction();
    if (to !== 'CANCELED' && to !== 'RECEIVED') throw new UserError('잘못된 요청입니다.');
    await changeMaterialRequest(me.id, Number(id), to);
    revalidatePath('/tech/materials/requests');
    revalidatePath('/tech/materials');
    revalidatePath('/tech');
  });
}

/** T-MY-020 퀵메뉴 저장 (순서 그대로) */
export async function saveQuickMenuAction(codes: string[]) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(quickMenuInput, { codes });
    const saved = await saveQuickMenu(me.id, v.codes);
    revalidatePath('/tech');
    revalidatePath('/tech/more');
    revalidatePath('/tech/my/quick-menu');
    return saved;
  });
}

/** ★ 하나 켜고 끄기 (T-MORE-010) */
export async function toggleQuickMenuAction(code: string) {
  return handle(async () => {
    const me = await requireTechAction();
    const saved = await saveQuickMenu(me.id, toggleQuickMenu(await getQuickMenu(me.id), String(code)));
    revalidatePath('/tech');
    revalidatePath('/tech/more');
    revalidatePath('/tech/my/quick-menu');
    return saved;
  });
}
