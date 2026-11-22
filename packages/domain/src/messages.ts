// 공통 문구는 domain(브라우저·서버 공용)에 두고 UI는 다시 내보낸다.
/** 공통 문구 (CLAUDE.md §8, 03 §6.2). 화면에서 직접 쓰지 않고 이 함수를 쓴다. */

/** 받침 여부로 은/는 선택 */
export function josaEunNeun(word: string): string {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return `${word}은(는)`;
  return (code - 0xac00) % 28 === 0 ? `${word}는` : `${word}은`;
}

export const MSG = {
  confirmSave: '저장하시겠습니까?',
  saved: '저장에 성공하였습니다.',
  confirmDelete: '삭제하시겠습니까?',
  deleted: '삭제에 성공하였습니다.',
  empty: '조회 결과가 없습니다.',
  required: (label: string) => `${josaEunNeun(label)} 필수 입력값입니다.`,
  forbidden: '권한이 없습니다.',
} as const;
