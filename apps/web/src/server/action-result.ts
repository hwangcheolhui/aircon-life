import 'server-only';
import { fieldErrors, type z } from '@aircon/contracts';
import { ForbiddenError } from './auth';

export type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; message?: string; fieldErrors?: Record<string, string> };

/** 서버 액션 공통 처리: 입력 검증 오류·권한 오류·DB 제약 오류를 화면 문구로 바꾼다 */
export async function handle<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (e) {
    if (e instanceof ValidationFailed) return { ok: false, fieldErrors: e.errors };
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    if (e instanceof UserError) return { ok: false, message: e.message };
    if (e instanceof ConfigError) {
      console.error(e);
      return { ok: false, message: `서버 설정 오류: ${e.message} 관리자에게 문의해 주세요.` };
    }
    const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
    if (code === '23505') return { ok: false, message: '이미 등록된 값입니다. 코드·ID 중복을 확인하세요.' };
    if (code === '23503') return { ok: false, message: '다른 데이터에서 사용 중이라 처리할 수 없습니다.' };
    console.error(e);
    return { ok: false, message: '처리 중 오류가 발생했습니다.' };
  }
}

export class ValidationFailed extends Error {
  constructor(public errors: Record<string, string>) {
    super('validation');
  }
}
export class UserError extends Error {}

/** 서버 환경변수 누락·형식 오류. 원인을 바로 찾을 수 있게 변수 이름을 화면에 보여 준다(값은 보여 주지 않음) */
export class ConfigError extends Error {}

export function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new ValidationFailed(fieldErrors(r.error));
  return r.data;
}
