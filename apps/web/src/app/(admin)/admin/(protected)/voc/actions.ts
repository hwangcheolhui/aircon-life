'use server';
// VOC·안전사고·AS 서버 액션 (단계 8-1): A-VOC-010/011 F-ADM-VOC-01 · A-VOC-020 F-ADM-VOC-02(BR-061 수신자 추가) · A-VOC-030 F-ADM-VOC-03(BR-050·051).
// 모든 액션 첫 줄에서 requirePermission(화면 ID, 행위), 거점 범위는 currentBranchFilter(BR-102).
import { adminAsInput, asDecisionInput, asRevisitInput, incidentRecipientInput, incidentUpdateInput, vocCreateInput, vocUpdateInput } from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import { type CurrentAdmin, requirePermission } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import { addIncidentRecipient, updateIncident } from '@/server/incidents';
import { createAdminAs, createRevisitOrder, createVoc, decideAs, updateVoc } from '@/server/voc';

const actorOf = (a: CurrentAdmin) => ({ type: 'ADMIN' as const, id: a.adminId });

/** F-ADM-VOC-01 VOC 등록 */
export async function saveVoc(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-VOC-010', 'CREATE');
    const v = parse(vocCreateInput, values);
    const r = await createVoc(v, await currentBranchFilter(admin), actorOf(admin));
    revalidatePath('/admin/voc/vocs');
    return r;
  });
}

/** F-ADM-VOC-01 VOC 카드 처리 (A-VOC-011, 메뉴 권한은 A-VOC-010) */
export async function processVoc(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-VOC-010', 'UPDATE');
    const v = parse(vocUpdateInput, values);
    await updateVoc(v, await currentBranchFilter(admin), actorOf(admin));
    revalidatePath('/admin/voc/vocs', 'layout');
  });
}

/** F-ADM-VOC-02 진행 상태·보험 접수번호·보상 금액 */
export async function saveIncident(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-VOC-020', 'UPDATE');
    const v = parse(incidentUpdateInput, values);
    await updateIncident(v, await currentBranchFilter(admin), actorOf(admin));
    revalidatePath('/admin/voc/incidents');
  });
}

/** F-ADM-VOC-02 수신자 추가 + 통보 */
export async function addRecipient(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-VOC-020', 'UPDATE');
    const v = parse(incidentRecipientInput, values);
    await addIncidentRecipient(v, await currentBranchFilter(admin), actorOf(admin));
    revalidatePath('/admin/voc/incidents');
  });
}

/** F-ADM-VOC-03 관리자 AS 등록(전화 요청·VOC 연결) */
export async function saveAs(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-VOC-030', 'CREATE');
    const v = parse(adminAsInput, values);
    const r = await createAdminAs(v, await currentBranchFilter(admin), actorOf(admin));
    revalidatePath('/admin/voc/as');
    return r;
  });
}

/** F-ADM-VOC-03 승인(보증 판정)·반려·완료 */
export async function decideAsAction(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-VOC-030', 'UPDATE');
    const v = parse(asDecisionInput, values);
    await decideAs(v, await currentBranchFilter(admin), actorOf(admin));
    revalidatePath('/admin/voc/as');
  });
}

/** F-ADM-VOC-03 재방문 주문 생성(보증이면 무상, BR-050) → 배차 보드(A-DSP-010)에서 배정 */
export async function createRevisit(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-VOC-030', 'UPDATE');
    const v = parse(asRevisitInput, values);
    const r = await createRevisitOrder(v, await currentBranchFilter(admin), actorOf(admin));
    revalidatePath('/admin/voc/as');
    revalidatePath('/admin/dsp/board');
    return r;
  });
}
