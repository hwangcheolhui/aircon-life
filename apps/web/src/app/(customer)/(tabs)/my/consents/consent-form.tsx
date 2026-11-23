'use client';
// C-MY-030 선택 동의 토글 (바뀔 때마다 바로 저장, 이력은 서버가 INSERT)
import { Alert } from '@aircon/ui';
import { useState, useTransition } from 'react';
import { saveConsents } from '../actions';

export function ConsentForm({ items, demo }: { items: { type: string; label: string; on: boolean }[]; demo: boolean }) {
  const [state, setState] = useState(Object.fromEntries(items.map((i) => [i.type, i.on])));
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="ac-card cus-section">
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {items.map((i) => (
        <label key={i.type} className="ac-switch cus-consent-row">
          <span className="ac-body">{i.label}</span>
          <input
            type="checkbox"
            role="switch"
            checked={Boolean(state[i.type])}
            disabled={pending || demo}
            onChange={(e) => {
              const next = { ...state, [i.type]: e.target.checked };
              setState(next);
              start(async () => {
                const r = await saveConsents(next);
                setMessage(r.ok ? { tone: 'success', text: '저장에 성공하였습니다.' } : { tone: 'danger', text: r.message ?? '저장하지 못했습니다.' });
              });
            }}
          />
        </label>
      ))}
    </div>
  );
}
