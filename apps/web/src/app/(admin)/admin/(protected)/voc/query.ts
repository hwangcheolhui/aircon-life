// VOC·안전사고·AS 화면 공통 조회 조건 (A-VOC-010·020·030)
const isDate = (v: string | undefined) => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));
export const dateOrNull = (v: string | undefined) => (isDate(v) ? v! : null);
export const strOrNull = (v: string | undefined) => (v && /^[A-Z_]{1,30}$/.test(v) ? v : null);
