'use client';
// T-WRK-050 자재 사용 · F-TEC-WRK-06 (단계 9): 자재 검색 → 수량 → 고객 청구 여부. 청구하면 추가요금(자재)으로 고객 동의 요청(BR-040)
import type { ExtraChargeState } from '@aircon/domain';
import { Alert, Button, Check, ConfirmModal, Empty, Field, Input, Select, Sheet, Tag, useToast } from '@aircon/ui';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { addJobMaterial, removeJobMaterial } from '@/app/(tech)/tech/(flow)/actions';
import { formatWon } from '@/customer/format';
import type { getMaterialScreen } from '@/server/materials';

type Screen = Awaited<ReturnType<typeof getMaterialScreen>>;
type Code = { value: string; label: string };

const CHARGE: Partial<Record<ExtraChargeState, { label: string; tone?: 'success' | 'warning' | 'danger' }>> = {
  WAIT_CUSTOMER: { label: '고객 동의 대기', tone: 'warning' },
  AGREED: { label: '고객 동의', tone: 'success' },
  DECLINED: { label: '고객 거절(청구 안 함)', tone: 'danger' },
  WITHDRAWN: { label: '철회' },
};

function AddSheet({ s, unitLabel, onClose }: { s: Screen; unitLabel: (v: string) => string; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [materialId, setMaterialId] = useState('');
  const [qty, setQty] = useState('1');
  const [charge, setCharge] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const list = useMemo(() => s.materials.filter((m) => !q || m.name.includes(q) || m.code.toLowerCase().includes(q.toLowerCase())), [s.materials, q]);
  const picked = s.materials.find((m) => String(m.id) === materialId);
  const saleTotal = picked && charge ? picked.salePrice * (Number(qty) || 0) : 0;
  return (
    <Sheet title="자재 사용 등록" onClose={onClose} overlayClassName="tec-sheet-overlay">
      {message ? <Alert tone="danger">{message}</Alert> : null}
      <Field label="자재 검색">{(id) => <Input id={id} value={q} placeholder="이름 또는 코드" onChange={(e) => setQ(e.target.value)} />}</Field>
      <Field label="자재" required error={errors.materialId}>
        {(id) => (
          <Select id={id} value={materialId} onChange={(e) => setMaterialId(e.target.value)} aria-invalid={Boolean(errors.materialId)}>
            <option value="">선택</option>
            {list.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({unitLabel(m.unit)}){m.salePrice ? ` · ${formatWon(m.salePrice)}` : ''}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="수량" required error={errors.quantity}>
        {(id) => <Input id={id} inputMode="numeric" className="ac-num" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} aria-invalid={Boolean(errors.quantity)} />}
      </Field>
      <Check label="고객에게 청구 (고객 동의 후 청구)" checked={charge} disabled={!picked?.salePrice} onChange={(e) => setCharge(e.target.checked)} />
      {errors.chargeToCustomer ? <Alert tone="danger">{errors.chargeToCustomer}</Alert> : null}
      {charge && picked ? (
        <p className="ac-body">
          청구 금액 <strong className="ac-num">{formatWon(saleTotal)}</strong>
        </p>
      ) : null}
      <Button
        variant="primary"
        size="lg"
        block
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await addJobMaterial({ orderNo: s.orderNo, materialId, quantity: qty, chargeToCustomer: charge });
            if (!r.ok) {
              setErrors(r.fieldErrors ?? {});
              return setMessage(r.message ?? null);
            }
            toast(charge ? '자재를 등록하고 고객에게 동의를 요청했습니다.' : '자재를 등록했습니다.');
            onClose();
            router.refresh();
          })
        }
      >
        등록
      </Button>
    </Sheet>
  );
}

export function MaterialBoard({ s, units }: { s: Screen; units: Code[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const unitLabel = (v: string) => units.find((u) => u.value === v)?.label ?? v;
  return (
    <>
      {message ? <Alert tone="danger">{message}</Alert> : null}
      <p className="ac-body-sm">작업에 쓴 자재를 남겨 주세요. 고객에게 청구하는 자재는 고객이 동의한 경우에만 청구됩니다.</p>
      {s.editable ? (
        <Button variant="outline" size="lg" block onClick={() => setAdding(true)}>
          <Plus aria-hidden /> 자재 사용 등록
        </Button>
      ) : null}
      {s.usages.length ? (
        <ul className="ac-list" aria-label="자재 사용 목록">
          {s.usages.map((u) => {
            const st = u.chargeState ? CHARGE[u.chargeState] : null;
            return (
              <li key={u.id} className="ac-list-item">
                <div className="ac-list-item__body">
                  <p className="ac-body">
                    {u.name} <span className="ac-num">× {u.quantity}</span> {unitLabel(u.unit)}
                  </p>
                  <p className="ac-caption">
                    {u.chargeToCustomer ? (
                      <>
                        고객 청구 <span className="ac-num">{formatWon(u.saleAmount)}</span> {st ? <Tag tone={st.tone}>{st.label}</Tag> : null}
                      </>
                    ) : (
                      '청구 안 함'
                    )}
                  </p>
                </div>
                {s.editable && u.chargeState !== 'AGREED' && u.chargeState !== 'DECLINED' ? (
                  <Button variant="text" onClick={() => setRemoving(u.id)}>
                    삭제
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty>등록한 자재가 없습니다.</Empty>
      )}
      <Link href={`/tech/jobs/${s.orderNo}/work/complete`} className="ac-btn ac-btn--primary ac-btn--lg ac-btn--block">
        다음: 처리 저장
      </Link>
      {adding ? <AddSheet s={s} unitLabel={unitLabel} onClose={() => setAdding(false)} /> : null}
      <ConfirmModal
        open={removing !== null}
        message="자재 사용을 삭제하시겠습니까?"
        description="고객 동의를 기다리는 청구는 함께 철회됩니다."
        confirmLabel="삭제"
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          const id = removing;
          setRemoving(null);
          if (!id) return;
          const r = await removeJobMaterial({ orderNo: s.orderNo, usageId: id });
          if (!r.ok) setMessage(r.message ?? '삭제하지 못했습니다.');
          router.refresh();
        }}
      />
    </>
  );
}
