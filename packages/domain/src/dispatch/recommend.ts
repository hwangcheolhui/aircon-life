/**
 * 자동 배정 추천 (F-ADM-DSP-02, 단계 9 — A-DSP-010 보강).
 * 후보 점수 = 관할 구역 일치 + 숙련(기기 유형) + 당일 부하 + 기존 코스에 넣었을 때 늘어나는 이동시간 + 평점. 상위 3명.
 * 가중치는 system_setting RECOMMEND_WEIGHTS("관할,숙련,부하,이동,평점" 점수 합 100)에서 읽고, 배정 차단(BLOCK) 사유가 있는 기사는 빼고
 * 경고(근무 시간 밖·시간 겹침 등)는 함께 보여 준다. 추천은 안내일 뿐이며 배정은 운영자가 기존 배정(BR-070~072 검사)으로 한다.
 */

export interface RecommendWeights {
  zone: number;
  skill: number;
  load: number;
  travel: number;
  rating: number;
}

export const DEFAULT_RECOMMEND_WEIGHTS: RecommendWeights = { zone: 30, skill: 25, load: 20, travel: 15, rating: 10 };

/** "30,25,20,15,10" → 가중치. 형식이 틀리면 기본값 */
export function parseRecommendWeights(raw: string | null | undefined): RecommendWeights {
  const n = (raw ?? '').split(',').map((s) => Number(s.trim()));
  if (n.length !== 5 || n.some((v) => !Number.isFinite(v) || v < 0)) return DEFAULT_RECOMMEND_WEIGHTS;
  const [zone, skill, load, travel, rating] = n as [number, number, number, number, number];
  return { zone, skill, load, travel, rating };
}

export interface RecommendCandidate {
  techId: number;
  name: string;
  /** 주문 법정동이 기사 관할(technician_area)에 있으면 그 구분 */
  zone: 'PRIMARY' | 'SECONDARY' | null;
  /** 주문 기기 유형 중 단독 작업(CAN_SOLO 이상) 가능한 비율 0~1 */
  skillRatio: number;
  /** 그날 이미 맡은 작업 수 */
  dayJobs: number;
  /** 기존 코스에 넣었을 때 늘어나는 이동시간(분). 좌표를 모르면 null */
  extraTravelMin: number | null;
  /** 넣으면 시간창 위반이 생기는지 */
  windowViolation: boolean;
  ratingAvg: number | null;
  /** 배정 검사 경고 문구(차단 사유가 있는 기사는 넘기지 않는다) */
  warnings: string[];
}

export interface ScoredCandidate extends RecommendCandidate {
  score: number;
  parts: RecommendWeights;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

/** 한 후보 점수 (0~가중치 합). dayCap = 하루 적정 작업 수(RECOMMEND_DAY_JOB_CAP) */
export function scoreCandidate(c: RecommendCandidate, w: RecommendWeights, dayCap: number): ScoredCandidate {
  const parts: RecommendWeights = {
    zone: c.zone === 'PRIMARY' ? w.zone : c.zone === 'SECONDARY' ? w.zone / 2 : 0,
    skill: w.skill * clamp01(c.skillRatio),
    load: w.load * clamp01(1 - c.dayJobs / Math.max(dayCap, 1)),
    // 이동시간 60분 이상 늘면 0점, 모르면 절반, 시간창 위반이 생기면 0점
    travel: c.windowViolation ? 0 : c.extraTravelMin === null ? w.travel / 2 : w.travel * clamp01(1 - c.extraTravelMin / 60),
    // 평점이 없으면 4점으로 본다
    rating: w.rating * clamp01(((c.ratingAvg ?? 4) - 1) / 4),
  };
  const r = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, round1(v)])) as unknown as RecommendWeights;
  return { ...c, parts: r, score: round1(r.zone + r.skill + r.load + r.travel + r.rating) };
}

/** 상위 N명 (점수 ↓, 같으면 부하 ↑, 기사 ID ↑) */
export function topCandidates(list: readonly RecommendCandidate[], w: RecommendWeights, dayCap: number, n = 3): ScoredCandidate[] {
  return list
    .map((c) => scoreCandidate(c, w, dayCap))
    .sort((a, b) => b.score - a.score || a.dayJobs - b.dayJobs || a.techId - b.techId)
    .slice(0, n);
}

/** 주문 기기 유형 중 단독 작업 가능한 비율 */
export function soloSkillRatio(deviceTypes: readonly string[], skills: readonly { deviceType: string; skillLevel: string }[]): number {
  const types = [...new Set(deviceTypes)];
  if (!types.length) return 1;
  const ok = types.filter((t) => skills.some((s) => s.deviceType === t && (s.skillLevel === 'CAN_SOLO' || s.skillLevel === 'CAN_TEACH'))).length;
  return ok / types.length;
}
