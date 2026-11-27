'use client';
// A-CNT-040 메모·지정 메모 발송 (F-ADM-CNT-04): 발송 창(수신 기사 다중 선택) + 보낸 메모 목록(수신/확인), 더블클릭 = 상세·취소
import { Alert, Button, Check, ConfirmModal, Empty, Field, Input, MSG, Modal, Select, Tag, Textarea, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf } from '@/admin/crud-screen';
import { deleteAssignedMemoAction, sendAssignedMemoAction } from './actions';

interface Row {
  id: number;
  headerCode: string | null;
  content: string;
  startDate: string;
  endDate: string;
  repeatType: string;
  popupEnabled: boolean;
  prioritySource: string | null;
  createdAt: string;
  authorName: string | null;
  recipients: number;
  readCount: number;
  names: string;
}

export function AssignedMemosScreen(p: {
  rows: Row[];
  techs: { id: number; name: string; status: string }[];
  codes: Record<string, Option[]>;
  today: string;
  canCreate: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const empty = { headerCode: 'MANUAL', content: '', startDate: p.today, endDate: p.today, repeatType: 'NONE', popupEnabled: 'true' };
  const [form, setForm] = useState<typeof empty | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState<Row | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'send' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = p.techs.filter((t) => !q || t.name.includes(q));

  const send = async () => {
    setConfirm(null);
    setBusy(true);
    setError(null);
    const r = await sendAssignedMemoAction(form!, picked.map(String));
    setBusy(false);
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      return setError(r.message ?? r.fieldErrors?.technicianIds ?? null);
    }
    setForm(null);
    toast(`발송했습니다. (${(r.data as { count: number }).count}명)`);
    router.refresh();
  };
  const remove = async () => {
    setConfirm(null);
    setBusy(true);
    const r = await deleteAssignedMemoAction(detail!.id);
    setBusy(false);
    if (!r.ok) return setError(r.message ?? null);
    setDetail(null);
    toast('메모를 취소했습니다.');
    router.refresh();
  };
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setForm((f) => ({ ...f!, [k]: e.target.value }));
  const opts = (o: Option[] | undefined) =>
    (o ?? []).map((x) => (
      <option key={x.value} value={x.value}>
        {x.label}
      </option>
    ));

  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">메모·지정 메모 발송</h1>
        <p className="ac-caption">기사 앱 오늘의 메모에 거점장 &gt; 관리자 &gt; 본인 순으로 보입니다. 팝업을 켜면 기사가 [확인]할 때까지 홈에서 열립니다.</p>
      </div>
      <div className="adm-toolbar">
        <span className="ac-body-sm">
          총 <strong className="ac-num">{p.rows.length}</strong>건
        </span>
        {p.canCreate ? (
          <Button
            size="sm"
            onClick={() => {
              setForm(empty);
              setPicked([]);
              setErrors({});
              setError(null);
            }}
          >
            지정 메모 발송
          </Button>
        ) : null}
      </div>
      {p.rows.length ? (
        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">보낸 시각</th>
                <th scope="col">출처</th>
                <th scope="col">머리말</th>
                <th scope="col">내용</th>
                <th scope="col">기간</th>
                <th scope="col">반복</th>
                <th scope="col" className="is-num">
                  확인/수신
                </th>
                <th scope="col">보낸 사람</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.id} tabIndex={0} aria-label="메모 상세 열기" onDoubleClick={() => (setError(null), setDetail(r))} onKeyDown={(e) => e.key === 'Enter' && (setError(null), setDetail(r))}>
                  <td className="ac-num">{r.createdAt}</td>
                  <td>{labelOf(p.codes.MEMO_PRIORITY_SOURCE, r.prioritySource)}</td>
                  <td>
                    {labelOf(p.codes.MEMO_HEADER, r.headerCode)} {r.popupEnabled ? <Tag tone="warning">팝업</Tag> : null}
                  </td>
                  <td>{r.content.length > 40 ? `${r.content.slice(0, 40)}…` : r.content}</td>
                  <td className="ac-num">{r.startDate === r.endDate ? r.startDate : `${r.startDate} ~ ${r.endDate}`}</td>
                  <td>{labelOf(p.codes.MEMO_REPEAT, r.repeatType)}</td>
                  <td className="is-num ac-num">{`${r.readCount} / ${r.recipients}`}</td>
                  <td>{r.authorName ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty />
      )}

      <Modal
        open={form !== null}
        form
        title="지정 메모 발송"
        onClose={() => setForm(null)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setForm(null)}>
              닫기
            </Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() => {
                const miss: Record<string, string> = {};
                if (!picked.length) miss.technicianIds = MSG.required('수신 기사');
                if (!form!.content.trim()) miss.content = MSG.required('내용');
                setErrors(miss);
                if (!Object.keys(miss).length) setConfirm('send');
              }}
            >
              발송
            </Button>
          </>
        }
      >
        {form ? (
          <>
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <div className="adm-form-grid">
              <Field label="머리말" required error={errors.headerCode}>
                {(id, d, inv) => (
                  <Select id={id} aria-describedby={d} aria-invalid={inv} value={form.headerCode} onChange={set('headerCode')}>
                    {opts(p.codes.MEMO_HEADER)}
                  </Select>
                )}
              </Field>
              <Field label="반복" required error={errors.repeatType}>
                {(id, d, inv) => (
                  <Select id={id} aria-describedby={d} aria-invalid={inv} value={form.repeatType} onChange={set('repeatType')}>
                    {opts(p.codes.MEMO_REPEAT)}
                  </Select>
                )}
              </Field>
              <Field label="시작일" required error={errors.startDate}>
                {(id, d, inv) => <Input id={id} type="date" aria-describedby={d} aria-invalid={inv} value={form.startDate} onChange={set('startDate')} />}
              </Field>
              <Field label={form.repeatType === 'NONE' ? '종료일' : '반복 종료일'} required error={errors.endDate} help={form.repeatType === 'NONE' ? '최대 31일' : undefined}>
                {(id, d, inv) => <Input id={id} type="date" aria-describedby={d} aria-invalid={inv} value={form.endDate} onChange={set('endDate')} />}
              </Field>
              <div className="adm-span-2">
                <Field label="내용" required error={errors.content} help="1000자 이내">
                  {(id, d, inv) => <Textarea id={id} aria-describedby={d} aria-invalid={inv} rows={4} maxLength={1000} value={form.content} onChange={set('content')} />}
                </Field>
              </div>
              <div className="adm-span-2">
                <Check label="기사 앱 홈에서 팝업으로 열기" checked={form.popupEnabled === 'true'} onChange={(e) => setForm({ ...form, popupEnabled: String(e.target.checked) })} />
              </div>
              <div className="adm-span-2">
                <p className="ac-label">
                  수신 기사 <span className="ac-num">{picked.length}</span>명
                </p>
                {errors.technicianIds ? <Alert tone="danger">{errors.technicianIds}</Alert> : null}
                <div className="ac-row">
                  <Input aria-label="기사 이름 검색" placeholder="이름 검색" value={q} onChange={(e) => setQ(e.target.value)} />
                  <Button size="sm" variant="ghost" onClick={() => setPicked([...new Set([...picked, ...shown.map((t) => t.id)])])}>
                    보이는 기사 모두 선택
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPicked([])}>
                    선택 해제
                  </Button>
                </div>
                {shown.length ? (
                  <ul className="adm-file-list adm-pick-list">
                    {shown.map((t) => (
                      <li key={t.id}>
                        <Check
                          label={`${t.name} · ${labelOf(p.codes.TECH_STATUS, t.status)}`}
                          checked={picked.includes(t.id)}
                          onChange={(e) => setPicked(e.target.checked ? [...picked, t.id] : picked.filter((x) => x !== t.id))}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty />
                )}
              </div>
            </div>
          </>
        ) : null}
      </Modal>

      <Modal
        open={detail !== null}
        title="지정 메모 상세"
        onClose={() => setDetail(null)}
        actions={
          <>
            {p.canDelete ? (
              <Button variant="outline" loading={busy} onClick={() => setConfirm('delete')}>
                발송 취소
              </Button>
            ) : null}
            <Button variant="dark" onClick={() => setDetail(null)}>
              닫기
            </Button>
          </>
        }
      >
        {detail ? (
          <>
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <p className="ac-body adm-pre">{detail.content}</p>
            <p className="ac-body-sm">
              수신: {detail.names} (확인 <span className="ac-num">{detail.readCount}</span>/<span className="ac-num">{detail.recipients}</span>)
            </p>
          </>
        ) : null}
      </Modal>

      <ConfirmModal open={confirm === 'send'} message="메모를 발송하시겠습니까?" description={`수신 기사 ${picked.length}명에게 앱 알림이 갑니다.`} confirmLabel="발송" onCancel={() => setConfirm(null)} onConfirm={send} />
      <ConfirmModal open={confirm === 'delete'} message="발송을 취소하시겠습니까?" description="기사 앱에서 이 메모가 사라집니다." confirmLabel="발송 취소" danger onCancel={() => setConfirm(null)} onConfirm={remove} />
    </div>
  );
}
