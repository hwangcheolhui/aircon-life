'use client';
// A-TEC-030 지원자 관리 (F-ADM-TEC-04): 목록(검색 Enter = 조회, 더블클릭 = 수정) + 행별 [면접]·[불합격]·[합격 처리]
import { Alert, Button, ConfirmModal, Field, Input, MSG, Modal, Select, Tag, Textarea, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CrudScreen, type Option, labelOf } from '@/admin/crud-screen';
import type { listApplications } from '@/server/training';
import { acceptApplicationAction, applicationDetailAction, changeApplicationStatusAction, deleteApplicationAction, saveApplicationAction } from './actions';

type Row = Awaited<ReturnType<typeof listApplications>>[number];
const TONE: Record<string, 'primary' | 'success' | 'warning' | 'danger' | undefined> = { APPLIED: 'primary', INTERVIEW: 'warning', ACCEPTED: 'success', REJECTED: 'danger' };

export function ApplicantsScreen(p: { rows: Row[]; codes: Record<string, Option[]>; branches: Option[]; canCreate: boolean; canUpdate: boolean; canDelete: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [status, setStatus] = useState<{ row: Row; to: 'INTERVIEW' | 'REJECTED' } | null>(null);
  const [note, setNote] = useState('');
  const [accept, setAccept] = useState<Row | null>(null);
  const [acc, setAcc] = useState({ techCode: '', contractType: 'FREELANCER', branchId: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setStatus(null);
    setAccept(null);
    setErrors({});
    setError(null);
  };
  const done = (msg: string) => {
    close();
    toast(msg);
    router.refresh();
  };

  return (
    <>
      <CrudScreen<Row>
        title="지원자 관리"
        noun="지원서"
        rows={p.rows}
        rowKey={(r) => r.id}
        canCreate={p.canCreate}
        canUpdate={p.canUpdate}
        canDelete={p.canDelete}
        filters={[
          { name: 'status', label: '상태', options: p.codes.APPLICATION_STATUS, match: (r, v) => r.status === v },
          { name: 'source', label: '유입 경로', options: p.codes.APPLICATION_SOURCE, match: (r, v) => r.source === v },
          { name: 'region', label: '지역', match: (r, v) => (r.region ?? '').includes(v) },
        ]}
        columns={[
          { header: '상태', cell: (r) => <Tag tone={TONE[r.status]}>{labelOf(p.codes.APPLICATION_STATUS, r.status)}</Tag> },
          { header: '지원일', cell: (r) => <span className="ac-num">{r.appliedAt}</span> },
          { header: '거점', cell: (r) => r.branchName },
          { header: '이름', cell: (r) => <span className="ac-masked">{r.name}</span> },
          { header: '연락처', cell: (r) => <span className="ac-masked ac-num">{r.phone ?? ''}</span> },
          { header: '연령대', cell: (r) => labelOf(p.codes.AGE_GROUP, r.ageGroup) },
          { header: '지역', cell: (r) => r.region ?? '' },
          { header: '경력', num: true, cell: (r) => (r.experienceYears == null ? '' : <span className="ac-num">{r.experienceYears}년</span>) },
          { header: '유입', cell: (r) => labelOf(p.codes.APPLICATION_SOURCE, r.source) },
          { header: '지원 대상', cell: (r) => (r.supportTargetFlag ? <Tag tone="primary">대상</Tag> : '') },
          {
            header: '처리',
            cell: (r) =>
              r.status === 'ACCEPTED' ? (
                <span className="ac-num">{r.techCode}</span>
              ) : r.status === 'REJECTED' || !p.canUpdate ? null : (
                <div className="ac-row">
                  {r.status === 'APPLIED' ? (
                    <Button size="sm" variant="outline" onClick={() => (setNote(r.note ?? ''), setStatus({ row: r, to: 'INTERVIEW' }))}>
                      면접
                    </Button>
                  ) : null}
                  {p.canCreate ? (
                    <Button size="sm" variant="outline" onClick={() => (setAcc({ techCode: '', contractType: 'FREELANCER', branchId: String(r.branchId) }), setAccept(r))}>
                      합격 처리
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => (setNote(r.note ?? ''), setStatus({ row: r, to: 'REJECTED' }))}>
                    불합격
                  </Button>
                </div>
              ),
          },
        ]}
        toForm={(r) => ({ ...r, branchId: String(r.branchId), phone: '' })}
        loadDetail={
          p.canUpdate
            ? async (r) => {
                const res = await applicationDetailAction(r.id);
                return res.ok ? (res.data as Record<string, unknown>) : null;
              }
            : undefined
        }
        defaults={{ branchId: p.branches[0]?.value ?? '', source: 'JOB_SITE' }}
        fields={[
          { name: 'branchId', label: '지원 거점', type: 'select', required: true, options: p.branches },
          { name: 'source', label: '유입 경로', type: 'select', required: true, options: p.codes.APPLICATION_SOURCE },
          { name: 'name', label: '이름', required: true },
          { name: 'phone', label: '연락처', required: true, inputMode: 'tel', help: '휴대폰 번호 (암호화 저장)' },
          { name: 'ageGroup', label: '연령대', type: 'select', options: p.codes.AGE_GROUP },
          { name: 'region', label: '거주 지역' },
          { name: 'experienceYears', label: '경력(년)', type: 'number' },
          { name: 'licenses', label: '보유 자격' },
          { name: 'supportTargetFlag', label: '지원 대상(취업 지원 프로그램)', type: 'checkbox' },
          { name: 'note', label: '메모', type: 'textarea' },
        ]}
        save={saveApplicationAction}
        remove={deleteApplicationAction}
      />

      <Modal
        open={status !== null}
        form
        title={status?.to === 'INTERVIEW' ? '면접으로 변경' : '불합격 처리'}
        onClose={close}
        actions={
          <>
            <Button variant="ghost" onClick={close}>
              닫기
            </Button>
            <Button
              variant={status?.to === 'REJECTED' ? 'danger' : 'primary'}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                const r = await changeApplicationStatusAction({ id: String(status!.row.id), status: status!.to, note });
                setBusy(false);
                if (!r.ok) return setError(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? null);
                done(MSG.saved);
              }}
            >
              {status?.to === 'INTERVIEW' ? '면접으로 변경' : '불합격'}
            </Button>
          </>
        }
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="메모">{(id) => <Textarea id={id} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </Modal>

      <Modal
        open={accept !== null}
        form
        title="합격 처리 (기사 계정 생성)"
        description="교육중·견습 기사로 등록되고 합격 안내가 발송됩니다. 기사는 휴대폰 번호로 로그인합니다."
        onClose={close}
        actions={
          <>
            <Button variant="ghost" onClick={close}>
              닫기
            </Button>
            <Button variant="primary" loading={busy} onClick={() => setConfirm(true)}>
              합격 처리
            </Button>
          </>
        }
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="adm-form-grid">
          <Field label="기사 코드" required error={errors.techCode}>
            {(id, d, inv) => <Input id={id} aria-describedby={d} aria-invalid={inv} value={acc.techCode} maxLength={20} onChange={(e) => setAcc({ ...acc, techCode: e.target.value })} />}
          </Field>
          <Field label="계약 형태" required error={errors.contractType}>
            {(id, d, inv) => (
              <Select id={id} aria-describedby={d} aria-invalid={inv} value={acc.contractType} onChange={(e) => setAcc({ ...acc, contractType: e.target.value })}>
                {(p.codes.CONTRACT_TYPE ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="소속 거점" required error={errors.branchId}>
            {(id, d, inv) => (
              <Select id={id} aria-describedby={d} aria-invalid={inv} value={acc.branchId} onChange={(e) => setAcc({ ...acc, branchId: e.target.value })}>
                {p.branches.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </Modal>
      <ConfirmModal
        open={confirm}
        message="합격 처리하시겠습니까?"
        description="기사 계정이 만들어지고 합격 안내가 발송됩니다."
        confirmLabel="합격 처리"
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          setConfirm(false);
          setBusy(true);
          const r = await acceptApplicationAction({ id: String(accept!.id), ...acc });
          setBusy(false);
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            return setError(r.message ?? null);
          }
          done('합격 처리했습니다. 기사 계정이 만들어졌습니다.');
        }}
      />
    </>
  );
}
