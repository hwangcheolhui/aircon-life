'use client';
// C-DEV-020 기기 등록·수정 (F-CUS-DEV-01): 주소·형태·제조사·모델·위치·설치연도
import { Alert, Button, Card, Check, ConfirmModal, Field, Input, MSG, Select, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { removeDevice, saveDevice } from '../actions';

type Option = { value: string; label: string };
export interface DeviceValues {
  id: number | null;
  addressId: number | null;
  deviceType: string;
  brand: string;
  modelName: string;
  installYear: string;
  locationInHouse: string;
  isInverter: boolean;
  hasHeating: boolean;
}

export function DeviceForm({ initial, addresses, deviceTypes, brands }: { initial: DeviceValues; addresses: Option[]; deviceTypes: Option[]; brands: Option[] }) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'save' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof DeviceValues>(k: K, val: DeviceValues[K]) => setV((x) => ({ ...x, [k]: val }));
  const save = async () => {
    setConfirm(null);
    setBusy(true);
    const r = await saveDevice({ ...v, installYear: v.installYear || null });
    setBusy(false);
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      return setError(r.message ?? null);
    }
    toast(MSG.saved);
    router.push('/my/devices');
    router.refresh();
  };
  const remove = async () => {
    setConfirm(null);
    if (!v.id) return;
    const r = await removeDevice(v.id);
    if (!r.ok) return setError(r.message ?? null);
    router.push('/my/devices');
    router.refresh();
  };
  return (
    <Card>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="설치 주소" required error={errors.addressId}>
        {(id) => (
          <Select id={id} value={v.addressId ?? ''} onChange={(e) => set('addressId', e.target.value ? Number(e.target.value) : null)} aria-invalid={Boolean(errors.addressId)}>
            <option value="">선택</option>
            {addresses.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="기기 형태" required error={errors.deviceType}>
        {(id) => (
          <Select id={id} value={v.deviceType} onChange={(e) => set('deviceType', e.target.value)} aria-invalid={Boolean(errors.deviceType)}>
            <option value="">선택</option>
            {deviceTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="제조사" error={errors.brand}>
        {(id) => (
          <Select id={id} value={v.brand} onChange={(e) => set('brand', e.target.value)}>
            <option value="">모름</option>
            {brands.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="모델명">{(id) => <Input id={id} maxLength={50} value={v.modelName} onChange={(e) => set('modelName', e.target.value)} />}</Field>
      <Field label="설치 위치" help="예: 거실, 안방">
        {(id, d) => <Input id={id} aria-describedby={d} maxLength={30} value={v.locationInHouse} onChange={(e) => set('locationInHouse', e.target.value)} />}
      </Field>
      <Field label="설치 연도" error={errors.installYear}>
        {(id) => <Input id={id} inputMode="numeric" maxLength={4} className="ac-num" value={v.installYear} onChange={(e) => set('installYear', e.target.value.replace(/\D/g, ''))} aria-invalid={Boolean(errors.installYear)} />}
      </Field>
      <Check label="인버터" checked={v.isInverter} onChange={(e) => set('isInverter', e.target.checked)} />
      <Check label="냉난방 겸용" checked={v.hasHeating} onChange={(e) => set('hasHeating', e.target.checked)} />
      <Button variant="primary" size="lg" block loading={busy} onClick={() => setConfirm('save')}>
        저장
      </Button>
      {v.id ? (
        <Button variant="ghost" block onClick={() => setConfirm('delete')}>
          기기 삭제
        </Button>
      ) : null}
      <ConfirmModal open={confirm === 'save'} message="저장하시겠습니까?" confirmLabel="저장" onConfirm={save} onCancel={() => setConfirm(null)} />
      <ConfirmModal open={confirm === 'delete'} message="기기를 삭제하시겠습니까?" confirmLabel="삭제" danger onConfirm={remove} onCancel={() => setConfirm(null)} />
    </Card>
  );
}
