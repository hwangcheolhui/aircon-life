/**
 * 관리자 웹 메뉴 트리 (03_IA §4.2 사이트맵 그대로).
 * - 화면 ID = permission.menu_code (03 §0.2-5)
 * - stage = 04_구현계획에서 화면이 배정된 단계. RELEASED_STAGES에 포함된 단계의 화면만 메뉴에 노출한다.
 * - inMenu=false 는 목록에서 진입하는 상세 화면(LNB에 표시하지 않음)
 */

export type ImplementationStage =
  | '0'
  | '1'
  | '2'
  | '3'
  | '4-1'
  | '4-2'
  | '5'
  | '6-1'
  | '6-2'
  | '7'
  | '8'
  | '9'
  | '10'
  | '11';

/** 지금까지 구현이 끝난 단계. 단계를 마칠 때마다 이 목록에 추가한다. */
export const RELEASED_STAGES: readonly ImplementationStage[] = ['0', '1', '2', '3', '4-1', '4-2', '5', '6-1', '6-2'];

export interface AdminScreen {
  screenId: string;
  name: string;
  stage: ImplementationStage;
  inMenu?: boolean;
  /** LNB 소분류(예: CRM·VOC 아래 'VOC·품질') */
  section?: string;
}

export interface AdminMenuGroup {
  /** GNB 키 (화면 ID의 영역 부분) */
  key: string;
  name: string;
  screens: AdminScreen[];
}

export const ADMIN_MENU: readonly AdminMenuGroup[] = [
  {
    key: 'DSH',
    name: '대시보드',
    screens: [
      { screenId: 'A-DSH-010', name: '운영 현황', stage: '8' },
      { screenId: 'A-DSH-020', name: 'KPI 대시보드', stage: '8' },
    ],
  },
  {
    key: 'CSL',
    name: '상담',
    screens: [
      { screenId: 'A-CSL-010', name: '상담 콘솔', stage: '3' },
      { screenId: 'A-CSL-070', name: '상담 이력 조회', stage: '3' },
      { screenId: 'A-CSL-080', name: '1:1 문의 관리', stage: '8' },
    ],
  },
  {
    key: 'ORD',
    name: '접수·주문',
    screens: [
      { screenId: 'A-ORD-010', name: '주문 목록', stage: '2' },
      { screenId: 'A-ORD-020', name: '주문 상세', stage: '2', inMenu: false },
      { screenId: 'A-ORD-030', name: '변경·취소 요청', stage: '2' },
      { screenId: 'A-ORD-040', name: '수동 주문 등록', stage: '2' },
    ],
  },
  {
    key: 'DSP',
    name: '배정·일정',
    screens: [
      { screenId: 'A-DSP-010', name: '배정 보드', stage: '4-1' },
      { screenId: 'A-DSP-020', name: '재배정·이관·자가 배정 요청', stage: '4-1' },
      { screenId: 'A-DSP-030', name: '운영 슬롯 관리', stage: '2' },
      { screenId: 'A-DSP-040', name: '기사 근무 일정', stage: '2' },
      { screenId: 'A-DSP-050', name: '관할 지역 관리', stage: '0' },
      { screenId: 'A-DSP-060', name: '기사 관할 구역 지정', stage: '4-2' },
      { screenId: 'A-DSP-070', name: '코스 모니터링 지도', stage: '9' },
    ],
  },
  {
    key: 'PRC',
    name: '처리',
    screens: [
      { screenId: 'A-PRC-010', name: '처리 콘솔', stage: '6-2' },
      { screenId: 'A-PRC-030', name: '작업 결과 검수', stage: '9' },
      { screenId: 'A-PRC-040', name: '추가요금 승인', stage: '5' },
      { screenId: 'A-PRC-050', name: '미처리 큐', stage: '6-2' },
      { screenId: 'A-PRC-060', name: '독촉·전달 현황', stage: '8' },
    ],
  },
  {
    key: 'CUS',
    name: '고객',
    screens: [
      { screenId: 'A-CUS-010', name: '고객 목록', stage: '3' },
      { screenId: 'A-CUS-020', name: '고객 상세', stage: '3', inMenu: false },
      { screenId: 'A-CUS-030', name: '파기 대상 관리', stage: '8' },
    ],
  },
  {
    key: 'TEC',
    name: '기사',
    screens: [
      { screenId: 'A-TEC-010', name: '기사 목록', stage: '2' },
      { screenId: 'A-TEC-020', name: '기사 상세·등록', stage: '4-1', inMenu: false },
      { screenId: 'A-TEC-030', name: '지원자 관리', stage: '10' },
      { screenId: 'A-TEC-040', name: '교육 과정', stage: '10' },
      { screenId: 'A-TEC-041', name: '수강·수료 관리', stage: '10' },
      { screenId: 'A-TEC-050', name: '정착·이탈 분석', stage: '10' },
      { screenId: 'A-TEC-060', name: '자재 불출 관리', stage: '11' },
    ],
  },
  {
    key: 'PRD',
    name: '상품·가격',
    screens: [
      { screenId: 'A-PRD-010', name: '카테고리 관리', stage: '0' },
      { screenId: 'A-PRD-011', name: '상품 관리', stage: '0' },
      { screenId: 'A-PRD-020', name: '가격 정책', stage: '0' },
      { screenId: 'A-PRD-030', name: '할증·추가요금 규칙', stage: '0' },
      { screenId: 'A-PRD-040', name: '옵션·자재 마스터', stage: '0' },
      { screenId: 'A-PRD-050', name: '견적 시뮬레이터', stage: '1' },
    ],
  },
  {
    key: 'PAY',
    name: '결제',
    screens: [
      { screenId: 'A-PAY-010', name: '결제 내역', stage: '6-1' },
      { screenId: 'A-PAY-020', name: '결제 실패', stage: '6-1' },
      { screenId: 'A-PAY-030', name: '환불 처리', stage: '6-1' },
      { screenId: 'A-PAY-040', name: '미수금', stage: '6-1' },
      { screenId: 'A-PAY-050', name: '증빙', stage: '6-1' },
    ],
  },
  {
    key: 'STL',
    name: '정산',
    screens: [
      { screenId: 'A-STL-010', name: '수수료 정책', stage: '7' },
      { screenId: 'A-STL-020', name: '정산 회차', stage: '7' },
      { screenId: 'A-STL-030', name: '기사별 정산 검토·조정', stage: '7' },
      { screenId: 'A-STL-040', name: '원천세 자료', stage: '11' },
    ],
  },
  {
    key: 'CRM',
    name: 'CRM·VOC',
    screens: [
      { screenId: 'A-VOC-010', name: 'VOC 목록', stage: '8', section: 'VOC·품질' },
      { screenId: 'A-VOC-020', name: '안전사고 관리', stage: '8', section: 'VOC·품질' },
      { screenId: 'A-VOC-030', name: 'AS 요청', stage: '8', section: 'VOC·품질' },
      { screenId: 'A-VOC-040', name: '후기 관리', stage: '9', section: 'VOC·품질' },
      { screenId: 'A-CRM-010', name: '재방문 자동 캠페인', stage: '8', section: '마케팅' },
      { screenId: 'A-CRM-020', name: '캠페인 관리', stage: '9', section: '마케팅' },
      { screenId: 'A-CRM-030', name: '쿠폰 관리', stage: '9', section: '마케팅' },
      { screenId: 'A-CRM-040', name: '알림 템플릿·발송 이력', stage: '2', section: '마케팅' },
      { screenId: 'A-B2B-010', name: '거래처', stage: '11', section: 'B2B' },
      { screenId: 'A-B2B-020', name: '기회고객(리드)', stage: '11', section: 'B2B' },
      { screenId: 'A-B2B-030', name: 'B2B 견적서', stage: '11', section: 'B2B' },
      { screenId: 'A-CNT-010', name: '공지사항', stage: '8', section: '콘텐츠' },
      { screenId: 'A-CNT-020', name: 'FAQ', stage: '8', section: '콘텐츠' },
      { screenId: 'A-CNT-030', name: '기술자료·SOP', stage: '10', section: '콘텐츠' },
      { screenId: 'A-CNT-040', name: '메모·지정 메모 발송', stage: '10', section: '콘텐츠' },
      { screenId: 'A-CNT-050', name: '상담 스크립트', stage: '3', section: '콘텐츠' },
    ],
  },
  {
    key: 'STA',
    name: '통계',
    screens: [
      { screenId: 'A-STA-010', name: '매출', stage: '8' },
      { screenId: 'A-STA-020', name: '운영', stage: '9' },
      { screenId: 'A-STA-030', name: '기사 성과', stage: '9' },
      { screenId: 'A-STA-040', name: '고객·CRM', stage: '9' },
    ],
  },
  {
    key: 'SYS',
    name: '시스템',
    screens: [
      { screenId: 'A-SYS-010', name: '관리자 계정', stage: '0' },
      { screenId: 'A-SYS-020', name: '역할·권한', stage: '0' },
      { screenId: 'A-SYS-030', name: '거점 관리', stage: '0' },
      { screenId: 'A-SYS-040', name: '공통 코드', stage: '0' },
      { screenId: 'A-SYS-050', name: '공휴일·시스템 설정', stage: '0' },
      { screenId: 'A-SYS-060', name: '감사 로그', stage: '8' },
    ],
  },
];

/** 로그인만 하면 누구나 쓰는 화면 (권한 매트릭스 대상 아님) */
export const PUBLIC_ADMIN_SCREENS = ['A-AUTH-010', 'A-AUTH-020'] as const;

export function allAdminScreens(): AdminScreen[] {
  return ADMIN_MENU.flatMap((g) => g.screens);
}

export function isScreenReleased(
  screen: AdminScreen,
  released: readonly ImplementationStage[] = RELEASED_STAGES,
): boolean {
  return released.includes(screen.stage);
}
