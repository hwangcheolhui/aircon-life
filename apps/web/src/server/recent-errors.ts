/**
 * 최근 서버 오류 몇 건을 메모리에 남긴다(설정 점검 /api/health 에서 보여 주기용).
 * 운영 화면 오류는 "Digest"만 보이므로, 같은 서버 인스턴스에서 난 오류의 실제 메시지를 확인할 수 있게 한다.
 * 메시지에서 접속 주소·비밀번호처럼 보이는 부분은 지운다. 개인정보를 담지 않는 오류 메시지만 남는다.
 */
export type RecentError = { at: string; path: string; digest: string | null; code: string | null; message: string };

const g = globalThis as unknown as { __acRecentErrors?: RecentError[] };

export function scrub(text: string): string {
  return text
    .replace(/\s*params:[^/]*/g, ' ') // 쿼리 값(개인정보일 수 있음)은 지운다
    .replace(/postgres(ql)?:\/\/\S+/gi, '<url>')
    .replace(/password=\S+/gi, 'password=<hidden>')
    .replace(/01[016789]-?\d{3,4}-?\d{4}/g, '<phone>')
    .slice(0, 300);
}

export function recordError(path: string, e: unknown) {
  const list = (g.__acRecentErrors ??= []);
  let message = '';
  let code: string | null = null;
  let cur: unknown = e;
  for (let i = 0; i < 3 && cur && typeof cur === 'object'; i++) {
    const m = (cur as { message?: unknown }).message;
    if (typeof m === 'string' && m) message += (message ? ' / ' : '') + m;
    const c = (cur as { code?: unknown }).code;
    if (!code && typeof c === 'string') code = c;
    cur = (cur as { cause?: unknown }).cause;
  }
  const digest = (e as { digest?: unknown })?.digest;
  if (typeof digest === 'string' && list.some((x) => x.digest === digest)) return;
  list.unshift({ at: new Date().toISOString(), path: path.split('?')[0] ?? path, digest: typeof digest === 'string' ? digest : null, code, message: scrub(message) });
  list.length = Math.min(list.length, 10);
}

export const recentErrors = (): RecentError[] => g.__acRecentErrors ?? [];
