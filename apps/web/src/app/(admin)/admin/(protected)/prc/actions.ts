'use server';
// 처리 콘솔·미처리 대기열 서버 액션 (단계 6-2): A-PRC-010·020 F-ADM-PRC-01·02·06·07 · A-PRC-050 F-ADM-PRC-05 (BR-031).
// 모든 액션 첫 줄에서 requirePermission(화면 ID, 행위), 거점 범위는 currentBranchFilter(BR-102).
import {
  adminActivityInput,
  consoleFileInput,
  pendingCancelInput,
  proxyCompleteInput,
  proxyPendingInput,
  proxyPhotoInput,
  rescheduleInput,
  z,
} from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { UserError, handle, parse } from '@/server/action-result';
import { requirePermission } from '@/server/auth';
import { currentBranchFilter } from '@/server/branch-selection';
import type { Actor } from '@/server/orders';
import {
  addConsoleFile,
  adminAddActivity,
  cancelPending,
  deleteConsoleFile,
  findTechs,
  proxyAddPhoto,
  proxyComplete,
  proxyDeletePhoto,
  proxyPending,
  reschedulePending,
} from '@/server/process-console';
import { siteOrigin } from '@/server/site-origin';

const actorOf = (a: { adminId: number }): Actor => ({ type: 'ADMIN', id: a.adminId });
const idOf = (v: unknown) => parse(z.coerce.number().int().positive(), v);
const fileOf = (form: FormData) => {
  const f = form.get('file');
  if (!(f instanceof File) || f.size === 0) throw new UserError('파일은 필수 입력값입니다.');
  return f;
};
const valuesOf = (form: FormData) => Object.fromEntries([...form.entries()].filter(([k]) => k !== 'file'));
const refresh = () => revalidatePath('/admin/prc', 'layout');

/** F-ADM-PRC-01 기사명 검색 (동명이인 선택) */
export async function searchTechs(name: string) {
  return handle(async () => {
    const admin = await requirePermission('A-PRC-010', 'READ');
    return findTechs(parse(z.string().trim().min(1, '기사명은 필수 입력값입니다.').max(30), name), await currentBranchFilter(admin));
  });
}

/** F-ADM-PRC-02 대리 처리 저장 → 작업완료(WORK_DONE), 선결제로 다 냈으면 완료 */
export async function saveProxyComplete(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-PRC-010', 'UPDATE');
    const v = parse(proxyCompleteInput, values);
    const origin = await siteOrigin();
    const r = await proxyComplete(v, await currentBranchFilter(admin), actorOf(admin), (no) => `${origin}/orders/${no}/report`);
    if (r.done) refresh();
    return r;
  });
}

/** F-ADM-PRC-02 대리 미처리 저장 (BR-031) */
export async function saveProxyPending(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-PRC-010', 'UPDATE');
    const v = parse(proxyPendingInput, values);
    const r = await proxyPending(v, await currentBranchFilter(admin), actorOf(admin));
    refresh();
    return r;
  });
}

/** 대리 입력 작업 전·후 사진 (BR-041) */
export async function uploadProxyPhoto(form: FormData) {
  return handle(async () => {
    const admin = await requirePermission('A-PRC-010', 'UPDATE');
    const file = fileOf(form);
    const v = parse(proxyPhotoInput, valuesOf(form));
    await proxyAddPhoto(v, file, await currentBranchFilter(admin), actorOf(admin));
    refresh();
  });
}

export async function removeProxyPhoto(photoId: number) {
  return handle(async () => {
    const admin = await requirePermission('A-PRC-010', 'UPDATE');
    await proxyDeletePhoto(idOf(photoId), await currentBranchFilter(admin), actorOf(admin));
    refresh();
  });
}

/** F-ADM-PRC-06 안전관리·서비스 파일 첨부 (종류마다 2개) */
export async function uploadConsoleFile(form: FormData) {
  return handle(async () => {
    const admin = await requirePermission('A-PRC-010', 'CREATE');
    const file = fileOf(form);
    const v = parse(consoleFileInput, valuesOf(form));
    await addConsoleFile(v, file, await currentBranchFilter(admin), actorOf(admin));
    refresh();
  });
}

export async function removeConsoleFile(fileId: number) {
  return handle(async () => {
    const admin = await requirePermission('A-PRC-010', 'DELETE');
    await deleteConsoleFile(idOf(fileId), await currentBranchFilter(admin));
    refresh();
  });
}

/** F-ADM-PRC-07 활동내역 등록 */
export async function saveAdminActivity(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-PRC-010', 'CREATE');
    const v = parse(adminActivityInput, values);
    await adminAddActivity(v, await currentBranchFilter(admin), actorOf(admin));
    refresh();
  });
}

/** F-ADM-PRC-05 재약속 (PENDING → ASSIGNED, BR-031 운영자 확인) */
export async function saveReschedule(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-PRC-050', 'UPDATE');
    const v = parse(rescheduleInput, values);
    await reschedulePending(v, await currentBranchFilter(admin), actorOf(admin));
    refresh();
    revalidatePath('/admin/dsp/board');
  });
}

/** F-ADM-PRC-05 미처리 취소 (결제 금액 전액 환불, 슬롯 반환) */
export async function cancelPendingOrder(values: Record<string, unknown>) {
  return handle(async () => {
    const admin = await requirePermission('A-PRC-050', 'UPDATE');
    const v = parse(pendingCancelInput, values);
    await cancelPending(v, await currentBranchFilter(admin), actorOf(admin));
    refresh();
  });
}
