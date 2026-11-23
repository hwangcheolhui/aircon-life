// 고객 화면 금액·시간 표시 (서버·클라이언트 공용)
export const formatWon = (n: number) => `${n.toLocaleString('ko-KR')}원`;

export function formatDuration(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h && m ? `${h}시간 ${m}분` : h ? `${h}시간` : `${m}분`;
}
