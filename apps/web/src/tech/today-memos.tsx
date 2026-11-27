'use client';
// T-MEMO-020 오늘의 메모 (F-TEC-HOM-02 · F-TEC-MEMO-03 일부)
// - 홈 [오늘의 메모 n/m] 카드를 누르면 열리고, 팝업을 켠 받은 메모를 아직 확인하지 않았으면 홈에 들어올 때 자동으로 열린다.
// - 우선순위: 거점장 > 관리자 > 본인 (02 F-TEC-HOM-02). 내 메모는 완료 체크, 받은 메모는 [확인](read_at 기록).
// - 08:30 정시 팝업·On/Off 설정은 단계 11.
import { Alert, Button, Check, Modal, Tag, useToast } from '@aircon/ui';
import { StickyNote } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { confirmMemosAction, toggleMemoDoneAction } from '@/app/(tech)/tech/(app)/support-actions';

export interface TodayMemoView {
  id: number;
  header: string | null;
  content: string;
  source: string;
  sourceCode: string | null;
  mine: boolean;
  isDone: boolean;
  read: boolean;
  authorName: string;
  relatedOrderNo: string | null;
}

export function TodayMemos({ memos, autoOpen }: { memos: TodayMemoView[]; autoOpen: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(autoOpen);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const done = memos.filter((m) => (m.mine ? m.isDone : m.read)).length;
  const unread = memos.filter((m) => !m.mine && !m.read).map((m) => m.id);

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.message ?? '처리하지 못했습니다.');
      after?.();
      router.refresh();
    });

  return (
    <>
      <button type="button" className="tec-todo-card" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <StickyNote aria-hidden />
        <span className="ac-body">오늘의 메모</span>
        <strong className="ac-num">
          {done}/{memos.length}
        </strong>
        {unread.length ? <Tag tone="danger">미확인 {unread.length}</Tag> : null}
      </button>
      <Modal
        open={open}
        title="오늘의 메모"
        onClose={() => setOpen(false)}
        actions={
          <>
            <Link href="/tech/memos/new" className="ac-btn ac-btn--outline">
              메모 등록
            </Link>
            {unread.length ? (
              <Button variant="primary" loading={pending} onClick={() => run(() => confirmMemosAction(unread), () => toast('확인했습니다.'))}>
                확인
              </Button>
            ) : (
              <Button variant="dark" onClick={() => setOpen(false)}>
                닫기
              </Button>
            )}
          </>
        }
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {memos.length ? (
          <ul className="ac-list tec-memo-list">
            {memos.map((m) => (
              <li key={m.id} className={`ac-list-item${(m.mine ? m.isDone : m.read) ? ' is-done' : ''}`}>
                <div className="ac-list-item__body">
                  <div className="tec-job-card__top">
                    {m.sourceCode !== 'SELF' ? <Tag tone={m.sourceCode === 'BRANCH_MANAGER' ? 'danger' : 'primary'}>{m.source}</Tag> : <Tag>{m.source}</Tag>}
                    {m.header ? <span className="ac-body-sm">[{m.header}]</span> : null}
                    {!m.mine ? <span className="ac-caption">{m.authorName}</span> : null}
                  </div>
                  <p className="ac-body tec-note">{m.content}</p>
                  {m.relatedOrderNo ? (
                    <Link href={`/tech/jobs/${m.relatedOrderNo}`} className="ac-body-sm ac-num">
                      {m.relatedOrderNo}
                    </Link>
                  ) : null}
                </div>
                {m.mine ? (
                  <Check label="완료" checked={m.isDone} disabled={pending} onChange={(e) => run(() => toggleMemoDoneAction(m.id, e.target.checked))} />
                ) : m.read ? (
                  <span className="ac-body-sm">확인함</span>
                ) : null}
                {m.mine ? (
                  <Link href={`/tech/memos/${m.id}`} className="ac-btn ac-btn--text ac-btn--sm">
                    수정
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ac-body">오늘 메모가 없습니다.</p>
        )}
      </Modal>
    </>
  );
}
