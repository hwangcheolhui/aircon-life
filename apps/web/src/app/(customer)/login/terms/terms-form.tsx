'use client';
// C-AUTH-020 약관 동의 입력 (필수 미동의 시 가입 불가, 선택 항목은 나중에 C-MY-030 에서 바꿀 수 있음)
import { Alert, Button, Check, Modal } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { submitSignup } from '../actions';

interface Item {
  type: string;
  required: boolean;
  label: string;
}

export function TermsForm({ items, next }: { items: Item[]; next: string }) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, boolean>>({});
  const [view, setView] = useState<Item | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const all = items.every((i) => state[i.type]);
  const requiredOk = items.filter((i) => i.required).every((i) => state[i.type]);
  return (
    <form
      className="cus-section"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await submitSignup(state, null);
          if (!r.ok) return setMessage(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '가입에 실패했습니다.');
          router.replace(next);
          router.refresh();
        });
      }}
    >
      {message ? <Alert tone="danger">{message}</Alert> : null}
      <div className="cus-consent-all">
        <Check
          label="전체 동의"
          checked={all}
          onChange={(e) => setState(Object.fromEntries(items.map((i) => [i.type, e.target.checked])))}
        />
      </div>
      {items.map((i) => (
        <div key={i.type} className="cus-consent-row">
          <Check
            label={`[${i.required ? '필수' : '선택'}] ${i.label}`}
            checked={Boolean(state[i.type])}
            onChange={(e) => setState((s) => ({ ...s, [i.type]: e.target.checked }))}
          />
          <button type="button" className="ac-btn ac-btn--text ac-btn--sm" onClick={() => setView(i)}>
            보기
          </button>
        </div>
      ))}
      <p className="ac-caption">선택 항목은 동의하지 않아도 가입할 수 있고, 마이 &gt; 동의·알림 설정에서 언제든 바꿀 수 있어요.</p>
      <Button type="submit" variant="primary" size="lg" block disabled={!requiredOk} loading={pending}>
        동의하고 가입하기
      </Button>
      <Modal
        open={view !== null}
        title={view?.label ?? ''}
        onClose={() => setView(null)}
        actions={
          <Button variant="primary" onClick={() => setView(null)}>
            확인
          </Button>
        }
      >
        <p className="ac-body-sm">
          {view?.label} 전문은 운영사가 확정한 약관 문서를 게시합니다. 동의 내역(항목·시각·약관 버전)은 기록으로 남고, 선택 항목은 언제든 철회할 수
          있어요.
        </p>
      </Modal>
    </form>
  );
}
