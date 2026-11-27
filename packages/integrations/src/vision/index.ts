/**
 * 기기 사진 인식 (F-CUS-QUO-03 사진 견적, C-QUO-021, 단계 9). CLAUDE.md §7 인터페이스 + Mock + Real.
 * - Mock: 파일 이름·크기에서 결정적으로 기기 유형·브랜드·오염도·신뢰도를 만든다(같은 사진 → 같은 결과).
 *   파일 이름에 wall/stand/ceiling/window 가 있으면 그 유형으로 본다(시험용).
 * - Real: 인식 업체 선정 전이라 아직 없다. VISION_DRIVER=mock 만 지원하며 다른 값도 Mock 으로 동작한다(02 §6).
 * 인식 결과는 참고값이고 고객이 확인·수정한 값으로 견적한다(device_image.user_confirmed).
 */

export interface DeviceRecognitionInput {
  fileName: string;
  size: number;
  contentType: string;
}

export interface DeviceRecognitionResult {
  deviceType: 'WALL' | 'STAND' | 'CEILING_1WAY' | 'CEILING_4WAY' | 'WINDOW' | null;
  brand: string | null;
  dirtLevel: 'LOW' | 'MID' | 'HIGH' | null;
  /** 0~1 */
  confidence: number;
}

export interface DeviceRecognizer {
  kind: 'mock';
  recognize(i: DeviceRecognitionInput): Promise<DeviceRecognitionResult>;
}

export type VisionDriver = 'mock';
export const resolveVisionDriver = (_v: string | undefined): VisionDriver => 'mock';

const TYPES = ['WALL', 'STAND', 'CEILING_4WAY', 'CEILING_1WAY', 'WINDOW'] as const;
const DIRT = ['LOW', 'MID', 'HIGH'] as const;
const BRANDS = ['A사', 'B사', 'C사', null] as const;

function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function createMockDeviceRecognizer(): DeviceRecognizer {
  return {
    kind: 'mock',
    async recognize(i) {
      if (!i.contentType.startsWith('image/')) return { deviceType: null, brand: null, dirtLevel: null, confidence: 0 };
      const name = i.fileName.toLowerCase();
      const h = hashOf(`${name}:${i.size}`);
      const hinted =
        name.includes('ceiling') ? 'CEILING_4WAY' : name.includes('stand') ? 'STAND' : name.includes('window') ? 'WINDOW' : name.includes('wall') ? 'WALL' : null;
      const deviceType = hinted ?? TYPES[h % TYPES.length]!;
      const confidence = hinted ? 0.92 : Math.round((0.5 + ((h >>> 8) % 45) / 100) * 1000) / 1000;
      return { deviceType, brand: BRANDS[(h >>> 4) % BRANDS.length]!, dirtLevel: DIRT[(h >>> 12) % DIRT.length]!, confidence };
    },
  };
}

export function createDeviceRecognizer(env: NodeJS.ProcessEnv = process.env): DeviceRecognizer {
  resolveVisionDriver(env.VISION_DRIVER);
  return createMockDeviceRecognizer();
}
