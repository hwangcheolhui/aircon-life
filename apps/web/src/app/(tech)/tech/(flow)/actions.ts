'use server';
// 기사 앱 현장작업 서버 액션 (단계 5-1): 출발 F-TEC-WRK-01 · 도착/작업 시작 F-TEC-WRK-02(BR-043) · 사진 F-TEC-WRK-03 ·
// 기기별 결과·발견 이슈 F-TEC-WRK-04·10 · 처리 저장(완료) F-TEC-WRK-07(BR-041) · 활동내역 F-TEC-WRK-09
import {
  activityInput,
  workCompleteInput,
  workDepartInput,
  workOrderNoInput,
  workPhotoDeleteInput,
  workPhotoInput,
  workResultInput,
  workSafetyInput,
} from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { UserError, handle, parse } from '@/server/action-result';
import { requireTechAction } from '@/server/tech-session';
import { addActivity, addPhoto, arrive, completeWork, deletePhoto, depart, saveResults, startWork } from '@/server/work';

const refresh = (orderNo: string) => {
  revalidatePath(`/tech/jobs/${orderNo}`, 'layout');
  revalidatePath('/tech', 'layout');
};

/** 알림 링크용 사이트 주소 (APP_BASE_URL 이 있으면 그 값, 없으면 요청 주소) */
async function siteOrigin() {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/** F-TEC-WRK-01 출발 → 고객 "기사 출발" 알림(도착 예정시각) */
export async function departJob(values: Record<string, unknown>) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(workDepartInput, values);
    const r = await depart(me.id, v.orderNo, v.force);
    if (r.departed) refresh(v.orderNo);
    return r;
  });
}

/** F-TEC-WRK-02 도착 */
export async function arriveJob(values: Record<string, unknown>) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(workOrderNoInput, values);
    await arrive(me.id, v.orderNo);
    refresh(v.orderNo);
  });
}

/** F-TEC-WRK-02 안전 체크리스트 완료 → 작업 시작 (BR-043) */
export async function startJob(values: Record<string, unknown>) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(workSafetyInput, values);
    const r = await startWork(me.id, v.orderNo, v.checked, v.highPlaceWork);
    refresh(v.orderNo);
    return r;
  });
}

/** F-TEC-WRK-03 사진 1장 업로드 (FormData: file + 메타) — 기사 앱 업로드 대기열이 실패 시 다시 보낸다 */
export async function uploadWorkPhoto(form: FormData) {
  return handle(async () => {
    const me = await requireTechAction();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) throw new UserError('사진 파일이 없습니다.');
    const v = parse(workPhotoInput, Object.fromEntries([...form.entries()].filter(([k]) => k !== 'file')));
    const r = await addPhoto(me.id, v, file);
    revalidatePath(`/tech/jobs/${v.orderNo}`, 'layout');
    return r;
  });
}

export async function removeWorkPhoto(values: Record<string, unknown>) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(workPhotoDeleteInput, values);
    await deletePhoto(me.id, v.orderNo, v.photoId);
    revalidatePath(`/tech/jobs/${v.orderNo}`, 'layout');
  });
}

/** F-TEC-WRK-04·10 기기별 처리 결과 저장 */
export async function saveWorkResults(values: unknown) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(workResultInput, values);
    await saveResults(me.id, v);
    revalidatePath(`/tech/jobs/${v.orderNo}`, 'layout');
  });
}

/** F-TEC-WRK-07 처리 저장(완료) → WORK_DONE, 고객 "작업 완료·리포트" 알림 (FormData: 값 + signature 선택) */
export async function completeJob(form: FormData) {
  return handle(async () => {
    const me = await requireTechAction();
    const sig = form.get('signature');
    const v = parse(workCompleteInput, Object.fromEntries([...form.entries()].filter(([k]) => k !== 'signature')));
    const origin = await siteOrigin();
    const r = await completeWork(me.id, v, sig instanceof File && sig.size > 0 ? sig : null, (no) => `${origin}/orders/${no}/report`);
    if (r.done) refresh(v.orderNo);
    return r;
  });
}

/** F-TEC-WRK-09 활동내역 등록 (통화·문자·방문 시도·메모) */
export async function addJobActivity(values: Record<string, unknown>) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(activityInput, values);
    await addActivity(me.id, v);
    revalidatePath(`/tech/jobs/${v.orderNo}`, 'layout');
  });
}
