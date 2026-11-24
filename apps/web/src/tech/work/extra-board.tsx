'use client';
// T-WRK-040 추가요금 · F-TEC-WRK-05: 사전공개 규칙 선택 / 자재 / 기타(사유·증빙 필수, 관리자 승인 BR-042) / 현장 기기 추가(F-TEC-WRK-04)
// 등록하면 고객 앱 동의 요청(기타는 승인 후). 앱을 못 쓰는 고객은 현장 서명으로 동의(BR-040). 응답 전에는 철회 가능.
import type { ExtraChargeState } from '@aircon/domain';
import { Alert, Button, ConfirmModal, Empty, Field, Input, Select, Sheet as UiSheet, Tag, Textarea, useToast } from '@aircon/ui';
import { Camera, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { addJobExtraCharge, signJobExtraCharge, withdrawJobExtraCharge } from '@/app/(tech)/tech/(flow)/actions';
import { formatWon } from '@/customer/format';
import type { getExtraScreen } from '@/server/extra-charges';
import { compressImage } from './photo-queue';
import { SignaturePad, type SignatureRead } from './signature-pad';

type Screen = Awaited<ReturnType<typeof getExtraScreen>>;
type Charge = Screen['charges'][number];
type Code = { value: string; label: string };
type Res = { ok: boolean; message?: string; fieldErrors?: Record<string, string> };

/** 상태는 색 + 글자 (05 §7) */
const STATE: Record<ExtraChargeState, { label: string; tone?: 'primary' | 'success' | 'warning' | 'danger' }> = {
  WAIT_APPROVAL: { label: '관리자 승인 대기', tone: 'warning' },
  REJECTED: { label: '관리자 반려(청구 안 함)', tone: 'danger' },
  WAIT_CUSTOMER: { label: '고객 동의 대기', tone: 'warning' },
  AGREED: { label: '고객 동의', tone: 'success' },
  DECLINED: { label: '고객 거절(청구 안 함)', tone: 'danger' },
  WITHDRAWN: { label: '철회' },
};

const errOf = (r: Res, fallback: string) => r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? fallback;

function Sheet(p: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <UiSheet {...p} overlayClassName="tec-sheet-overlay" />;
}

function AddSheet({ s, types, onClose }: { s: Screen; types: Code[]; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [type, setType] = useState('');
  const [ruleId, setRuleId] = useState('');
  const [baseId, setBaseId] = useState('');
  const [qty, setQty] = useState('1');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  const rule = s.rules.find((r) => String(r.id) === ruleId);
  const base = s.products.find((p) => String(p.id) === baseId);
  const autoAmount = type === 'RULE' ? (rule?.amount ?? null) : type === 'DEVICE_ADD' ? (base ? base.unitPrice * Math.max(Number(qty) || 0, 0) : null) : null;
  const needPhoto = type === 'ETC' || type === 'MATERIAL';
  return (
    <Sheet title="추가요금 등록" onClose={onClose}>
      {message ? <Alert tone="danger">{message}</Alert> : null}
      <Field label="유형" required error={errors.chargeType}>
        {(id, d, inv) => (
          <Select id={id} aria-describedby={d} aria-invalid={inv} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">선택</option>
            {types.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {type === 'ETC' ? <Alert tone="warning">기타 추가요금은 관리자 승인 후에 고객에게 동의를 요청합니다.</Alert> : null}
      {type === 'RULE' ? (
        <Field label="추가요금 규칙" required error={errors.surchargeRuleId} help={rule?.customerNotice ?? undefined}>
          {(id, d, inv) => (
            <Select id={id} aria-describedby={d} aria-invalid={inv} value={ruleId} onChange={(e) => setRuleId(e.target.value)}>
              <option value="">선택</option>
              {s.rules.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({formatWon(r.amount)})
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
      {type === 'DEVICE_ADD' ? (
        <>
          <Field label="추가할 기기" required error={errors.baseOrderItemId}>
            {(id, d, inv) => (
              <Select id={id} aria-describedby={d} aria-invalid={inv} value={baseId} onChange={(e) => setBaseId(e.target.value)}>
                <option value="">선택</option>
                {s.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (대당 {formatWon(p.unitPrice)})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="추가 대수" required error={errors.quantity}>
            {(id, d, inv) => (
              <Input id={id} aria-describedby={d} aria-invalid={inv} type="number" inputMode="numeric" min={1} max={20} value={qty} onChange={(e) => setQty(e.target.value)} />
            )}
          </Field>
        </>
      ) : null}
      {type === 'ETC' || type === 'MATERIAL' ? (
        <>
          <Field label="항목명" required error={errors.title}>
            {(id, d, inv) => <Input id={id} aria-describedby={d} aria-invalid={inv} maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field label="금액(원)" required error={errors.amount}>
            {(id, d, inv) => (
              <Input id={id} aria-describedby={d} aria-invalid={inv} type="number" inputMode="numeric" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
            )}
          </Field>
        </>
      ) : null}
      {autoAmount !== null ? (
        <p className="ac-body">
          청구 예정 금액 <strong className="ac-num">{formatWon(autoAmount)}</strong>
        </p>
      ) : null}
      <Field label="사유" required error={errors.reason} help="고객에게 그대로 보입니다.">
        {(id, d, inv) => <Textarea id={id} aria-describedby={d} aria-invalid={inv} rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <div className="tec-section">
        <span className="ac-label">
          증빙 사진 {needPhoto ? <span className="ac-caption">(필수)</span> : <span className="ac-caption">(선택)</span>}
        </span>
        <div className="ac-photo-grid">
          {preview ? (
            <div className="ac-photo-slot">
              <img src={preview} alt="추가요금 증빙 사진" />
            </div>
          ) : null}
          <label className={`ac-photo-slot ac-photo-slot--add${needPhoto && !photo ? ' ac-photo-slot--required' : ''}`}>
            <Camera aria-hidden />
            {photo ? '다시 찍기' : '증빙 촬영'}
            <input
              type="file"
              accept="image/*"
              aria-label="추가요금 증빙 촬영"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                const small = await compressImage(f).catch(() => f);
                setPhoto(small);
                setPreview(URL.createObjectURL(small));
              }}
            />
          </label>
        </div>
        {errors.evidence ? (
          <div className="ac-field ac-field--error">
            <span className="ac-help" role="alert">
              {errors.evidence}
            </span>
          </div>
        ) : null}
      </div>
      <div className="tec-btn-row">
        <Button variant="secondary" size="lg" onClick={onClose}>
          닫기
        </Button>
        <Button
          variant="primary"
          size="lg"
          loading={pending}
          onClick={() =>
            start(async () => {
              setErrors({});
              setMessage(null);
              const form = new FormData();
              form.set('orderNo', s.orderNo);
              form.set('chargeType', type);
              form.set('surchargeRuleId', ruleId);
              form.set('baseOrderItemId', baseId);
              form.set('quantity', type === 'DEVICE_ADD' ? qty : '');
              form.set('title', title);
              form.set('amount', amount);
              form.set('reason', reason);
              if (photo) form.set('evidence', new File([photo], 'evidence.jpg', { type: photo.type || 'image/jpeg' }));
              const r = await addJobExtraCharge(form);
              if (!r.ok) {
                setErrors(r.fieldErrors ?? {});
                return setMessage(r.message ?? null);
              }
              const d = r.data as { approvalStatus: string };
              toast(d.approvalStatus === 'REQUESTED' ? '관리자에게 승인을 요청했습니다.' : '고객에게 동의를 요청했습니다.');
              onClose();
              router.refresh();
            })
          }
        >
          등록
        </Button>
      </div>
    </Sheet>
  );
}

function SignSheet({ orderNo, charge, onClose }: { orderNo: string; charge: Charge; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const read = useRef<SignatureRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Sheet title="현장 서명으로 동의 받기" onClose={onClose}>
      <p className="ac-body">
        {charge.title} <strong className="ac-num">{formatWon(charge.amount)}</strong>
      </p>
      <p className="ac-caption">사유: {charge.reason}</p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <SignaturePad readRef={read} />
      <div className="tec-btn-row">
        <Button variant="secondary" size="lg" onClick={onClose}>
          닫기
        </Button>
        <Button
          variant="primary"
          size="lg"
          loading={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const sig = (await read.current?.()) ?? null;
              if (!sig) return setError('고객 서명을 받아 주세요.');
              const form = new FormData();
              form.set('orderNo', orderNo);
              form.set('chargeId', String(charge.id));
              form.set('signature', new File([sig], 'signature.png', { type: 'image/png' }));
              const r = await signJobExtraCharge(form);
              if (!r.ok) return setError(errOf(r, '저장하지 못했습니다.'));
              toast('고객 동의를 저장했습니다.');
              onClose();
              router.refresh();
            })
          }
        >
          동의 저장
        </Button>
      </div>
    </Sheet>
  );
}

export function ExtraBoard({ s, types }: { s: Screen; types: Code[] }) {
  const router = useRouter();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [signing, setSigning] = useState<Charge | null>(null);
  const [withdrawing, setWithdrawing] = useState<Charge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const typeLabel = (v: string) => types.find((t) => t.value === v)?.label ?? v;
  const waiting = s.charges.filter((c) => c.state === 'WAIT_APPROVAL' || c.state === 'WAIT_CUSTOMER').length;
  return (
    <>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <section className="ac-card tec-section" aria-labelledby="extra-sum">
        <h2 id="extra-sum" className="ac-h3">
          금액
        </h2>
        <dl className="tec-kv ac-body">
          <dt>작업비</dt>
          <dd className="ac-num">{formatWon(s.laborAmount)}</dd>
          <dt>동의된 추가요금</dt>
          <dd className="ac-num">{formatWon(s.agreed)}</dd>
        </dl>
        <p className="ac-caption">고객이 동의한 추가요금만 청구됩니다.</p>
      </section>
      {s.editable ? (
        <Button variant="outline" size="lg" block onClick={() => setAdding(true)}>
          <Plus aria-hidden /> 추가요금 등록
        </Button>
      ) : null}
      {s.charges.length ? (
        <ul className="ac-list" aria-label="추가요금 목록">
          {s.charges.map((c) => (
            <li key={c.id} className="ac-list-item tec-extra-item">
              <div className="ac-list-item__body">
                <div className="tec-job-card__top">
                  <Tag tone={STATE[c.state].tone}>{STATE[c.state].label}</Tag>
                  <span className="ac-caption">{typeLabel(c.chargeType)}</span>
                </div>
                <p className="ac-body">
                  {c.title} <strong className="ac-num">{formatWon(c.amount)}</strong>
                </p>
                <p className="ac-caption">사유: {c.reason}</p>
                {c.rejectReason ? <p className="ac-caption">반려 사유: {c.rejectReason}</p> : null}
                {c.evidenceUrl ? (
                  <a href={c.evidenceUrl} target="_blank" rel="noreferrer" className="ac-btn ac-btn--text ac-btn--sm">
                    증빙 사진 보기
                  </a>
                ) : null}
                {s.editable && (c.state === 'WAIT_CUSTOMER' || c.state === 'WAIT_APPROVAL') ? (
                  <div className="tec-btn-row">
                    {c.state === 'WAIT_CUSTOMER' ? (
                      <Button variant="secondary" onClick={() => setSigning(c)}>
                        현장 서명으로 동의
                      </Button>
                    ) : null}
                    <Button variant="text" onClick={() => setWithdrawing(c)}>
                      철회
                    </Button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>등록한 추가요금이 없습니다.</Empty>
      )}
      {waiting ? <Alert tone="warning">응답을 기다리는 추가요금이 {waiting}건 있습니다. 동의·거절 또는 철회 후에 완료할 수 있습니다.</Alert> : null}
      <Link href={`/tech/jobs/${s.orderNo}/work/complete`} className="ac-btn ac-btn--primary ac-btn--lg ac-btn--block">
        다음: 처리 저장
      </Link>
      {adding ? <AddSheet s={s} types={types} onClose={() => setAdding(false)} /> : null}
      {signing ? <SignSheet orderNo={s.orderNo} charge={signing} onClose={() => setSigning(null)} /> : null}
      <ConfirmModal
        open={withdrawing !== null}
        message="추가요금을 철회하시겠습니까?"
        description={withdrawing ? `${withdrawing.title} ${formatWon(withdrawing.amount)}은 청구되지 않습니다.` : undefined}
        confirmLabel="철회"
        danger
        onCancel={() => setWithdrawing(null)}
        onConfirm={async () => {
          const c = withdrawing!;
          setWithdrawing(null);
          const r = await withdrawJobExtraCharge({ orderNo: s.orderNo, chargeId: c.id });
          if (!r.ok) return setError(errOf(r, '철회하지 못했습니다.'));
          toast('추가요금을 철회했습니다.');
          router.refresh();
        }}
      />
    </>
  );
}
