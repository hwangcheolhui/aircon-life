'use client';
// A-CRM-020 캠페인 관리 (F-ADM-CRM-02): 그리드 더블클릭 = 수정(작성 상태만), 대상 미리보기(고객번호만, BR-100), 상태별 [예약]·[지금 발송]·[중지]·[작성으로]
import { Alert, Button, Check, ConfirmModal, Empty, Field, Input, MSG, Modal, Select, Tag, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import type { listCampaigns } from '@/server/campaigns';
import { campaignStepAction, previewCampaignAction, saveCampaignAction } from './actions';

type Row = Awaited<ReturnType<typeof listCampaigns>>[number];
type Res = { ok: boolean; data?: unknown; message?: string; fieldErrors?: Record<string, string> };
type Step = 'SCHEDULE' | 'SEND_NOW' | 'STOP' | 'DRAFT';
type Form = {
  id: string;
  name: string;
  campaignType: string;
  templateId: string;
  couponId: string;
  sendAt: string;
  branchIds: string[];
  deviceTypes: string[];
  housingTypes: string[];
  lastServiceMonthsMin: string;
  lastServiceMonthsMax: string;
};

const TONE: Record<string, 'primary' | 'success' | 'warning' | 'danger' | undefined> = { SCHEDULED: 'primary', RUNNING: 'warning', DONE: 'success', STOPPED: 'danger' };
const STEPS: Record<string, Step[]> = { DRAFT: ['SCHEDULE', 'SEND_NOW', 'STOP'], SCHEDULED: ['DRAFT', 'SEND_NOW', 'STOP'], STOPPED: ['DRAFT'], RUNNING: [], DONE: [] };
const STEP_LABEL: Record<Step, string> = { SCHEDULE: '예약', SEND_NOW: '지금 발송', STOP: '중지', DRAFT: '작성으로' };
const STEP_ASK: Record<Step, string> = { SCHEDULE: '예약하시겠습니까?', SEND_NOW: '지금 발송하시겠습니까?', STOP: '중지하시겠습니까?', DRAFT: '작성 상태로 되돌리시겠습니까?' };
const errOf = (r: Res, f: string) => r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? f;
/** Date → datetime-local(한국 시각) */
const kstLocal = (d: Date | string | null) => (d ? new Date(new Date(d).getTime() + 9 * 3600_000).toISOString().slice(0, 16) : '');

export function CampaignsScreen(p: {
  rows: Row[];
  templates: Option[];
  coupons: Option[];
  codes: Record<string, Option[]>;
  branches: Option[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: 'save' } | { kind: 'step'; row: Row; step: Step }>(null);
  const [preview, setPreview] = useState<{ name: string; count: number; sample: string[] } | null>(null);

  const blank = (): Form => ({
    id: '',
    name: '',
    campaignType: 'SEASON',
    templateId: p.templates[0]?.value ?? '',
    couponId: '',
    sendAt: '',
    branchIds: [],
    deviceTypes: [],
    housingTypes: [],
    lastServiceMonthsMin: '',
    lastServiceMonthsMax: '',
  });
  const edit = (r: Row) => {
    setErrors({});
    setError(null);
    setForm({
      id: String(r.id),
      name: r.name,
      campaignType: r.campaignType,
      templateId: r.templateId ? String(r.templateId) : '',
      couponId: r.couponId ? String(r.couponId) : '',
      sendAt: kstLocal(r.sendAt),
      branchIds: r.rule.branchIds.map(String),
      deviceTypes: r.rule.deviceTypes,
      housingTypes: r.rule.housingTypes,
      lastServiceMonthsMin: r.rule.lastServiceMonthsMin === null ? '' : String(r.rule.lastServiceMonthsMin),
      lastServiceMonthsMax: r.rule.lastServiceMonthsMax === null ? '' : String(r.rule.lastServiceMonthsMax),
    });
  };
  const editable = (r: Row | null) => p.canEdit && (!r || r.status === 'DRAFT');
  const current = form?.id ? (p.rows.find((r) => String(r.id) === form.id) ?? null) : null;

  const save = async () => {
    setConfirm(null);
    if (!form) return;
    const r = (await saveCampaignAction({ ...form, id: form.id || undefined })) as Res;
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      return setError(errOf(r, '저장하지 못했습니다.'));
    }
    setForm(null);
    toast(MSG.saved);
    router.refresh();
  };
  const runStep = async (row: Row, step: Step) => {
    setConfirm(null);
    const r = (await campaignStepAction({ id: row.id, action: step })) as Res;
    if (!r.ok) return toast(errOf(r, '처리하지 못했습니다.'));
    const d = r.data as { sent: number; failed: number } | null;
    toast(d ? `${d.sent.toLocaleString()}명에게 보냈습니다.${d.failed ? ` (실패 ${d.failed.toLocaleString()}건)` : ''}` : MSG.saved);
    router.refresh();
  };
  const openPreview = async (row: Row) => {
    const r = (await previewCampaignAction(row.id)) as Res;
    if (!r.ok) return toast(errOf(r, '대상을 불러오지 못했습니다.'));
    setPreview({ name: row.name, ...(r.data as { count: number; sample: string[] }) });
  };
  const toggle = (key: 'branchIds' | 'deviceTypes' | 'housingTypes', v: string, on: boolean) =>
    form && setForm({ ...form, [key]: on ? [...form[key], v] : form[key].filter((x) => x !== v) });

  return (
    <>
      <div className="adm-page-head">
        <h1 className="ac-h1">캠페인 관리</h1>
        {p.canEdit ? (
          <Button
            variant="primary"
            onClick={() => {
              setErrors({});
              setError(null);
              setForm(blank());
            }}
          >
            캠페인 등록
          </Button>
        ) : null}
      </div>
      <p className="ac-caption">마케팅 수신 동의 고객에게만 보냅니다. 재방문 자동 캠페인은 재방문 캠페인 화면에서 관리합니다.</p>
      {p.rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="ac-table-wrap adm-gap-top">
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">상태</th>
                <th scope="col">유형</th>
                <th scope="col">캠페인명</th>
                <th scope="col">템플릿</th>
                <th scope="col">쿠폰</th>
                <th scope="col">발송 예약</th>
                <th scope="col" className="is-num">
                  발송
                </th>
                <th scope="col" className="is-num">
                  전환
                </th>
                <th scope="col" className="is-num">
                  전환율
                </th>
                <th scope="col">처리</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.id} onDoubleClick={() => edit(r)}>
                  <td>
                    <Tag tone={TONE[r.status]}>{labelOf(p.codes.CAMPAIGN_STATUS, r.status)}</Tag>
                  </td>
                  <td>{labelOf(p.codes.CAMPAIGN_TYPE, r.campaignType)}</td>
                  <td>{r.name}</td>
                  <td>{r.templateName ?? '-'}</td>
                  <td>{r.couponName ?? '-'}</td>
                  <td className="ac-num">{r.sendAt ? formatDateTime(new Date(r.sendAt)) : '-'}</td>
                  <td className="is-num ac-num">{r.sent.toLocaleString()}</td>
                  <td className="is-num ac-num">{r.converted.toLocaleString()}</td>
                  <td className="is-num ac-num">{r.conversionRate === null ? '-' : `${r.conversionRate}%`}</td>
                  <td>
                    <div className="ac-row">
                      <Button size="sm" variant="outline" onClick={() => openPreview(r)}>
                        대상 보기
                      </Button>
                      {p.canEdit
                        ? (STEPS[r.status] ?? []).map((s) => (
                            <Button key={s} size="sm" variant={s === 'STOP' ? 'danger' : 'outline'} onClick={() => setConfirm({ kind: 'step', row: r, step: s })}>
                              {STEP_LABEL[s]}
                            </Button>
                          ))
                        : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {form ? (
        <Modal
          open
          title={form.id ? '캠페인 수정' : '캠페인 등록'}
          onClose={() => setForm(null)}
          form
          actions={
            <>
              <Button variant="outline" onClick={() => setForm(null)}>
                닫기
              </Button>
              {editable(current) ? (
                <Button variant="primary" onClick={() => setConfirm({ kind: 'save' })}>
                  저장
                </Button>
              ) : null}
            </>
          }
        >
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {!editable(current) ? <Alert tone="warning">작성 상태인 캠페인만 고칠 수 있습니다. [작성으로]를 먼저 눌러 주세요.</Alert> : null}
          <fieldset className="adm-fieldset ac-stack" disabled={!editable(current)}>
            <Field label="캠페인명" required error={errors.name}>
              {(id, d, inv) => <Input id={id} aria-describedby={d} aria-invalid={inv} maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
            </Field>
            <Field label="유형" required error={errors.campaignType}>
              {(id) => (
                <Select id={id} value={form.campaignType} onChange={(e) => setForm({ ...form, campaignType: e.target.value })}>
                  {(p.codes.CAMPAIGN_TYPE ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="발송 템플릿" required error={errors.templateId}>
              {(id) => (
                <Select id={id} value={form.templateId} onChange={(e) => setForm({ ...form, templateId: e.target.value })}>
                  <option value="">선택</option>
                  {p.templates.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="동봉 쿠폰" help="고르면 대상 고객에게 쿠폰을 함께 발급합니다.">
              {(id, d) => (
                <Select id={id} aria-describedby={d} value={form.couponId} onChange={(e) => setForm({ ...form, couponId: e.target.value })}>
                  <option value="">없음</option>
                  {p.coupons.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="예약 발송 시각" error={errors.sendAt} help="[예약]을 누르면 이 시각에 보냅니다. 비우면 [지금 발송]만 할 수 있습니다.">
              {(id, d, inv) => <Input id={id} type="datetime-local" aria-describedby={d} aria-invalid={inv} value={form.sendAt} onChange={(e) => setForm({ ...form, sendAt: e.target.value })} />}
            </Field>
            <div>
              <p className="ac-label">대상 거점 (선택하지 않으면 전체)</p>
              <div className="ac-row">
                {p.branches.map((b) => (
                  <Check key={b.value} label={b.label} checked={form.branchIds.includes(b.value)} onChange={(e) => toggle('branchIds', b.value, e.target.checked)} />
                ))}
              </div>
            </div>
            <div>
              <p className="ac-label">기기 형태 (등록 기기 기준, 선택하지 않으면 전체)</p>
              <div className="ac-row">
                {(p.codes.DEVICE_TYPE ?? []).map((o) => (
                  <Check key={o.value} label={o.label} checked={form.deviceTypes.includes(o.value)} onChange={(e) => toggle('deviceTypes', o.value, e.target.checked)} />
                ))}
              </div>
            </div>
            <div>
              <p className="ac-label">주거 형태 (선택하지 않으면 전체)</p>
              <div className="ac-row">
                {(p.codes.HOUSING_TYPE ?? []).map((o) => (
                  <Check key={o.value} label={o.label} checked={form.housingTypes.includes(o.value)} onChange={(e) => toggle('housingTypes', o.value, e.target.checked)} />
                ))}
              </div>
            </div>
            <div className="adm-two-col">
              <Field label="최근 작업 후 최소 경과(개월)" error={errors.lastServiceMonthsMin}>
                {(id, d, inv) => (
                  <Input id={id} type="number" inputMode="numeric" min={0} aria-describedby={d} aria-invalid={inv} value={form.lastServiceMonthsMin} onChange={(e) => setForm({ ...form, lastServiceMonthsMin: e.target.value })} />
                )}
              </Field>
              <Field label="최근 작업 후 최대 경과(개월)" error={errors.lastServiceMonthsMax}>
                {(id, d, inv) => (
                  <Input id={id} type="number" inputMode="numeric" min={0} aria-describedby={d} aria-invalid={inv} value={form.lastServiceMonthsMax} onChange={(e) => setForm({ ...form, lastServiceMonthsMax: e.target.value })} />
                )}
              </Field>
            </div>
          </fieldset>
        </Modal>
      ) : null}
      <Modal
        open={preview !== null}
        title="대상 미리보기"
        description={preview ? `${preview.name} · ${preview.count.toLocaleString()}명` : undefined}
        onClose={() => setPreview(null)}
        actions={
          <Button variant="outline" onClick={() => setPreview(null)}>
            닫기
          </Button>
        }
      >
        {preview && preview.sample.length ? <p className="ac-body-sm ac-num">{preview.sample.join(', ')}{preview.count > preview.sample.length ? ' …' : ''}</p> : <Empty />}
      </Modal>
      <ConfirmModal
        open={confirm !== null}
        message={confirm?.kind === 'step' ? STEP_ASK[confirm.step] : MSG.confirmSave}
        confirmLabel={confirm?.kind === 'step' ? STEP_LABEL[confirm.step] : '저장'}
        danger={confirm?.kind === 'step' && confirm.step === 'STOP'}
        onConfirm={() => (confirm?.kind === 'step' ? runStep(confirm.row, confirm.step) : save())}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
