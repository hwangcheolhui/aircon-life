'use client';
// A-CNT-030 기술자료·SOP (F-ADM-CNT-03): 목록(검색 Enter = 조회, 더블클릭 = 수정) + 첨부 업로드가 있는 등록·수정 창
import { Alert, Button, Check, ConfirmModal, Empty, Field, Input, MSG, Modal, Select, Tag, Textarea, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { type Option, labelOf } from '@/admin/crud-screen';
import { deleteTechDocAction, saveTechDocAction, techDocDetailAction } from './actions';

interface Row {
  id: number;
  docType: string;
  deviceType: string | null;
  title: string;
  content: string;
  isRequiredRead: boolean;
  version: number;
  fileCount: number;
  updatedAt: string;
}
type DocFile = { id: number; name: string; size: number };

export function TechDocsScreen(p: { rows: Row[]; codes: Record<string, Option[]>; canCreate: boolean; canUpdate: boolean; canDelete: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [filter, setFilter] = useState({ docType: '', deviceType: '', title: '' });
  const [applied, setApplied] = useState(filter);
  const [editing, setEditing] = useState<{ row: Row | null; files: DocFile[] } | null>(null);
  const [keep, setKeep] = useState<number[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'save' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const pending = useRef<FormData | null>(null);

  const rows = useMemo(
    () =>
      p.rows.filter(
        (r) => (!applied.docType || r.docType === applied.docType) && (!applied.deviceType || r.deviceType === applied.deviceType) && (!applied.title || r.title.includes(applied.title)),
      ),
    [p.rows, applied],
  );
  const isEdit = Boolean(editing?.row);
  const readOnly = isEdit ? !p.canUpdate : !p.canCreate;

  const open = async (row: Row | null) => {
    setErrors({});
    setError(null);
    if (!row) {
      setKeep([]);
      return setEditing({ row: null, files: [] });
    }
    const r = await techDocDetailAction(row.id);
    const files = r.ok && r.data ? (r.data as { files: DocFile[] }).files : [];
    setKeep(files.map((f) => f.id));
    setEditing({ row, files });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const fd = new FormData(formRef.current!);
    const missing: Record<string, string> = {};
    if (!String(fd.get('title') ?? '').trim()) missing.title = MSG.required('제목');
    if (!String(fd.get('content') ?? '').trim()) missing.content = MSG.required('내용');
    setErrors(missing);
    if (Object.keys(missing).length) return;
    fd.set('isRequiredRead', String((formRef.current!.elements.namedItem('isRequiredRead') as HTMLInputElement).checked));
    fd.delete('keepFileIds');
    for (const id of keep) fd.append('keepFileIds', String(id));
    if (editing?.row) fd.set('id', String(editing.row.id));
    pending.current = fd;
    setConfirm('save');
  };

  const run = async (kind: 'save' | 'delete') => {
    setConfirm(null);
    setBusy(true);
    try {
      const r = kind === 'save' ? await saveTechDocAction(pending.current!) : await deleteTechDocAction(editing!.row!.id);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        return setError(r.message ?? null);
      }
      setEditing(null);
      const v = kind === 'save' ? (r.data as { version?: number } | undefined)?.version : undefined;
      toast(kind === 'save' ? `${MSG.saved}${v ? ` (버전 ${v})` : ''}` : MSG.deleted);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const optionList = (opts: Option[] | undefined) =>
    (opts ?? []).map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ));

  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">기술자료·SOP</h1>
        <p className="ac-caption">기사 앱 [기술자료]에 필독 먼저 보입니다. 제목·내용·첨부를 바꾸면 버전이 1 올라갑니다.</p>
      </div>
      <form
        className="ac-search-panel"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(filter);
        }}
      >
        <Field label="유형">
          {(id) => (
            <Select id={id} value={filter.docType} onChange={(e) => setFilter({ ...filter, docType: e.target.value })}>
              <option value="">전체</option>
              {optionList(p.codes.TECH_DOC_TYPE)}
            </Select>
          )}
        </Field>
        <Field label="기기">
          {(id) => (
            <Select id={id} value={filter.deviceType} onChange={(e) => setFilter({ ...filter, deviceType: e.target.value })}>
              <option value="">전체</option>
              {optionList(p.codes.DEVICE_TYPE)}
            </Select>
          )}
        </Field>
        <Field label="제목">{(id) => <Input id={id} value={filter.title} onChange={(e) => setFilter({ ...filter, title: e.target.value })} />}</Field>
        <div className="ac-search-panel__actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const empty = { docType: '', deviceType: '', title: '' };
              setFilter(empty);
              setApplied(empty);
            }}
          >
            초기화
          </Button>
          <Button type="submit" variant="primary" size="sm">
            조회
          </Button>
        </div>
      </form>
      <div className="adm-toolbar">
        <span className="ac-body-sm">
          총 <strong className="ac-num">{rows.length.toLocaleString()}</strong>건
        </span>
        {p.canCreate ? (
          <Button size="sm" onClick={() => open(null)}>
            자료 등록
          </Button>
        ) : null}
      </div>
      {rows.length ? (
        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">유형</th>
                <th scope="col">기기</th>
                <th scope="col">제목</th>
                <th scope="col" className="is-num">
                  버전
                </th>
                <th scope="col" className="is-num">
                  첨부
                </th>
                <th scope="col">수정일</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} tabIndex={0} aria-label="자료 상세 열기" onDoubleClick={() => open(r)} onKeyDown={(e) => e.key === 'Enter' && open(r)}>
                  <td>
                    {labelOf(p.codes.TECH_DOC_TYPE, r.docType)} {r.isRequiredRead ? <Tag tone="danger">필독</Tag> : null}
                  </td>
                  <td>{r.deviceType ? labelOf(p.codes.DEVICE_TYPE, r.deviceType) : '공통'}</td>
                  <td>{r.title}</td>
                  <td className="is-num ac-num">v{r.version}</td>
                  <td className="is-num ac-num">{r.fileCount}</td>
                  <td className="ac-num">{r.updatedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty />
      )}

      <Modal open={editing !== null} form title={`자료 ${isEdit ? (readOnly ? '상세' : '수정') : '등록'}`} onClose={() => setEditing(null)}>
        {editing ? (
          <form ref={formRef} onSubmit={onSubmit} noValidate encType="multipart/form-data">
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <fieldset disabled={readOnly || busy} className="adm-fieldset">
              <div className="adm-form-grid">
                <Field label="유형" required error={errors.docType}>
                  {(id, d, inv) => (
                    <Select id={id} name="docType" aria-describedby={d} aria-invalid={inv} defaultValue={editing.row?.docType ?? 'SOP'}>
                      {optionList(p.codes.TECH_DOC_TYPE)}
                    </Select>
                  )}
                </Field>
                <Field label="기기" error={errors.deviceType} help="비우면 공통">
                  {(id, d, inv) => (
                    <Select id={id} name="deviceType" aria-describedby={d} aria-invalid={inv} defaultValue={editing.row?.deviceType ?? ''}>
                      <option value="">공통</option>
                      {optionList(p.codes.DEVICE_TYPE)}
                    </Select>
                  )}
                </Field>
                <div className="adm-span-2">
                  <Field label="제목" required error={errors.title}>
                    {(id, d, inv) => <Input id={id} name="title" aria-describedby={d} aria-invalid={inv} maxLength={200} defaultValue={editing.row?.title ?? ''} />}
                  </Field>
                </div>
                <div className="adm-span-2">
                  <Field label="내용" required error={errors.content}>
                    {(id, d, inv) => <Textarea id={id} name="content" aria-describedby={d} aria-invalid={inv} rows={8} defaultValue={editing.row?.content ?? ''} />}
                  </Field>
                </div>
                <div className="adm-span-2">
                  <Check label="필독" name="isRequiredRead" defaultChecked={editing.row?.isRequiredRead ?? false} />
                </div>
                {editing.files.length ? (
                  <div className="adm-span-2">
                    <p className="ac-label">기존 첨부 (체크를 풀면 저장할 때 지웁니다)</p>
                    <ul className="adm-file-list">
                      {editing.files.map((f) => (
                        <li key={f.id}>
                          <Check
                            label={`${f.name} (${Math.max(1, Math.round(f.size / 1024))}KB)`}
                            checked={keep.includes(f.id)}
                            onChange={(e) => setKeep(e.target.checked ? [...keep, f.id] : keep.filter((x) => x !== f.id))}
                          />
                          <a href={`/api/files/${f.id}`} target="_blank" rel="noopener noreferrer" className="ac-btn ac-btn--text ac-btn--sm">
                            열기
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="adm-span-2">
                  <Field label="첨부 추가" error={errors.files} help="PDF·JPG·PNG·WEBP, 모두 합쳐 3개까지. 한 번에 합계 3.5MB 이하">
                    {(id, d, inv) => <Input id={id} name="files" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" aria-describedby={d} aria-invalid={inv} />}
                  </Field>
                </div>
              </div>
            </fieldset>
            <div className="ac-modal__actions">
              {isEdit && p.canDelete ? (
                <Button variant="outline" onClick={() => setConfirm('delete')} disabled={busy}>
                  삭제
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => setEditing(null)}>
                닫기
              </Button>
              {!readOnly ? (
                <Button type="submit" variant="primary" loading={busy}>
                  저장
                </Button>
              ) : null}
            </div>
          </form>
        ) : null}
      </Modal>
      <ConfirmModal open={confirm === 'save'} onConfirm={() => run('save')} onCancel={() => setConfirm(null)} />
      <ConfirmModal open={confirm === 'delete'} message={MSG.confirmDelete} confirmLabel="삭제" danger onConfirm={() => run('delete')} onCancel={() => setConfirm(null)} />
    </div>
  );
}
