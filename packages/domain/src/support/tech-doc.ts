/**
 * 기술자료·SOP 규칙 (단계 10, F-ADM-CNT-03 · F-TEC-EDU-01, 01 §2.13.4).
 * - 유형: SOP·기술가이드·CS Tip·안전·서비스 핸드북, 기기 유형(비우면 공통)
 * - 버전: 처음 1, 제목·내용·첨부가 바뀌면 1 올린다(필독만 바꾸면 그대로)
 * - 첨부: 최대 TECH_DOC_MAX_FILES개. 한 번 저장할 때 새로 올리는 파일 합계 3.5MB 이하(서버 액션 본문 제한 4MB 안). 더 올리려면 나눠서 저장
 */
export const TECH_DOC_TYPES = ['SOP', 'TECH_GUIDE', 'CS_TIP', 'SAFETY', 'HANDBOOK'] as const;
export type TechDocType = (typeof TECH_DOC_TYPES)[number];
export const TECH_DOC_MAX_FILES = 3;
/** 한 번 저장에 새로 올리는 첨부 합계 상한 */
export const TECH_DOC_MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024;
export const TECH_DOC_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;

export function nextDocVersion(
  prev: { version: number; title: string; content: string; fileIds: readonly number[] } | null,
  next: { title: string; content: string; fileIds: readonly number[] },
): number {
  if (!prev) return 1;
  const sameFiles = prev.fileIds.length === next.fileIds.length && prev.fileIds.every((id, i) => id === next.fileIds[i]);
  return prev.title === next.title && prev.content === next.content && sameFiles ? prev.version : prev.version + 1;
}

/** 첨부 검증: 개수·크기·형식 */
export function checkDocFiles(files: readonly { size: number; type: string }[], keptCount: number): string | null {
  if (files.length + keptCount > TECH_DOC_MAX_FILES) return `첨부는 ${TECH_DOC_MAX_FILES}개까지 올릴 수 있습니다.`;
  if (files.reduce((sum, f) => sum + f.size, 0) > TECH_DOC_MAX_UPLOAD_BYTES) return '한 번에 올리는 첨부는 합계 3.5MB 이하여야 합니다. 나눠서 저장해 주세요.';
  if (files.some((f) => !(TECH_DOC_FILE_TYPES as readonly string[]).includes(f.type))) return 'PDF 또는 사진(JPG·PNG·WEBP)만 올릴 수 있습니다.';
  return null;
}

/** file_ids 컬럼(쉼표 구분) ↔ 숫자 목록 */
export const parseFileIds = (s: string | null | undefined): number[] =>
  (s ?? '')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
export const joinFileIds = (ids: readonly number[]) => (ids.length ? ids.join(',') : null);

/** 기사 앱 정렬: 필독 먼저, 최근 수정 순 */
export function sortTechDocs<T extends { isRequiredRead: boolean; updatedAt: Date }>(docs: readonly T[]): T[] {
  return [...docs].sort((a, b) => Number(b.isRequiredRead) - Number(a.isRequiredRead) || b.updatedAt.getTime() - a.updatedAt.getTime());
}
