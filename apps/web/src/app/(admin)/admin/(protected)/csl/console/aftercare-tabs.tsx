'use client';
/**
 * 단계 8 상담 콘솔 탭
 * - A-CSL-030 독촉/전달 (F-ADM-CSL-11): [상담 독촉 | 출장 독촉], 대상 주문·유형·원인·내용(80자) → 기사 앱 알림(T-NTF-020) 또는 관리자 알림
 * - A-CSL-040 안전사고 (F-ADM-CSL-12): 피해유형·경위·내용·요구·조치, 매체/기관, 수신자 추가.
 *   BR-060 매체에 언론·인터넷이 있으면 저장 전에 한 번 더 확인 → 경영진 자동 통보. BR-061 거점장·담당자 자동 수신.
 */
import { FOLLOWUP_MESSAGE_MAX, checkFollowupInput, checkIncidentInput, needsEscalation } from '@aircon/domain';
import { Alert, Button, Check, ConfirmModal, Field, Input, MSG, Select, Textarea, useToast } from '@aircon/ui';
import { useEffect, useState } from 'react';
import { type Option, labelOf } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import { loadFollowupTargets, submitFollowup, submitIncident } from './actions';
import type { ConsoleData } from './screen';

type Res = { ok: boolean; message?: string; fieldErrors?: Record<string, string>; data?: unknown };
type Targets = {
  orders: { id: number; orderNo: string; status: string; promisedAt: Date | string | null; orderType: string; followupCount: number }[];
  admins: { id: number; name: string }[];
};
const errOf = (r: Res) => r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '저장하지 못했습니다.';

/* ---------- A-CSL-030 독촉/전달 ---------- */

export function FollowupTab({ data, codes, canWrite, onSaved }: { data: ConsoleData | null; codes: Record<string, Option[]>; canWrite: boolean; onSaved: () => void }) {
  const toast = useToast();
  const blank = { targetType: 'ORDER' as 'ORDER' | 'CONSULT', targetOrderId: '', followupType: 'SCHEDULE_DELAY', cause: '', message: '', receiverAdminId: '' };
  const [f, setF] = useState(blank);
  const [targets, setTargets] = useState<Targets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const customerId = data?.customer.id ?? null;

  useEffect(() => {
    setTargets(null);
    if (!customerId) return;
    void loadFollowupTargets(customerId).then((r) => setTargets((r as Res).ok ? ((r as Res).data as Targets) : null));
  }, [customerId]);

  const order = targets?.orders.find((o) => String(o.id) === f.targetOrderId);
  const save = async () => {
    if (!data) return;
    setConfirm(false);
    setBusy(true);
    const r = (await submitFollowup({ ...f, customerId: data.customer.id, callLogId: data.callLogId ?? '' })) as Res;
    setBusy(false);
    if (!r.ok) return setError(errOf(r));
    toast(MSG.saved);
    setF(blank);
    setError(null);
    const t = (await loadFollowupTargets(data.customer.id)) as Res;
    if (t.ok) setTargets(t.data as Targets);
    onSaved();
  };

  return (
    <div className="adm-csl-order">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="ac-segmented" role="group" aria-label="독촉 구분">
        {(['CONSULT', 'ORDER'] as const).map((t) => (
          <button key={t} type="button" aria-pressed={f.targetType === t} onClick={() => setF({ ...f, targetType: t })}>
            {labelOf(codes.FOLLOWUP_TARGET, t)}
          </button>
        ))}
      </div>
      <div className="adm-form-grid">
        {f.targetType === 'ORDER' ? (
          <Field label="대상 주문" required help={order ? `${order.followupCount + 1}차 독촉이 됩니다.` : '진행 중인 주문만 보입니다.'}>
            {(id) => (
              <Select id={id} value={f.targetOrderId} onChange={(e) => setF({ ...f, targetOrderId: e.target.value })}>
                <option value="">선택</option>
                {targets?.orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.orderNo} · {formatDateTime(o.promisedAt ? new Date(o.promisedAt) : null) || '약속 전'}
                    {o.followupCount ? ` · ${o.followupCount}차까지 보냄` : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        <Field label={f.targetType === 'ORDER' ? '기사 미배정 시 받을 담당자' : '받을 담당자'} required={f.targetType === 'CONSULT'}>
          {(id) => (
            <Select id={id} value={f.receiverAdminId} onChange={(e) => setF({ ...f, receiverAdminId: e.target.value })}>
              <option value="">{f.targetType === 'ORDER' ? '주기사에게 보냄' : '선택'}</option>
              {targets?.admins.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="독촉 유형" required>
          {(id) => (
            <Select id={id} value={f.followupType} onChange={(e) => setF({ ...f, followupType: e.target.value })}>
              {codes.FOLLOWUP_TYPE?.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="원인">
          {(id) => (
            <Select id={id} value={f.cause} onChange={(e) => setF({ ...f, cause: e.target.value })}>
              <option value="">선택 안 함</option>
              {codes.FOLLOWUP_CAUSE?.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="adm-span-2">
          <Field label="전달 내용" required help={`${f.message.length}/${FOLLOWUP_MESSAGE_MAX}자`}>
            {(id, d) => <Textarea id={id} aria-describedby={d} rows={2} maxLength={FOLLOWUP_MESSAGE_MAX} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />}
          </Field>
        </div>
      </div>
      <div className="adm-toolbar">
        <span />
        <Button
          variant="primary"
          loading={busy}
          disabled={!canWrite || !data}
          onClick={() => {
            const e = checkFollowupInput({
              targetType: f.targetType,
              targetOrderId: f.targetOrderId ? Number(f.targetOrderId) : null,
              message: f.message,
              receiverAdminId: f.receiverAdminId ? Number(f.receiverAdminId) : null,
            });
            setError(e);
            if (!e) setConfirm(true);
          }}
        >
          보내기
        </Button>
      </div>
      <ConfirmModal open={confirm} message="보내시겠습니까?" onConfirm={save} onCancel={() => setConfirm(false)} />
    </div>
  );
}

/* ---------- A-CSL-040 안전사고 ---------- */

type Extra = { name: string; org: string; phone: string; email: string };

export function IncidentTab({ data, codes, canWrite, onSaved }: { data: ConsoleData | null; codes: Record<string, Option[]>; canWrite: boolean; onSaved: () => void }) {
  const toast = useToast();
  const blank = { orderId: '', damageType: '', occurredAt: '', circumstance: '', damageDetail: '', customerDemand: '', responseAction: '', mediaFlags: [] as string[] };
  const [f, setF] = useState(blank);
  const [extras, setExtras] = useState<Extra[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<null | 'confirm' | 'escalate'>(null);
  const [busy, setBusy] = useState(false);
  const escalated = needsEscalation(f.mediaFlags);

  const toggleMedia = (v: string) => setF({ ...f, mediaFlags: f.mediaFlags.includes(v) ? f.mediaFlags.filter((x) => x !== v) : [...f.mediaFlags, v] });
  const save = async () => {
    if (!data) return;
    setStep(null);
    setBusy(true);
    const r = (await submitIncident({
      ...f,
      customerId: data.customer.id,
      callLogId: data.callLogId ?? '',
      escalationConfirmed: escalated,
      extraRecipients: extras.filter((x) => x.name.trim()),
    })) as Res;
    setBusy(false);
    if (!r.ok) return setError(errOf(r));
    const d = r.data as { incidentNo: string; recipientCount: number; escalated: boolean };
    toast(`${MSG.saved} 사고번호 ${d.incidentNo}, 수신자 ${d.recipientCount}명에게 통보했습니다.`);
    setF(blank);
    setExtras([]);
    setError(null);
    onSaved();
  };

  return (
    <div className="adm-csl-order">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="adm-form-grid">
        <Field label="피해 유형" required>
          {(id) => (
            <Select id={id} value={f.damageType} onChange={(e) => setF({ ...f, damageType: e.target.value })}>
              <option value="">선택</option>
              {codes.DAMAGE_TYPE?.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="관련 주문">
          {(id) => (
            <Select id={id} value={f.orderId} onChange={(e) => setF({ ...f, orderId: e.target.value })}>
              <option value="">없음</option>
              {data?.orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.orderNo}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="발생 일시">
          {(id) => <Input id={id} type="datetime-local" value={f.occurredAt} onChange={(e) => setF({ ...f, occurredAt: e.target.value })} />}
        </Field>
        <div />
        <div className="adm-span-2">
          <Field label="발생 경위" required>
            {(id) => <Textarea id={id} rows={3} maxLength={4000} value={f.circumstance} onChange={(e) => setF({ ...f, circumstance: e.target.value })} />}
          </Field>
        </div>
        <div className="adm-span-2">
          <Field label="피해 내용" required>
            {(id) => <Textarea id={id} rows={2} maxLength={2000} value={f.damageDetail} onChange={(e) => setF({ ...f, damageDetail: e.target.value })} />}
          </Field>
        </div>
        <Field label="고객 요구사항">
          {(id) => <Textarea id={id} rows={2} maxLength={4000} value={f.customerDemand} onChange={(e) => setF({ ...f, customerDemand: e.target.value })} />}
        </Field>
        <Field label="조치 내용">
          {(id) => <Textarea id={id} rows={2} maxLength={2000} value={f.responseAction} onChange={(e) => setF({ ...f, responseAction: e.target.value })} />}
        </Field>
        <fieldset className="adm-span-2 adm-fieldset">
          <legend className="ac-label">매체/기관 (고객이 언급한 곳)</legend>
          <div className="ac-row">
            {codes.MEDIA_FLAG?.map((c) => (
              <Check key={c.value} label={c.label} checked={f.mediaFlags.includes(c.value)} onChange={() => toggleMedia(c.value)} />
            ))}
          </div>
          {escalated ? <Alert tone="warning">언론·인터넷이 선택되어 저장하면 경영진에게도 바로 통보됩니다.</Alert> : null}
        </fieldset>
        <div className="adm-span-2">
          <p className="ac-label">추가 수신자</p>
          <p className="ac-caption">거점장·거점 담당자는 자동으로 통보됩니다. 보험사 등 외부 수신자는 문자로 보냅니다.</p>
          {extras.map((x, i) => (
            <div key={i} className="ac-row">
              {(['name', 'org', 'phone', 'email'] as const).map((k) => (
                <Input
                  key={k}
                  aria-label={{ name: '이름', org: '소속', phone: '연락처', email: '이메일' }[k]}
                  placeholder={{ name: '이름', org: '소속', phone: '연락처', email: '이메일' }[k]}
                  value={x[k]}
                  onChange={(e) => setExtras(extras.map((y, j) => (j === i ? { ...y, [k]: e.target.value } : y)))}
                />
              ))}
              <Button size="sm" variant="ghost" onClick={() => setExtras(extras.filter((_, j) => j !== i))}>
                삭제
              </Button>
            </div>
          ))}
          <Button size="sm" variant="outline" disabled={extras.length >= 10} onClick={() => setExtras([...extras, { name: '', org: '', phone: '', email: '' }])}>
            수신자 추가
          </Button>
        </div>
      </div>
      <div className="adm-toolbar">
        <span />
        <Button
          variant="primary"
          loading={busy}
          disabled={!canWrite || !data}
          onClick={() => {
            const e = checkIncidentInput(f);
            setError(e);
            if (!e) setStep('confirm');
          }}
        >
          접수
        </Button>
      </div>
      <ConfirmModal open={step === 'confirm'} onConfirm={() => (escalated ? setStep('escalate') : save())} onCancel={() => setStep(null)} />
      <ConfirmModal
        open={step === 'escalate'}
        message="경영진에게 통보됩니다. 계속하시겠습니까?"
        description={`매체/기관에 ${f.mediaFlags
          .filter((m) => m === 'PRESS' || m === 'INTERNET')
          .map((m) => labelOf(codes.MEDIA_FLAG, m))
          .join('·')}이(가) 선택되어 있습니다.`}
        confirmLabel="통보하고 접수"
        danger
        onConfirm={save}
        onCancel={() => setStep(null)}
      />
    </div>
  );
}
