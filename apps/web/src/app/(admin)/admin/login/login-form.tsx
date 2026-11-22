'use client';
import { Alert, Button, Card, Field, Input } from '@aircon/ui';
import { useActionState } from 'react';
import { loginAction } from './actions';

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const formError = errors._ ?? (state && !state.ok ? state.message : undefined);
  return (
    <Card>
      <form action={action} className="ac-stack" noValidate>
        <h1 className="ac-h2">관리자 로그인</h1>
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <Field label="ID" required error={errors.loginId}>
          {(id, d, inv) => <Input id={id} name="loginId" autoComplete="username" aria-describedby={d} aria-invalid={inv} />}
        </Field>
        <Field label="비밀번호" required error={errors.password}>
          {(id, d, inv) => (
            <Input id={id} name="password" type="password" autoComplete="current-password" aria-describedby={d} aria-invalid={inv} />
          )}
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={pending}>
          로그인
        </Button>
      </form>
    </Card>
  );
}
