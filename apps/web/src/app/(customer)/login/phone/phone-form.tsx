'use client';
// C-AUTH-030 휴대폰 인증 입력 (모의 인증번호 또는 포트원 본인인증 창)
import { Alert, Button, Field, Input } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { type PortOneConfig, portoneIdentity } from '@/customer/portone';
import { confirmIdentity, confirmPhoneCode, requestPhoneCode } from '../actions';

type Step = { step: 'DONE'; linked: boolean } | { step: 'TERMS' };

export function PhoneForm({
  next,
  driver,
  autoVerify,
  portone,
}: {
  next: string;
  driver: 'mock' | 'portone';
  /** 임시 테스트 모드: [인증번호 받기]만으로 인증 완료 */
  autoVerify: boolean;
  portone: PortOneConfig | null;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [mockCode, setMockCode] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const go = (r: Step) => {
    if (r.step === 'TERMS') router.push(`/login/terms?next=${encodeURIComponent(next)}`);
    else {
      if (r.linked) setNotice('전화로 예약하셨던 이력을 찾아 연결했어요.');
      router.replace(next);
      router.refresh();
    }
  };

  if (driver === 'portone') {
    return (
      <>
        {message ? <Alert tone="danger">{message}</Alert> : null}
        <Button
          variant="primary"
          size="lg"
          block
          loading={pending}
          onClick={() =>
            start(async () => {
              setMessage(null);
              const r = await portoneIdentity(portone!, `IV${Date.now()}${Math.random().toString(36).slice(2, 8)}`);
              if (!r.ok) return setMessage(r.message);
              const res = await confirmIdentity(r.id);
              if (!res.ok) return setMessage(res.message ?? '본인인증에 실패했습니다.');
              go(res.data as Step);
            })
          }
        >
          본인인증하기
        </Button>
      </>
    );
  }

  return (
    <form
      className="cus-section"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setMessage(null);
          setErrors({});
          if (!mockCode) {
            const r = await requestPhoneCode({ name, phone });
            if (!r.ok) {
              setErrors(r.fieldErrors ?? {});
              return setMessage(r.message ?? null);
            }
            const d = r.data as { mockCode: string } | { verified: Step };
            if ('verified' in d) return go(d.verified);
            setMockCode(d.mockCode);
            return;
          }
          const r = await confirmPhoneCode({ phone, code });
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            return setMessage(r.message ?? null);
          }
          go(r.data as Step);
        });
      }}
    >
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {message ? <Alert tone="danger">{message}</Alert> : null}
      {autoVerify ? <Alert tone="warning">테스트 모드: 인증번호 받기를 누르면 인증이 바로 완료돼요.</Alert> : null}
      <Field label="이름" required error={errors.name}>
        {(id, d, inv) => (
          <Input id={id} aria-describedby={d} aria-invalid={inv} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" disabled={Boolean(mockCode)} />
        )}
      </Field>
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
      {mockCode ? (
        <>
          <div className="cus-mock-box" role="status">
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
            확인
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
  );
}
