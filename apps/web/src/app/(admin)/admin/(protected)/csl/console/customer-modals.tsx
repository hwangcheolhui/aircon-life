'use client';
// A-CSL-011 고객정보 조회 · A-CSL-012 신규 고객 등록(주소 4단계) · A-CSL-013 개인정보 동의 · A-CSL-014 고객정보 수정
import type { AddressResult } from '@aircon/integrations/address';
import { Alert, Button, Check, ConfirmModal, Empty, Field, Input, MSG, Modal, Select, Tabs, useToast } from '@aircon/ui';
import { useEffect, useState } from 'react';
import { type Option, labelOf } from '@/admin/crud-screen';
import type { ConsoleCustomerMatch } from '@/server/consult';
import { AddressSearchModal } from '@/shared/address-search';
import { refineAddressAction, registerCustomer, updateCustomer, viewCustomerPii } from './actions';

type Codes = Record<string, Option[]>;
type Res = { ok: boolean; message?: string; fieldErrors?: Record<string, string>; data?: unknown };
const errOf = (r: Res) => r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '처리하지 못했습니다.';

/* ---------- 주소 4단계 (주소검색 → 주소선택 → 상세주소 → 주소정제) ---------- */

export interface AddressDraft {
  address: AddressResult | null;
  detailAddress: string;
  housingType: string;
  hasElevator: boolean;
  parkingNote: string;
  refined: { serviceable: boolean; branchName: string | null; outOfScope: boolean } | null;
}
export const emptyAddress = (): AddressDraft => ({ address: null, detailAddress: '', housingType: '', hasElevator: false, parkingNote: '', refined: null });
export const addressPayload = (a: AddressDraft) => ({
  address: { zipcode: a.address?.zipcode, roadAddress: a.address?.roadAddress, jibunAddress: a.address?.jibunAddress, legalDongCode: a.address?.legalDongCode },
  detailAddress: a.detailAddress,
  housingType: a.housingType,
  hasElevator: a.hasElevator,
  parkingNote: a.parkingNote,
});

function AddressSteps({ value, onChange, codes, errors }: { value: AddressDraft; onChange: (v: AddressDraft) => void; codes: Codes; errors: Record<string, string> }) {
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const step = !value.address ? 0 : !value.detailAddress.trim() ? 2 : !value.refined ? 3 : 4;
  const steps = ['주소검색', '주소선택', '상세주소', '주소정제'];
  return (
    <div className="adm-csl-address">
      <ol className="ac-steps adm-csl-steps" aria-label="주소 등록 단계">
        {steps.map((s, i) => (
          <li key={s} className={i === Math.min(step, 3) ? 'is-current' : undefined} aria-current={i === Math.min(step, 3) ? 'step' : undefined}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>
      <div className="adm-form-grid">
        <div className="adm-span-2">
          <Field label="주소" required error={errors['address.legalDongCode'] ?? errors['address.roadAddress']}>
            {(id) => (
              <div className="ac-row" style={{ flexWrap: 'nowrap' }}>
                <Input id={id} readOnly value={value.address ? `(${value.address.zipcode}) ${value.address.roadAddress}` : ''} />
                <Button onClick={() => setSearching(true)}>주소 검색</Button>
              </div>
            )}
          </Field>
        </div>
        <Field label="상세주소" required error={errors.detailAddress}>
          {(id) => <Input id={id} value={value.detailAddress} maxLength={200} disabled={!value.address} onChange={(e) => onChange({ ...value, detailAddress: e.target.value, refined: null })} />}
        </Field>
        <Field label="주거 유형">
          {(id) => (
            <Select id={id} value={value.housingType} onChange={(e) => onChange({ ...value, housingType: e.target.value })}>
              <option value="">선택</option>
              {codes.HOUSING_TYPE?.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Check label="엘리베이터 있음" checked={value.hasElevator} onChange={(e) => onChange({ ...value, hasElevator: e.target.checked })} />
        <Field label="주차 안내">{(id) => <Input id={id} value={value.parkingNote} maxLength={200} onChange={(e) => onChange({ ...value, parkingNote: e.target.value })} />}</Field>
      </div>
      <div className="adm-toolbar">
        <span className="ac-body-sm">
          {value.refined ? (
            value.refined.outOfScope ? (
              <span className="adm-text-danger">다른 거점 관할 주소입니다.</span>
            ) : value.refined.serviceable ? (
              <>
                정제 완료: {value.address?.jibunAddress ?? value.address?.roadAddress} · 관할 <strong>{value.refined.branchName}</strong>
              </>
            ) : (
              <span className="adm-text-danger">서비스 지역이 아닙니다. 고객 등록은 되지만 출장접수는 할 수 없습니다.</span>
            )
          ) : (
            '상세주소까지 넣은 뒤 주소 정제를 눌러 관할 거점을 확인하세요.'
          )}
        </span>
        <Button
          size="sm"
          disabled={!value.address || !value.detailAddress.trim()}
          onClick={async () => {
            setError(null);
            const r = (await refineAddressAction(value.address!.legalDongCode)) as Res;
            if (!r.ok) return setError(errOf(r));
            onChange({ ...value, refined: r.data as AddressDraft['refined'] });
          }}
        >
          주소 정제
        </Button>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <AddressSearchModal
        prefix="adm"
        open={searching}
        onClose={() => setSearching(false)}
        onSelect={(a) => {
          onChange({ ...value, address: a, refined: null });
          setSearching(false);
        }}
      />
    </div>
  );
}

/* ---------- A-CSL-011 고객정보 조회 [고객목록 | 고객등록] ---------- */

export function LookupModal(p: {
  open: boolean;
  phone: string;
  matches: ConsoleCustomerMatch[];
  hiddenCount: number;
  codes: Codes;
  canWrite: boolean;
  onClose: () => void;
  onSelect: (customerId: number) => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<'list' | 'register'>(p.matches.length ? 'list' : 'register');
  const [form, setForm] = useState({ name: '', phone1: p.phone, phone2: '', customerType: 'PERSONAL' });
  const [addr, setAddr] = useState<AddressDraft>(emptyAddress());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setConfirm(false);
    setBusy(true);
    const r = (await registerCustomer({ ...form, ...addressPayload(addr) })) as Res;
    setBusy(false);
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      return setError(errOf(r));
    }
    toast(MSG.saved);
    p.onSelect((r.data as { customerId: number }).customerId);
  };

  return (
    <Modal open={p.open} title="고객정보 조회" onClose={p.onClose} form>
      <Tabs
        items={[
          { value: 'list', label: `고객목록 (${p.matches.length})` },
          { value: 'register', label: '고객등록' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'list' ? (
        <div className="adm-csl-modal-body">
          {p.hiddenCount > 0 ? <Alert tone="warning">같은 번호의 다른 거점 고객이 {p.hiddenCount}명 있습니다. 해당 거점에 문의하세요.</Alert> : null}
          {p.matches.length === 0 ? (
            <Empty />
          ) : (
            <div className="ac-table-wrap">
              <table className="ac-table">
                <thead>
                  <tr>
                    <th scope="col">고객번호</th>
                    <th scope="col">고객명</th>
                    <th scope="col">전화1</th>
                    <th scope="col">주소</th>
                    <th scope="col">등급</th>
                    <th scope="col">동의</th>
                    <th scope="col">최근작업일</th>
                  </tr>
                </thead>
                <tbody>
                  {p.matches.map((m) => (
                    <tr key={m.id} tabIndex={0} aria-label={`${m.customerNo} 고객 선택`} onDoubleClick={() => p.onSelect(m.id)} onKeyDown={(e) => e.key === 'Enter' && p.onSelect(m.id)}>
                      <td className="ac-num">{m.customerNo}</td>
                      <td>
                        <span className="ac-masked">{m.nameMasked}</span>
                      </td>
                      <td>
                        <span className="ac-masked ac-num">{m.phoneMasked}</span>
                      </td>
                      <td>{m.roadAddress ?? '-'}</td>
                      <td>{labelOf(p.codes.CUSTOMER_GRADE, m.grade)}</td>
                      <td>{labelOf(p.codes.PRIVACY_AGREE_STATUS, m.privacyAgreeStatus)}</td>
                      <td className="ac-num">{m.lastServiceDate ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="ac-caption">행을 더블클릭(또는 Enter)하면 콘솔에 고객 정보가 들어갑니다.</p>
        </div>
      ) : (
        <fieldset className="adm-csl-modal-body adm-fieldset" disabled={!p.canWrite || busy}>
          {!p.canWrite ? <Alert tone="warning">고객 등록 권한이 없습니다.</Alert> : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div className="adm-form-grid">
            <Field label="고객명" required error={errors.name}>
              {(id) => <Input id={id} value={form.name} maxLength={30} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
            </Field>
            <Field label="고객 유형">
              {(id) => (
                <Select id={id} value={form.customerType} onChange={(e) => setForm({ ...form, customerType: e.target.value })}>
                  {p.codes.CUSTOMER_TYPE?.filter((c) => c.value === 'PERSONAL' || c.value === 'BUSINESS').map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="전화1" required error={errors.phone1}>
              {(id) => <Input id={id} inputMode="tel" value={form.phone1} onChange={(e) => setForm({ ...form, phone1: e.target.value })} />}
            </Field>
            <Field label="전화2" error={errors.phone2}>
              {(id) => <Input id={id} inputMode="tel" value={form.phone2} onChange={(e) => setForm({ ...form, phone2: e.target.value })} />}
            </Field>
          </div>
          <AddressSteps value={addr} onChange={setAddr} codes={p.codes} errors={errors} />
          <div className="ac-modal__actions">
            <Button variant="outline" onClick={p.onClose}>
              닫기
            </Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() => {
                const miss: Record<string, string> = {};
                if (!form.name.trim()) miss.name = MSG.required('고객명');
                if (!form.phone1.trim()) miss.phone1 = MSG.required('전화1');
                if (!addr.address) miss['address.legalDongCode'] = MSG.required('주소');
                if (!addr.detailAddress.trim()) miss.detailAddress = MSG.required('상세주소');
                setErrors(miss);
                if (Object.keys(miss).length) return;
                if (!addr.refined) return setError('주소 정제를 먼저 해 주세요.');
                if (addr.refined.outOfScope) return setError('다른 거점 관할 주소의 고객은 등록할 수 없습니다.');
                setError(null);
                setConfirm(true);
              }}
            >
              등록
            </Button>
          </div>
        </fieldset>
      )}
      {tab === 'list' ? (
        <div className="ac-modal__actions">
          <Button variant="outline" onClick={p.onClose}>
            닫기
          </Button>
        </div>
      ) : null}
      <ConfirmModal open={confirm} onConfirm={save} onCancel={() => setConfirm(false)} />
    </Modal>
  );
}

/* ---------- A-CSL-013 개인정보 수집 동의 ---------- */

export function ConsentModal(p: { open: boolean; script: string | null; busy: boolean; onAnswer: (a: 'AGREE' | 'DISAGREE' | 'NOT_ASKED') => void; onClose: () => void }) {
  return (
    <Modal
      open={p.open}
      title="개인정보 수집 동의"
      description="고객에게 아래 멘트를 읽어 주고 응답을 기록하세요."
      onClose={p.onClose}
      actions={
        <>
          <Button variant="outline" disabled={p.busy} onClick={() => p.onAnswer('NOT_ASKED')}>
            질의못함
          </Button>
          <Button variant="outline" disabled={p.busy} onClick={() => p.onAnswer('DISAGREE')}>
            미동의
          </Button>
          <Button variant="primary" disabled={p.busy} onClick={() => p.onAnswer('AGREE')}>
            동의
          </Button>
        </>
      }
    >
      <blockquote className="adm-csl-script">{p.script ?? '개인정보 동의 응대 멘트가 등록되지 않았습니다. 상담 스크립트(A-CNT-050)에서 등록하세요.'}</blockquote>
    </Modal>
  );
}

/* ---------- A-CSL-014 고객정보 수정 ---------- */

export function EditCustomerModal(p: { open: boolean; customerId: number; happycallReject: boolean; codes: Codes; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState({ name: '', phone1: '', phone2: '', happycallReject: p.happycallReject });
  const [addNew, setAddNew] = useState(false);
  const [addr, setAddr] = useState<AddressDraft>(emptyAddress());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  // 원문을 불러와야 고칠 수 있다 → 열람 감사 로그가 남는다
  useEffect(() => {
    if (!p.open || loaded) return;
    setLoaded(true);
    void viewCustomerPii(p.customerId).then((r) => {
      const res = r as Res;
      if (!res.ok) return setError(errOf(res));
      const d = res.data as { name: string; phone1: string; phone2: string };
      setForm((f) => ({ ...f, name: d.name, phone1: d.phone1, phone2: d.phone2 }));
    });
  }, [p.open, p.customerId, loaded]);

  const save = async () => {
    setConfirm(false);
    setBusy(true);
    const r = (await updateCustomer({ customerId: p.customerId, ...form, newAddress: addNew ? addressPayload(addr) : null })) as Res;
    setBusy(false);
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      return setError(errOf(r));
    }
    toast(MSG.saved);
    setLoaded(false);
    p.onSaved();
  };

  return (
    <Modal
      open={p.open}
      title="고객정보 수정"
      onClose={() => (setLoaded(false), p.onClose())}
      form
      actions={
        <>
          <Button variant="outline" onClick={() => (setLoaded(false), p.onClose())}>
            닫기
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={() => {
              const miss: Record<string, string> = {};
              if (!form.name.trim()) miss.name = MSG.required('고객명');
              if (!form.phone1.trim()) miss.phone1 = MSG.required('전화1');
              if (addNew && !addr.address) miss['address.legalDongCode'] = MSG.required('주소');
              if (addNew && !addr.detailAddress.trim()) miss.detailAddress = MSG.required('상세주소');
              setErrors(miss);
              if (Object.keys(miss).length) return;
              if (addNew && !addr.refined) return setError('주소 정제를 먼저 해 주세요.');
              setError(null);
              setConfirm(true);
            }}
          >
            저장
          </Button>
        </>
      }
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="adm-form-grid">
        <Field label="고객명" required error={errors.name}>
          {(id) => <Input id={id} value={form.name} maxLength={30} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
        </Field>
        <Check label="해피콜 거부" checked={form.happycallReject} onChange={(e) => setForm({ ...form, happycallReject: e.target.checked })} />
        <Field label="전화1" required error={errors.phone1}>
          {(id) => <Input id={id} inputMode="tel" value={form.phone1} onChange={(e) => setForm({ ...form, phone1: e.target.value })} />}
        </Field>
        <Field label="전화2" error={errors.phone2}>
          {(id) => <Input id={id} inputMode="tel" value={form.phone2} onChange={(e) => setForm({ ...form, phone2: e.target.value })} />}
        </Field>
      </div>
      <Check label="새 주소 추가(기본 주소로 지정)" checked={addNew} onChange={(e) => setAddNew(e.target.checked)} />
      {addNew ? <AddressSteps value={addr} onChange={setAddr} codes={p.codes} errors={errors} /> : null}
      <ConfirmModal open={confirm} onConfirm={save} onCancel={() => setConfirm(false)} />
    </Modal>
  );
}
