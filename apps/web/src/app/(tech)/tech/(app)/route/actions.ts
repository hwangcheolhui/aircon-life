'use server';
// 기사 코스·자가 배정 서버 액션 (단계 4-2)
// F-TEC-RTE-01 코스 편집(순서 변경 즉시 재계산·저장) · F-TEC-RTE-02 최적 코스 추천 · F-TEC-RTE-03 코스 확정(BR-112 시간창, BR-113 마감)
// F-TEC-RTE-04 관할 내 미배정 작업 [내 일정에 넣기](BR-110·111, 동시 요청은 1명만 성공)
// 단계 9: 마감 후 코스 변경 요청(F-ADM-DSP-09, BR-113) · 고객 지연 안내(F-TEC-RTE-06)
import { routeChangeRequestInput, routeDateInput, routeEditInput, selfAssignRequestInput, z } from '@aircon/contracts';
import { requestRouteChange, sendVisitDelay } from '@/server/route-monitor';
import { revalidatePath } from 'next/cache';
import { handle, parse } from '@/server/action-result';
import {
  applyRecommendation,
  confirmRoute,
  previewRoute,
  recommendRoute,
  saveRoute,
} from '@/server/route-plans';
import { requestSelfAssign } from '@/server/self-assign';
import { requireTechAction } from '@/server/tech-session';

const refresh = () => {
  revalidatePath('/tech/route');
  revalidatePath('/tech/map');
  revalidatePath('/tech/jobs');
  revalidatePath('/tech');
};

/** 순서를 바꾼 즉시 도착 예정·위반 다시 계산 (저장 안 함) */
export async function previewRouteAction(values: unknown) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(routeEditInput, values);
    return previewRoute(me.id, v.date, v.stops);
  });
}

export async function saveRouteAction(values: unknown) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(routeEditInput, values);
    const view = await saveRoute(me.id, v.date, v.stops);
    refresh();
    return view;
  });
}

/** 추천 전/후 비교 (저장 안 함) */
export async function recommendRouteAction(values: unknown) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(routeDateInput, values);
    return recommendRoute(me.id, v.date);
  });
}

export async function applyRecommendationAction(values: unknown) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(routeDateInput, values);
    await applyRecommendation(me.id, v.date);
    refresh();
  });
}

export async function confirmRouteAction(values: unknown) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(routeDateInput, values);
    const r = await confirmRoute(me.id, v.date);
    refresh();
    return r;
  });
}

export async function requestSelfAssignAction(values: unknown) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(selfAssignRequestInput, values);
    const r = await requestSelfAssign(me.id, v.orderNo);
    refresh();
    return r;
  });
}

/** 단계 9 확정 마감 후 코스 변경 요청 → 거점 승인(A-DSP-070) */
export async function requestRouteChangeAction(values: unknown) {
  return handle(async () => {
    const me = await requireTechAction();
    const v = parse(routeChangeRequestInput, values);
    await requestRouteChange(me.id, v.date, v.note);
    refresh();
  });
}

/** 단계 9 F-TEC-RTE-06 고객에게 지연 안내 (새 도착 예정 시각, 좌표 없음 BR-115) */
export async function sendVisitDelayAction(orderNo: unknown) {
  return handle(async () => {
    const me = await requireTechAction();
    await sendVisitDelay(me.id, parse(z.string().min(1).max(20), orderNo));
    refresh();
  });
}
