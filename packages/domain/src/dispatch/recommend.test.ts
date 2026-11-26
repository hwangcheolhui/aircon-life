import { describe, expect, it } from 'vitest';
import { DEFAULT_RECOMMEND_WEIGHTS, type RecommendCandidate, parseRecommendWeights, scoreCandidate, soloSkillRatio, topCandidates } from './recommend';

const base: RecommendCandidate = { techId: 1, name: 'A', zone: 'PRIMARY', skillRatio: 1, dayJobs: 0, extraTravelMin: 0, windowViolation: false, ratingAvg: 5, warnings: [] };

describe('자동 배정 추천 점수 (F-ADM-DSP-02)', () => {
  it('모든 항목이 최상이면 가중치 합(100점)', () => {
    expect(scoreCandidate(base, DEFAULT_RECOMMEND_WEIGHTS, 6).score).toBe(100);
  });
  it('보조 관할은 절반, 관할 밖은 0점', () => {
    expect(scoreCandidate({ ...base, zone: 'SECONDARY' }, DEFAULT_RECOMMEND_WEIGHTS, 6).parts.zone).toBe(15);
    expect(scoreCandidate({ ...base, zone: null }, DEFAULT_RECOMMEND_WEIGHTS, 6).parts.zone).toBe(0);
  });
  it('당일 부하가 적정 수에 가까울수록, 이동시간이 늘수록 점수가 줄고 시간창 위반이면 이동 0점', () => {
    const s = scoreCandidate({ ...base, dayJobs: 3, extraTravelMin: 30 }, DEFAULT_RECOMMEND_WEIGHTS, 6);
    expect(s.parts.load).toBe(10);
    expect(s.parts.travel).toBe(7.5);
    expect(scoreCandidate({ ...base, windowViolation: true }, DEFAULT_RECOMMEND_WEIGHTS, 6).parts.travel).toBe(0);
    expect(scoreCandidate({ ...base, extraTravelMin: null }, DEFAULT_RECOMMEND_WEIGHTS, 6).parts.travel).toBe(7.5);
  });
  it('평점이 없으면 4점으로 본다', () => {
    expect(scoreCandidate({ ...base, ratingAvg: null }, DEFAULT_RECOMMEND_WEIGHTS, 6).parts.rating).toBe(7.5);
  });
  it('상위 3명: 점수 높은 순, 같으면 부하가 적은 기사', () => {
    const list: RecommendCandidate[] = [
      { ...base, techId: 1, zone: null },
      { ...base, techId: 2 },
      { ...base, techId: 3, dayJobs: 1, ratingAvg: 5, extraTravelMin: 0 },
      { ...base, techId: 4, dayJobs: 0, zone: 'SECONDARY' },
    ];
    expect(topCandidates(list, DEFAULT_RECOMMEND_WEIGHTS, 6).map((c) => c.techId)).toEqual([2, 3, 4]);
  });
  it('가중치 설정값 해석, 형식이 틀리면 기본값', () => {
    expect(parseRecommendWeights('40,20,20,10,10')).toEqual({ zone: 40, skill: 20, load: 20, travel: 10, rating: 10 });
    expect(parseRecommendWeights('1,2')).toEqual(DEFAULT_RECOMMEND_WEIGHTS);
  });
  it('기기 유형 중 단독 작업 가능 비율', () => {
    const skills = [
      { deviceType: 'WALL', skillLevel: 'CAN_SOLO' },
      { deviceType: 'STAND', skillLevel: 'CAN_ASSIST' },
    ];
    expect(soloSkillRatio(['WALL', 'STAND'], skills)).toBe(0.5);
    expect(soloSkillRatio(['WALL', 'WALL'], skills)).toBe(1);
    expect(soloSkillRatio([], skills)).toBe(1);
  });
});
