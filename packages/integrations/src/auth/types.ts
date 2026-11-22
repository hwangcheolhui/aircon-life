/**
 * 인증 연동 인터페이스. Real = Supabase Auth, Mock = 로컬 파일 + 서명 쿠키 (로컬 개발·테스트용).
 * AUTH_DRIVER=supabase|mock 으로 전환한다.
 */
export interface CookieRecord {
  name: string;
  value: string;
  options?: Record<string, unknown>;
}

/** Next.js cookies()와 같은 모양. 요청마다 새로 만든다. */
export interface CookieAccessor {
  getAll(): { name: string; value: string }[];
  setAll(cookies: CookieRecord[]): void;
}

export interface AuthAdapter {
  /** 이메일·비밀번호로 로그인하고 세션 쿠키를 심는다. 실패 시 null */
  signInWithPassword(email: string, password: string): Promise<{ authUserId: string } | null>;
  /** 현재 세션의 인증 사용자 ID (세션 갱신 포함). 없으면 null */
  getSessionUserId(): Promise<string | null>;
  signOut(): Promise<void>;
  /** 관리자 API: 계정 생성 → 인증 사용자 ID */
  createUser(email: string, password: string): Promise<string>;
  /** 관리자 API: 비밀번호 설정(본인 변경·초기화) */
  setPassword(authUserId: string, password: string): Promise<void>;
  /** 관리자 API: 이메일 변경 */
  setEmail(authUserId: string, email: string): Promise<void>;
}
