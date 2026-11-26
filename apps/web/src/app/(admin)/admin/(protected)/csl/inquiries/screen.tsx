'use client';
// A-CSL-080 1:1 문의 관리: [답변 대기 | 답변 완료 | 전체], 행 더블클릭 = 답변 창, 저장 전 확인(03 §6.2)
import { Alert, Button, ConfirmModal, Empty, Field, MSG, Modal, Tag, Textarea, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import type { listInquiries } from '@/server/inquiries';
import { inquiryToFaqAction, inquiryToVocAction, replyInquiryAction } from './actions';

type Row = Awaited<ReturnType<typeof listInquiries>>[number];
type Res = { ok: boolean; message?: string; fieldErrors?: Record<string, string>; data?: unknown };
const TABS = [
  { value: 'OPEN', label: '답변 대기' },
  { value: 'DONE', label: '답변 완료' },
  { value: 'ALL', label: '전체' },
];

export function InquiriesScreen(p: { rows: Row[]; status: string; codes: Record<string, Option[]>; canReply: boolean; canVoc: boolean; canFaq: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState<Row | null>(null);
  const [reply, setReply] = useState('');
  const [confirm, setConfirm] = useState<null | 'reply' | 'voc' | 'faq'>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const show = (r: Row) => {
    setOpen(r);
    setReply(r.replyContent ?? '');
    setError(null);
  };
  const run = async () => {
    if (!open) return;
    const which = confirm;
    setConfirm(null);
    setBusy(true);
    const r = (which === 'reply' ? await replyInquiryAction({ id: open.id, reply }) : which === 'voc' ? await inquiryToVocAction({ id: open.id }) : await inquiryToFaqAction({ id: open.id })) as Res;
    setBusy(false);
    if (!r.ok) return setError(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '처리하지 못했습니다.');
    toast(which === 'reply' ? MSG.saved : which === 'voc' ? `VOC ${(r.data as { vocNo: string }).vocNo}로 접수했습니다.` : 'FAQ 초안을 만들었습니다. FAQ 화면에서 검토 후 게시하세요.');
    setOpen(null);
    router.refresh();
  };
  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">1:1 문의 관리</h1>
      </div>
      <div className="adm-toolbar">
        <div className="ac-segmented" role="group" aria-label="답변 상태">
          {TABS.map((t) => (
            <button key={t.value} type="button" aria-pressed={p.status === t.value} onClick={() => router.push(`/admin/csl/inquiries?status=${t.value}`)}>
              {t.label}
            </button>
          ))}
        </div>
        <span className="ac-body-sm">
          총 <strong className="ac-num">{p.rows.length}</strong>건
        </span>
      </div>
      {p.rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">상태</th>
                <th scope="col">문의번호</th>
                <th scope="col">유형</th>
                <th scope="col">내용</th>
                <th scope="col">고객</th>
                <th scope="col">접수번호</th>
                <th scope="col">문의 일시</th>
                <th scope="col">답변자</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.id} tabIndex={0} aria-label={`${r.consultNo} 답변`} onDoubleClick={() => show(r)} onKeyDown={(e) => e.key === 'Enter' && show(r)}>
                  <td>{r.status === 'DONE' ? <Tag tone="success">답변 완료</Tag> : <Tag tone="warning">답변 대기</Tag>}</td>
                  <td className="ac-num">{r.consultNo}</td>
                  <td>{labelOf(p.codes.INQUIRY_SUB_TYPE, r.subType)}</td>
                  <td className="adm-csl-ellipsis">{r.content}</td>
                  <td className="ac-masked">{r.customerName}</td>
                  <td className="ac-num">{r.orderNo ?? '-'}</td>
                  <td className="ac-num">{formatDateTime(new Date(r.createdAt))}</td>
                  <td>{r.replierName ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        open={open !== null}
        title={open ? `문의 ${open.consultNo}` : ''}
        onClose={() => setOpen(null)}
        form
        actions={
          <>
            <Button variant="outline" onClick={() => setOpen(null)}>
              닫기
            </Button>
            {open && open.status !== 'DONE' && p.canReply ? (
              <Button
                variant="primary"
                loading={busy}
                onClick={() => {
                  if (!reply.trim()) return setError(MSG.required('답변'));
                  setConfirm('reply');
                }}
              >
                답변 등록
              </Button>
            ) : null}
          </>
        }
      >
        {open ? (
          <>
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <dl className="adm-kv">
              <dt>유형</dt>
              <dd>{labelOf(p.codes.INQUIRY_SUB_TYPE, open.subType)}</dd>
              <dt>고객</dt>
              <dd>
                <span className="ac-masked">{open.customerName}</span> <span className="ac-caption ac-num">{open.customerNo}</span>
              </dd>
              <dt>접수번호</dt>
              <dd className="ac-num">{open.orderNo ?? '-'}</dd>
              <dt>문의 내용</dt>
              <dd className="adm-pre">{open.content}</dd>
            </dl>
            <Field label="답변" required help={open.status === 'DONE' && open.repliedAt ? `${formatDateTime(new Date(open.repliedAt))} 답변` : '등록하면 고객에게 알림이 갑니다.'}>
              {(id, d) => <Textarea id={id} aria-describedby={d} rows={5} maxLength={2000} readOnly={open.status === 'DONE'} value={reply} onChange={(e) => setReply(e.target.value)} />}
            </Field>
            <div className="ac-row">
              {p.canVoc ? (
                <Button size="sm" variant="outline" onClick={() => setConfirm('voc')}>
                  VOC로 접수
                </Button>
              ) : null}
              {p.canFaq && open.status === 'DONE' ? (
                <Button size="sm" variant="outline" onClick={() => setConfirm('faq')}>
                  FAQ로 만들기
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
      </Modal>
      <ConfirmModal
        open={confirm !== null}
        message={confirm === 'voc' ? '불만 VOC로 접수하시겠습니까?' : confirm === 'faq' ? 'FAQ 초안(게시 안 함)을 만드시겠습니까?' : undefined}
        onConfirm={run}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
