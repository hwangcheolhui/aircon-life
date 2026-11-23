'use client';
// C-QUO-011 오픈 알림 신청 (C-QUO-010 서비스 불가 안내 안 폼) · F-CUS-QUO-08 (BR-003)
import type { AddressResult } from '@aircon/integrations/address';
import { Alert, Button, Check, Field, Input, MSG, Modal } from '@aircon/ui';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { requestAreaOpenNotice } from '@/app/(customer)/quote/actions';

type Done = 'SAVED' | 'ALREADY_SERVICEABLE' | 'DEMO';

const DONE_TEXT: Record<Done, { tone: 'success' | 'warning'; text: string }> = {
  SAVED: {
    tone: 'success',
    text: '신청이 완료되었습니다. 이 지역에서 서비스를 시작하면 문자로 알려 드릴게요.',
  },
  ALREADY_SERVICEABLE: {
    tone: 'success',
    text: '방금 서비스 가능한 지역이 되었어요. 주소를 다시 검색해 견적을 받아 보세요.',
  },
  DEMO: { tone: 'warning', text: '체험 모드라 신청 내용을 저장하지 않았습니다.' },
};

export function AreaOpenModal({
  address,
  onClose,
  onSearchAgain,
}: {
  address: AddressResult | null;
  onClose: () => void;
  onSearchAgain: () => void;
}) {
  const [phone, setPhone] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // 다른 주소로 다시 열리면 입력을 새로 받는다
  useEffect(() => {
    setPhone('');
    setAgreed(false);
    setErrors({});
    setFormError(null);
    setDone(null);
  }, [address?.legalDongCode]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!address) return;
    const missing: Record<string, string> = {};
    if (!phone.trim()) missing.phone = MSG.required('휴대폰 번호');
    if (!agreed) missing.privacyAgreed = MSG.required('개인정보 수집·이용 동의');
    setErrors(missing);
    setFormError(null);
    if (missing.phone) formRef.current?.querySelector<HTMLInputElement>('input[name="phone"]')?.focus();
    if (Object.keys(missing).length) return;
    setBusy(true);
    try {
      const r = await requestAreaOpenNotice({
        legalDongCode: address.legalDongCode,
        sido: address.sido,
        sigungu: address.sigungu,
        eupmyeondong: address.eupmyeondong,
        phone,
        privacyAgreed: agreed,
      });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        setFormError(
          r.message ??
            (r.fieldErrors && !r.fieldErrors.phone && !r.fieldErrors.privacyAgreed
              ? (Object.values(r.fieldErrors)[0] ?? null)
              : null),
        );
        return;
      }
      setDone(r.data?.kind ?? 'SAVED');
    } finally {
      setBusy(false);
    }
  };

  const areaName = address
    ? [address.sido, address.sigungu, address.eupmyeondong].filter(Boolean).join(' ')
    : '';

  if (done) {
    return (
      <Modal
        open={address !== null}
        title={done === 'ALREADY_SERVICEABLE' ? '서비스 가능한 지역이에요' : '오픈 알림 신청'}
        onClose={onClose}
        actions={
          <Button variant="primary" block onClick={done === 'ALREADY_SERVICEABLE' ? onSearchAgain : onClose}>
            {done === 'ALREADY_SERVICEABLE' ? '주소 다시 검색' : '확인'}
          </Button>
        }
      >
        <Alert tone={DONE_TEXT[done].tone}>{DONE_TEXT[done].text}</Alert>
      </Modal>
    );
  }

  return (
    <Modal
      open={address !== null}
      title="아직 서비스하지 않는 지역이에요"
      description={
        <>
          {address?.roadAddress}
          <br />
          서비스 지역을 차례로 넓혀 가고 있어요. 이 지역이 열리면 문자로 알려 드릴까요?
        </>
      }
      onClose={onClose}
    >
      <form ref={formRef} className="cus-open-form" onSubmit={submit} noValidate aria-label="오픈 알림 신청">
        <p className="ac-caption cus-open-form__area">
          신청 지역 <strong>{areaName}</strong>
        </p>
        <Field label="휴대폰 번호" required error={errors.phone}>
          {(id, describedBy, invalid) => (
            <Input
              id={id}
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="010-1234-5678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              maxLength={13}
            />
          )}
        </Field>
        <div className="cus-open-form__consent">
          <Check
            label="(필수) 오픈 알림을 위한 개인정보 수집·이용에 동의합니다."
            name="privacyAgreed"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            aria-invalid={Boolean(errors.privacyAgreed) || undefined}
          />
          <p className="ac-caption">
            수집 항목: 휴대폰 번호 · 이용 목적: 서비스 지역 오픈 안내 1회 · 보관: 안내 발송 즉시 삭제(안내
            전이라도 1년 지나면 삭제)
          </p>
          {errors.privacyAgreed ? (
            <span className="ac-help cus-open-form__error" role="alert">
              {errors.privacyAgreed}
            </span>
          ) : null}
        </div>
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <div className="ac-btn-group">
          <Button type="button" variant="outline" block onClick={onSearchAgain}>
            다른 주소 검색
          </Button>
          <Button type="submit" variant="primary" block loading={busy}>
            알림 신청
          </Button>
        </div>
      </form>
    </Modal>
  );
}
