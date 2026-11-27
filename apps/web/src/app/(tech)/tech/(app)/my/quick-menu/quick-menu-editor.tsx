'use client';
// T-MY-020 퀵메뉴 편집 (F-TEC-HOM-04): 선택한 메뉴(순서 변경) + 전체 메뉴(★ 추가·해제)
import { moveQuickMenu, toggleQuickMenu } from '@aircon/domain';
import { Alert, Button, ConfirmModal, Empty, MSG, useToast } from '@aircon/ui';
import { ArrowDown, ArrowUp, Star } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveQuickMenuAction } from '../../support-actions';

export function QuickMenuEditor({ initial, menus }: { initial: string[]; menus: { code: string; name: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [codes, setCodes] = useState<string[]>(initial);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const name = (c: string) => menus.find((m) => m.code === c)?.name ?? c;
  return (
    <div className="tec-section">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <section className="tec-section" aria-labelledby="sel-title">
        <h2 id="sel-title" className="ac-h3">
          홈에 보일 순서
        </h2>
        {codes.length ? (
          <ol className="ac-list">
            {codes.map((c, i) => (
              <li key={c} className="ac-list-item">
                <span className="ac-num ac-caption">{i + 1}</span>
                <span className="ac-list-item__body ac-body">{name(c)}</span>
                <button type="button" className="ac-btn ac-btn--ghost ac-btn--icon" aria-label={`${name(c)} 위로`} disabled={i === 0} onClick={() => setCodes(moveQuickMenu(codes, i, i - 1))}>
                  <ArrowUp aria-hidden />
                </button>
                <button type="button" className="ac-btn ac-btn--ghost ac-btn--icon" aria-label={`${name(c)} 아래로`} disabled={i === codes.length - 1} onClick={() => setCodes(moveQuickMenu(codes, i, i + 1))}>
                  <ArrowDown aria-hidden />
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <Empty>아래에서 ★ 를 눌러 메뉴를 추가하세요.</Empty>
        )}
      </section>
      <section className="tec-section" aria-labelledby="all-title">
        <h2 id="all-title" className="ac-h3">
          전체 메뉴
        </h2>
        <ul className="ac-list">
          {menus.map((m) => {
            const on = codes.includes(m.code);
            return (
              <li key={m.code} className="ac-list-item">
                <span className="ac-list-item__body ac-body">{m.name}</span>
                <button type="button" className={`ac-btn ac-btn--ghost ac-btn--icon tec-star${on ? ' is-on' : ''}`} aria-pressed={on} aria-label={`${m.name} 퀵메뉴 ${on ? '해제' : '추가'}`} onClick={() => setCodes(toggleQuickMenu(codes, m.code))}>
                  <Star aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <Button variant="primary" size="lg" block loading={pending} onClick={() => setConfirm(true)}>
        저장
      </Button>
      <ConfirmModal
        open={confirm}
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          start(async () => {
            setError(null);
            const r = await saveQuickMenuAction(codes);
            if (!r.ok) return setError(r.message ?? '저장하지 못했습니다.');
            toast(MSG.saved);
            router.refresh();
          });
        }}
      />
    </div>
  );
}
