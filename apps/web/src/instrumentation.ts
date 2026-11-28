// Next.js 서버 오류 훅: 화면 렌더링·서버 액션에서 난 오류를 최근 오류 목록에 남긴다(/api/health 에서 확인).
import type { Instrumentation } from 'next';

export function register() {}

export const onRequestError: Instrumentation.onRequestError = async (err, request) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { recordError } = await import('./server/recent-errors');
  recordError(request.path, err);
};
