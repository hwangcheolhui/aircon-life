// 기사 앱 정산 화면 공용 표시 (색 + 글자를 함께 표시)
export const SETTLEMENT_TECH_TONE: Record<string, 'primary' | 'success' | 'warning' | 'danger' | undefined> = {
  CALCULATED: 'primary',
  TECH_CONFIRMED: 'success',
  DISPUTED: 'danger',
  CONFIRMED: 'warning',
  PAID: 'success',
};

export const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
export const signedWon = (n: number) => (n < 0 ? `−${won(-n)}` : won(n));
