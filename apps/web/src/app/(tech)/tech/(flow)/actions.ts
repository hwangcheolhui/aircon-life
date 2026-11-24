'use server';
// 기사 앱 현장작업 서버 액션 (단계 5-1): 출발 F-TEC-WRK-01 · 도착/작업 시작 F-TEC-WRK-02(BR-043) · 사진 F-TEC-WRK-03 ·
// 기기별 결과·발견 이슈 F-TEC-WRK-04·10 · 처리 저장(완료) F-TEC-WRK-07(BR-041) · 활동내역 F-TEC-WRK-09
// 단계 6: 현장 결제 F-TEC-PAY-01·02 · 증빙 F-TEC-PAY-03
// 단계 5-2: 추가요금 등록·철회·현장 서명 F-TEC-WRK-05(BR-040·042) · 미처리 저장 F-TEC-WRK-08(BR-031)
import {
  activityInput,
  extraChargeInput,
  extraChargeRefInput,
  fieldPaymentInput,
  paymentRequestInput,
  receivableInput,
  taxDocRequestInput,
  workPendingInput,
  workCompleteInput,
  workDepartInput,
  workOrderNoInput,
  workPhotoDeleteInput,
  workPhotoInput,
  workResultInput,
  workSafetyInput,
} from '@aircon/contracts';
import { revalidatePath } from 'next/cache';
import { UserError, handle, parse } from '@/server/action-result';
import { addExtraCharge, signExtraCharge, withdrawExtraCharge } from '@/server/extra-charges';
import { collectInField, techMarkReceivable, techRequestPayment, techRequestTaxDoc } from '@/server/payments';
import { extraAgreeUrl, siteOrigin } from '@/server/site-origin';
import { requireTechAction } from '@/server/tech-session';
import { addActivity, addPhoto, arrive, completeWork, deletePhoto, depart, savePending, saveResults, startWork } from '@/server/work';

const refresh = (orderNo: string) => {
  revalidatePath(`/tech/jobs/${orderNo}`, 'layout');
  revalidatePath('/tech', 'layout');
};


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

const fileOf = (form: FormData, key: string) => {
  const f = form.get(key);
  return f instanceof File && f.size > 0 ? f : null;
};
const valuesOf = (form: FormData, ...files: string[]) => Object.fromEntries([...form.entries()].filter(([k]) => !files.includes(k)));

/** F-TEC-WRK-05 추가요금 등록 (FormData: 값 + evidence 사진). 기타는 관리자 승인 요청, 나머지는 고객 동의 요청 */
export async function addJobExtraCharge(form: FormData) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(extraChargeInput, valuesOf(form, 'evidence'));
    const r = await addExtraCharge(me.id, v, fileOf(form, 'evidence'), extraAgreeUrl(await siteOrigin()));
    refresh(v.orderNo);
    return r;
  });
}

/** F-TEC-WRK-05 응답 전 추가요금 철회 */
export async function withdrawJobExtraCharge(values: Record<string, unknown>) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(extraChargeRefInput, values);
    await withdrawExtraCharge(me.id, v.orderNo, v.chargeId);
    refresh(v.orderNo);
  });
}

/** BR-040 앱 미사용 고객: 현장 서명으로 동의 (FormData: orderNo·chargeId + signature) */
export async function signJobExtraCharge(form: FormData) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(extraChargeRefInput, valuesOf(form, 'signature'));
    await signExtraCharge(me.id, v.orderNo, v.chargeId, fileOf(form, 'signature'));
    refresh(v.orderNo);
  });
}

/** F-TEC-WRK-08 미처리 저장 (BR-031) */
export async function savePendingJob(values: Record<string, unknown>) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(workPendingInput, values);
    const r = await savePending(me.id, v);
    refresh(v.orderNo);
    return r;
  });
}

/* ---------- 단계 6 T-PAY-010 현장 결제 · T-PAY-020 증빙 ---------- */

const refreshPay = (orderNo: string) => {
  revalidatePath(`/tech/jobs/${orderNo}`, 'layout');
  revalidatePath('/tech/jobs');
};

/** F-TEC-PAY-01·02 카드단말·계좌이체·현금 수금 → 전액이면 주문 완료(정산 대상) */
export async function collectJobPayment(values: Record<string, unknown>) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(fieldPaymentInput, values);
    const r = await collectInField(me.id, v);
    refreshPay(v.orderNo);
    return r;
  });
}

/** F-TEC-PAY-01 고객 앱 결제 요청(알림톡) / 결제 링크 문자 */
export async function requestJobPayment(values: Record<string, unknown>) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(paymentRequestInput, values);
    await techRequestPayment(me.id, v, await siteOrigin());
  });
}

/** 결제를 못 받으면 미수로 남긴다([미수금] 메모, BR-081 정산 제외) */
export async function markJobReceivable(values: Record<string, unknown>) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(receivableInput, values);
    await techMarkReceivable(me.id, v);
    refreshPay(v.orderNo);
  });
}

/** F-TEC-PAY-03 현금영수증 발행 요청 */
export async function requestJobTaxDoc(values: Record<string, unknown>) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(taxDocRequestInput, values);
    await techRequestTaxDoc(me.id, v);
    refreshPay(v.orderNo);
  });
}
