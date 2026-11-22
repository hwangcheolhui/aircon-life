'use client';
import { Alert, Button, Field, Input, MSG, useToast } from '@aircon/ui';
import { useActionState, useEffect, useRef } from 'react';
import { changePasswordAction } from './actions';

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, null);
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  useEffect(() => {
    if (state?.ok) {
      toast(MSG.saved);
      formRef.current?.reset();
    }
  }, [state, toast]);
  const fields: [string, string, string][] = [
    ['currentPassword', '현재 비밀번호', 'current-password'],
    ['newPassword', '새 비밀번호', 'new-password'],
    ['newPasswordConfirm', '새 비밀번호 확인', 'new-password'],
  ];
  return (
    <form ref={formRef} action={action} className="ac-card ac-stack" noValidate>
      {state && !state.ok && state.message ? <Alert tone="danger">{state.message}</Alert> : null}
      {fields.map(([name, label, ac]) => (
        <Field key={name} label={label} required error={errors[name]} help={name === 'newPassword' ? '영문과 숫자를 함께 포함합니다.' : undefined}>
          {(id, d, inv) => <Input id={id} name={name} type="password" autoComplete={ac} aria-describedby={d} aria-invalid={inv} />}
        </Field>
      ))}
      <Button type="submit" variant="primary" loading={pending}>
        변경
      </Button>
    </form>
  );
}
