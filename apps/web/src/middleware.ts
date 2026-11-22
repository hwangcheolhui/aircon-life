/**
 * /admin 접근 제어: (1) 관리자 접속 IP 제한(옵션, 02 §7) (2) 세션 확인·갱신 → 없으면 로그인 화면.
 * ADMIN_AUTH_BYPASS=true(임시 개발 모드)면 세션 없이도 통과시키고, 서버에서 읽기 전용 열람자로 처리한다.
 * 권한(메뉴×행위)과 계정 상태는 서버 컴포넌트(requireAdmin/requireScreen)와 서버 액션(requirePermission)에서 다시 확인한다.
 */
import { createAuthAdapter } from '@aircon/integrations';
import { type NextRequest, NextResponse } from 'next/server';

export const config = { matcher: ['/admin/:path*'], runtime: 'nodejs' };

function clientIp(req: NextRequest) {
  return (req.headers.get('x-forwarded-for')?.split(',')[0] ?? req.headers.get('x-real-ip') ?? '').trim();
}

export async function middleware(req: NextRequest) {
  const allowed = (process.env.ADMIN_ALLOWED_IPS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(clientIp(req))) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  let res = NextResponse.next({ request: req });
  const auth = createAuthAdapter({
    getAll: () => req.cookies.getAll().map((c) => ({ name: c.name, value: c.value })),
    setAll: (list) => {
      for (const c of list) req.cookies.set(c.name, c.value);
      res = NextResponse.next({ request: req });
      for (const c of list) res.cookies.set(c.name, c.value, c.options);
    },
  });
  const userId = await auth.getSessionUserId();
  const isLogin = req.nextUrl.pathname === '/admin/login';
  // 임시 개발 모드(ADMIN_AUTH_BYPASS=true): 로그인 없이 읽기 전용 열람 허용. 쓰기는 서버 액션 requirePermission이 막는다.
  const bypass = process.env.ADMIN_AUTH_BYPASS === 'true';
  if (!userId && !isLogin && !bypass) {
    const url = req.nextUrl.clone();
    url.pathname = '/admin/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return res;
}
