'use client';
// A-VOC-040 후기 관리 (F-ADM-VOC-04): 검색 Enter = 조회, 그리드 더블클릭 = 답글·숨김, 저평점 후기는 연결 VOC로 이동(BR-090)
import { Alert, Button, Check, ConfirmModal, Empty, Field, Input, MSG, Modal, Select, Tag, Textarea, useToast } from '@aircon/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import type { listReviews } from '@/server/reviews';
import { saveReviewAction } from './actions';

type Row = Awaited<ReturnType<typeof listReviews>>[number];
type Res = { ok: boolean; message?: string; fieldErrors?: Record<string, string> };

export function ReviewScreen(p: { rows: Row[]; codes: Record<string, Option[]>; q: { from: string; to: string; maxRating: string }; canUpdate: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState(p.q);
  const [open, setOpen] = useState<Row | null>(null);
  const [reply, setReply] = useState('');
  const [hidden, setHidden] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const edit = (r: Row) => {
    setOpen(r);
    setReply(r.adminReply ?? '');
    setHidden(r.isHidden);
    setError(null);
  };
  const save = async () => {
    setConfirm(false);
    if (!open) return;
    const r = (await saveReviewAction({ id: open.id, adminReply: reply, isHidden: hidden })) as Res;
    if (!r.ok) return setError(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '저장하지 못했습니다.');
    setOpen(null);
    toast(MSG.saved);
    router.refresh();
  };
  return (
    <>
      <div className="adm-page-head">
        <h1 className="ac-h1">후기 관리</h1>
      </div>
      <form
        className="ac-search-panel"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/admin/voc/reviews?${new URLSearchParams(q).toString()}`);
        }}
      >
        <Field label="작성일(시작)">{(id) => <Input id={id} type="date" value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })} />}</Field>
        <Field label="작성일(종료)">{(id) => <Input id={id} type="date" value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })} />}</Field>
        <Field label="평점">
          {(id) => (
            <Select id={id} value={q.maxRating} onChange={(e) => setQ({ ...q, maxRating: e.target.value })}>
              <option value="">전체</option>
              <option value="2">2점 이하</option>
              <option value="3">3점 이하</option>
            </Select>
          )}
        </Field>
        <div className="ac-search-panel__actions">
          <Button type="submit" variant="primary" size="sm">
            조회
          </Button>
        </div>
      </form>
      {p.rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="ac-table-wrap adm-gap-top">
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col" className="is-num">
                  평점
                </th>
                <th scope="col" className="is-num">
                  NPS
                </th>
                <th scope="col">접수번호</th>
                <th scope="col">고객</th>
                <th scope="col">기사</th>
                <th scope="col">내용</th>
                <th scope="col">상태</th>
                <th scope="col">작성 일시</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.id} onDoubleClick={() => edit(r)}>
                  <td className="is-num ac-num">{r.rating}점</td>
                  <td className="is-num ac-num">{r.npsScore ?? '-'}</td>
                  <td className="ac-num">{r.orderNo}</td>
                  <td>{r.customerName}</td>
                  <td>{r.techName}</td>
                  <td>
                    {r.tags.map((t) => (
                      <Tag key={t}>{labelOf(p.codes.REVIEW_TAG, t)}</Tag>
                    ))}{' '}
                    {r.content ? r.content.slice(0, 40) : ''}
                    {r.photoIds.length ? <span className="ac-caption"> · 사진 {r.photoIds.length}장</span> : null}
                  </td>
                  <td>
                    {r.isHidden ? <Tag tone="danger">숨김</Tag> : null}
                    {r.adminReply ? <Tag tone="success">답글</Tag> : null}
                    {r.vocId ? (
                      <Link href={`/admin/voc/vocs/${r.vocId}`}>
                        <Tag tone="warning">{`VOC ${r.vocNo ?? ''}`}</Tag>
                      </Link>
                    ) : null}
                  </td>
                  <td className="ac-num">{formatDateTime(new Date(r.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        open={open !== null}
        title="후기 답글·숨김"
        description={open ? `${open.orderNo} · ${open.techName} · ${open.rating}점` : undefined}
        onClose={() => setOpen(null)}
        form
        actions={
          <>
            <Button variant="outline" onClick={() => setOpen(null)}>
              닫기
            </Button>
            {p.canUpdate ? (
              <Button variant="primary" onClick={() => setConfirm(true)}>
                저장
              </Button>
            ) : null}
          </>
        }
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {open ? (
          <div className="ac-stack">
            <p className="ac-body adm-pre">{open.content || '(내용 없음)'}</p>
            {open.photoIds.length ? (
              <div className="adm-prc-photos">
                {open.photoIds.map((id, i) => (
                  <a key={id} href={`/api/files/${id}`} target="_blank" rel="noreferrer">
                    사진 {i + 1}
                  </a>
                ))}
              </div>
            ) : null}
            <fieldset className="adm-fieldset" disabled={!p.canUpdate}>
              <Field label="답글" help="고객의 후기 화면에 보입니다.">
                {(id, d) => <Textarea id={id} aria-describedby={d} rows={3} maxLength={1000} value={reply} onChange={(e) => setReply(e.target.value)} />}
              </Field>
              <Check label="숨김(기사 평균 평점에서 제외)" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
            </fieldset>
          </div>
        ) : null}
      </Modal>
      <ConfirmModal open={confirm} onConfirm={save} onCancel={() => setConfirm(false)} />
    </>
  );
}
