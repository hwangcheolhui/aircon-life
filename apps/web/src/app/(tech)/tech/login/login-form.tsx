'use client';
// T-AUTH-010 로그인 폼: [비밀번호 | 인증번호] (F-TEC-AUTH-01)
import { Alert, Button, Field, Input } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { type PortOneConfig, portoneIdentity } from '@/customer/portone';
import { confirmTechCode, confirmTechPortOne, loginWithPassword, requestTechCode } from './actions';

type Mode = 'OTP' | 'PASSWORD';

export function TechLoginForm({ driver, autoVerify, portone }: { driver: 'mock' | 'portone'; autoVerify: boolean; portone: PortOneConfig | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('OTP');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mockCode, setMockCode] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const done = () => {
    router.replace('/tech');
    router.refresh();
  };
  const fail = (r: { message?: string; fieldErrors?: Record<string, string> }) => {
    setErrors(r.fieldErrors ?? {});
    setMessage(r.message ?? null);
  };
  const switchMode = (m: Mode) => {
    setMode(m);
    setMessage(null);
    setErrors({});
    setMockCode(null);
    setCode('');
  };

  const phoneField = (
    <Field label="휴대폰 번호" required error={errors.phone}>
      {(id, d, inv) => (
        <Input
          id={id}
          aria-describedby={d}
          aria-invalid={inv}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="numeric"
          autoComplete="tel"
          placeholder="01012345678"
          disabled={Boolean(mockCode)}
        />
      )}
    </Field>
  );

  return (
    <div className="tec-section">
      <div className="ac-segmented" role="group" aria-label="로그인 방법">
        <button type="button" aria-pressed={mode === 'OTP'} onClick={() => switchMode('OTP')}>
          인증번호
        </button>
        <button type="button" aria-pressed={mode === 'PASSWORD'} onClick={() => switchMode('PASSWORD')}>
          비밀번호
        </button>
      </div>
      {message ? <Alert tone="danger">{message}</Alert> : null}

      {mode === 'PASSWORD' ? (
        <form
          className="tec-section"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setMessage(null);
              const r = await loginWithPassword({ phone, password });
              if (!r.ok) return fail(r);
              done();
            });
          }}
        >
          {phoneField}
          <Field label="비밀번호" required error={errors.password}>
            {(id, d, inv) => (
              <Input id={id} aria-describedby={d} aria-invalid={inv} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            )}
          </Field>
          <Button type="submit" variant="primary" size="lg" block loading={pending}>
            로그인
          </Button>
        </form>
      ) : driver === 'portone' ? (
        <Button
          variant="primary"
          size="lg"
          block
          loading={pending}
          onClick={() =>
            start(async () => {
              setMessage(null);
              const r = await portoneIdentity(portone!, `TIV${Date.now()}${Math.random().toString(36).slice(2, 8)}`);
              if (!r.ok) return setMessage(r.message);
              const res = await confirmTechPortOne(r.id);
              if (!res.ok) return fail(res);
              done();
            })
          }
        >
          휴대폰 본인인증으로 로그인
        </Button>
      ) : (
        <form
          className="tec-section"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setMessage(null);
              setErrors({});
              if (!mockCode) {
                const r = await requestTechCode({ phone });
                if (!r.ok) return fail(r);
                const d = r.data as { mockCode: string } | { done: true };
                if ('done' in d) return done();
                setMockCode(d.mockCode);
                return;
              }
              const r = await confirmTechCode({ phone, code });
              if (!r.ok) return fail(r);
              done();
            });
          }}
        >
          {autoVerify ? <Alert tone="warning">테스트 모드: 인증번호 받기를 누르면 인증이 바로 완료돼요.</Alert> : null}
          {phoneField}
          {mockCode ? (
            <>
              <div className="tec-mock-box" role="status">
                <span className="ac-caption">개발용 모의 인증입니다. 실제 문자는 가지 않아요.</span>
                <span className="ac-body">
                  인증번호 <strong className="ac-num">{mockCode}</strong>
                </span>
              </div>
              <Field label="인증번호" required error={errors.code}>
                {(id, d, inv) => (
                  <Input id={id} aria-describedby={d} aria-invalid={inv} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
                )}
              </Field>
              <Button type="submit" variant="primary" size="lg" block loading={pending}>
                로그인
              </Button>
              <Button type="button" variant="ghost" block onClick={() => (setMockCode(null), setCode(''))}>
                번호 다시 입력
              </Button>
            </>
          ) : (
            <Button type="submit" variant="primary" size="lg" block loading={pending}>
              인증번호 받기
            </Button>
          )}
        </form>
      )}
    </div>
  );
}
