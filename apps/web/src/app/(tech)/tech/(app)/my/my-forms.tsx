'use client';
// T-MY-010 소개·비밀번호 저장 (저장 전 확인 → 저장 후 "저장에 성공하였습니다.")
import { Alert, Button, ConfirmModal, Field, Input, MSG, Textarea, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveIntro, savePassword } from '../actions';

export function IntroForm({ intro }: { intro: string }) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState(intro);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="tec-section"
      onSubmit={(e) => {
        e.preventDefault();
        setConfirm(true);
      }}
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="소개" help="고객 예약 화면에 기사 이름과 함께 보여요. (300자 이내)">
        {(id, d) => (
          <Textarea
            id={id}
            aria-describedby={d}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={300}
            rows={3}
          />
        )}
      </Field>
      <Button type="submit" variant="outline" block loading={pending}>
        소개 저장
      </Button>
      <ConfirmModal
        open={confirm}
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          start(async () => {
            const r = await saveIntro({ intro: value });
            if (!r.ok) return setError(r.message ?? '저장하지 못했습니다.');
            toast(MSG.saved);
            router.refresh();
          });
        }}
      />
    </form>
  );
}

export function PasswordForm() {
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  return (
    <form
      className="tec-section"
      onSubmit={(e) => {
        e.preventDefault();
        setConfirm(true);
      }}
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field
        label="새 비밀번호"
        required
        error={errors.newPassword}
        help="8자 이상, 영문과 숫자를 함께 넣어 주세요."
      >
        {(id, d, inv) => (
          <Input
            id={id}
            aria-describedby={d}
            aria-invalid={inv}
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete="new-password"
          />
        )}
      </Field>
      <Field label="새 비밀번호 확인" required error={errors.newPasswordConfirm}>
        {(id, d, inv) => (
          <Input
            id={id}
            aria-describedby={d}
            aria-invalid={inv}
            type="password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            autoComplete="new-password"
          />
        )}
      </Field>
      <Button type="submit" variant="outline" block loading={pending}>
        비밀번호 저장
      </Button>
      <ConfirmModal
        open={confirm}
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          start(async () => {
            setError(null);
            const r = await savePassword({ newPassword: pw, newPasswordConfirm: pw2 });
            if (!r.ok) {
              setErrors(r.fieldErrors ?? {});
              return setError(r.message ?? null);
            }
            setErrors({});
            setPw('');
            setPw2('');
            toast(MSG.saved);
          });
        }}
      />
    </form>
  );
}
