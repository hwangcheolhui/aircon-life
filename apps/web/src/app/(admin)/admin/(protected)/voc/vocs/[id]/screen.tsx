'use client';
// A-VOC-011 VOC 카드 (F-ADM-VOC-01): 처리 저장 전 확인, 불만 VOC 완료는 원인·고객 조치 필수(domain checkVocClose), [인쇄] = 브라우저 인쇄
import { VOC_TRANSITIONS, type VocStatus, checkVocClose, defaultVocAlert } from '@aircon/domain';
import { Alert, Button, Card, Check, ConfirmModal, Field, MSG, Modal, Select, Tag, Textarea, useToast } from '@aircon/ui';
import { Printer } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import type { getVoc } from '@/server/voc';
import { processVoc, saveAs } from '../../actions';
import { severityTone, vocStatusTone } from '../screen';

type V = Awaited<ReturnType<typeof getVoc>>;
type Res = { ok: boolean; message?: string; fieldErrors?: Record<string, string>; data?: unknown };

export function VocCardScreen({ v, codes, canUpdate, canCreateAs }: { v: V; codes: Record<string, Option[]>; canUpdate: boolean; canCreateAs: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const closed = v.status === 'DONE';
  const [f, setF] = useState({
    status: v.status,
    severity: v.severity ?? '',
    isAlert: v.isAlert,
    categoryL: v.categoryL ?? '',
    categoryM: v.categoryM ?? '',
    handlerAdminId: v.handlerAdminId ? String(v.handlerAdminId) : '',
    technicianId: v.technicianId ? String(v.technicianId) : '',
    rootCause: v.rootCause ?? '',
    customerAction: v.customerAction ?? '',
    memo: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [asOpen, setAsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const nextStatuses = [v.status, ...(VOC_TRANSITIONS[v.status as VocStatus] ?? [])];
  const opts = (group: string, filter?: (o: Option) => boolean) =>
    (codes[group] ?? []).filter(filter ?? (() => true)).map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ));
  const save = async () => {
    setConfirm(false);
    setBusy(true);
    const r = (await processVoc({ ...f, id: v.id })) as Res;
    setBusy(false);
    if (!r.ok) return setError(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '저장하지 못했습니다.');
    toast(MSG.saved);
    setError(null);
    setF((s) => ({ ...s, memo: '' }));
    router.refresh();
  };
  return (
    <div className="ac-stack adm-print-area">
      <div className="adm-page-head">
        <h1 className="ac-h2">
          VOC 카드 <span className="ac-num">{v.vocNo}</span>
        </h1>
        <div className="ac-row adm-no-print">
          <Link className="ac-btn ac-btn--sm ac-btn--ghost" href="/admin/voc/vocs">
            목록
          </Link>
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer aria-hidden /> 인쇄
          </Button>
        </div>
      </div>
      <Card>
        <dl className="adm-kv">
          <dt>상태</dt>
          <dd>
            <Tag tone={vocStatusTone(v.status)}>{labelOf(codes.VOC_STATUS, v.status)}</Tag>
            {v.isAlert ? <Tag tone="danger">Alert</Tag> : null}
          </dd>
          <dt>유형 · 매체</dt>
          <dd>
            {labelOf(codes.VOC_TYPE, v.vocType)} · {labelOf(codes.VOC_CHANNEL, v.channel)}
          </dd>
          <dt>등급</dt>
          <dd>{v.severity ? <Tag tone={severityTone(v.severity)}>{labelOf(codes.VOC_SEVERITY, v.severity)}</Tag> : '-'}</dd>
          <dt>고객</dt>
          <dd>
            <span className="ac-masked">{v.customerName}</span> <span className="ac-caption ac-num">{v.customerNo}</span>
          </dd>
          <dt>접수번호</dt>
          <dd className="ac-num">{v.orderNo ?? '-'}</dd>
          <dt>상담번호</dt>
          <dd className="ac-num">{v.consultNo ?? '-'}</dd>
          <dt>연결 AS</dt>
          <dd>{v.linkedAs ? `${v.linkedAs.asNo} (${labelOf(codes.AS_STATUS, v.linkedAs.status)})` : '-'}</dd>
          <dt>접수일시</dt>
          <dd className="ac-num">{formatDateTime(new Date(v.createdAt))}</dd>
          <dt>제목</dt>
          <dd>{v.title}</dd>
          <dt>내용</dt>
          <dd className="adm-pre">{v.content}</dd>
        </dl>
      </Card>
      <Card>
        <h2 className="ac-h3">처리</h2>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <fieldset className="adm-fieldset" disabled={closed || !canUpdate}>
          <div className="adm-form-grid">
            <Field label="진행 상태" required>
              {(id) => (
                <Select id={id} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                  {opts('VOC_STATUS', (o) => nextStatuses.includes(o.value as VocStatus))}
                </Select>
              )}
            </Field>
            <Field label="등급">
              {(id) => (
                <Select id={id} value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value, isAlert: f.isAlert || defaultVocAlert(e.target.value) })}>
                  <option value="">선택 안 함</option>
                  {opts('VOC_SEVERITY')}
                </Select>
              )}
            </Field>
            <Field label="대분류">
              {(id) => (
                <Select id={id} value={f.categoryL} onChange={(e) => setF({ ...f, categoryL: e.target.value, categoryM: '' })}>
                  <option value="">선택 안 함</option>
                  {opts('VOC_CATEGORY_L')}
                </Select>
              )}
            </Field>
            <Field label="중분류">
              {(id) => (
                <Select id={id} value={f.categoryM} onChange={(e) => setF({ ...f, categoryM: e.target.value })}>
                  <option value="">선택 안 함</option>
                  {opts('VOC_CATEGORY_M', (o) => !f.categoryL || o.value.startsWith(`${f.categoryL}_`) || o.value === 'ETC')}
                </Select>
              )}
            </Field>
            <Field label="담당자">
              {(id) => (
                <Select id={id} value={f.handlerAdminId} onChange={(e) => setF({ ...f, handlerAdminId: e.target.value })}>
                  <option value="">미지정</option>
                  {v.admins.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="귀책 기사" help="불만 VOC는 기사 VOC 건수에 반영됩니다.">
              {(id, d) => (
                <Select id={id} aria-describedby={d} value={f.technicianId} onChange={(e) => setF({ ...f, technicianId: e.target.value })}>
                  <option value="">없음</option>
                  {v.techs.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="원인" required={f.status === 'DONE' && v.vocType === 'COMPLAINT'}>
              {(id) => <Textarea id={id} rows={2} maxLength={500} value={f.rootCause} onChange={(e) => setF({ ...f, rootCause: e.target.value })} />}
            </Field>
            <Field label="고객 조치" required={f.status === 'DONE' && v.vocType === 'COMPLAINT'}>
              {(id) => <Textarea id={id} rows={2} maxLength={500} value={f.customerAction} onChange={(e) => setF({ ...f, customerAction: e.target.value })} />}
            </Field>
            <Check label="Alert 표시" checked={f.isAlert} onChange={(e) => setF({ ...f, isAlert: e.target.checked })} />
            <div className="adm-span-2">
              <Field label="처리 메모" help="이력에 남습니다.">
                {(id, d) => <Textarea id={id} aria-describedby={d} rows={2} maxLength={500} value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} />}
              </Field>
            </div>
          </div>
        </fieldset>
        <div className="adm-toolbar adm-no-print">
          {canCreateAs && !v.linkedAs && v.orderNo && !closed ? (
            <Button size="sm" variant="outline" onClick={() => setAsOpen(true)}>
              AS 요청 만들기
            </Button>
          ) : (
            <span />
          )}
          <Button
            variant="primary"
            loading={busy}
            disabled={closed || !canUpdate}
            onClick={() => {
              const e = f.status === 'DONE' ? checkVocClose({ vocType: v.vocType, rootCause: f.rootCause || null, customerAction: f.customerAction || null }) : null;
              setError(e);
              if (!e) setConfirm(true);
            }}
          >
            저장
          </Button>
        </div>
      </Card>
      <Card>
        <h2 className="ac-h3">처리 이력</h2>
        {v.history.length === 0 ? (
          <p className="ac-body-sm">이력이 없습니다.</p>
        ) : (
          <ol className="adm-timeline">
            {v.history.map((h) => (
              <li key={h.id}>
                <span className="ac-num ac-caption">{formatDateTime(new Date(h.createdAt))}</span>{' '}
                {h.fromStatus ? `${labelOf(codes.VOC_STATUS, h.fromStatus)} → ` : ''}
                {labelOf(codes.VOC_STATUS, h.toStatus)} · {h.actorName ?? (h.actorType === 'SYSTEM' ? '시스템' : '-')}
                {h.memo ? <p className="ac-body-sm">{h.memo}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </Card>
      <ConfirmModal open={confirm} onConfirm={save} onCancel={() => setConfirm(false)} />
      {asOpen ? <AsFromVocModal v={v} codes={codes} onClose={() => setAsOpen(false)} /> : null}
    </div>
  );
}

function AsFromVocModal({ v, codes, onClose }: { v: V; codes: Record<string, Option[]>; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [reason, setReason] = useState('DIRT_REMAIN');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    const r = (await saveAs({ orderNo: v.orderNo, reason, content: v.content.slice(0, 1000), vocId: v.id })) as Res;
    setBusy(false);
    if (!r.ok) return setError(r.message ?? '저장하지 못했습니다.');
    toast(MSG.saved);
    onClose();
    router.refresh();
  };
  return (
    <Modal
      open
      title="AS 요청 만들기"
      description={`접수 ${v.orderNo}의 AS 요청을 만들고 이 VOC와 연결합니다. 보증 여부는 작업 완료일로 자동 판정됩니다.`}
      onClose={onClose}
      actions={
        <>
          <Button variant="outline" onClick={onClose}>
            닫기
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            만들기
          </Button>
        </>
      }
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="AS 사유" required>
        {(id) => (
          <Select id={id} value={reason} onChange={(e) => setReason(e.target.value)}>
            {codes.AS_REASON?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </Modal>
  );
}
