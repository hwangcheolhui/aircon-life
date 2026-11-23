'use client';
// A-ORD-040 수동 주문 등록 화면
import type { AddressResult } from '@aircon/integrations/address';
import { Alert, Button, Check, ConfirmModal, Field, Input, MSG, Modal, Select, Textarea, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf, won } from '@/admin/crud-screen';
import { AddressSearchModal } from '@/shared/address-search';
import { type ManualPreview, lookupCustomer, previewManual, submitManual } from './actions';

interface Choices {
  products: { id: number; deviceType: string; cleanLevel: string; name: string }[];
  options: { id: number; productId: number | null; name: string; price: number }[];
}
type Line = { deviceType: string; cleanLevel: string; quantity: string };

export function ManualOrderScreen({ choices, codes, readOnly }: { choices: Choices; codes: Record<string, Option[]>; readOnly: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const devices = [...new Set(choices.products.map((p) => p.deviceType))];
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [found, setFound] = useState<{ id: number; nameMasked: string } | null | undefined>(undefined);
  const [address, setAddress] = useState<AddressResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [visit, setVisit] = useState({ detailAddress: '', housingType: '', hasElevator: false, parkingNote: '' });
  const [lines, setLines] = useState<Line[]>([{ deviceType: devices[0] ?? '', cleanLevel: '', quantity: '1' }]);
  const [opts, setOpts] = useState<Record<string, string>>({});
  const [customerType, setCustomerType] = useState<'PERSONAL' | 'BUSINESS'>('PERSONAL');
  const [preview, setPreview] = useState<ManualPreview | null>(null);
  const [slot, setSlot] = useState({ date: '', hour: '' });
  const [meta, setMeta] = useState({ orderType: 'NORMAL', channel: 'PHONE', customerRequest: '', internalNote: '' });
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const [duplicates, setDuplicates] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const levelsOf = (dt: string) => choices.products.filter((p) => p.deviceType === dt).map((p) => p.cleanLevel);
  const quoteInput = () => ({
    legalDongCode: address?.legalDongCode ?? '',
    lines: lines.map((l) => ({ ...l, cleanLevel: l.cleanLevel || levelsOf(l.deviceType)[0] || '' })),
    options: Object.entries(opts)
      .filter(([, q]) => Number(q) > 0)
      .map(([optionId, quantity]) => ({ optionId, quantity })),
  });

  const calc = async () => {
    setError(null);
    if (!address) return setError(MSG.required('방문 주소'));
    const r = await previewManual(quoteInput(), customerType);
    if (!r.ok) return setError(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '견적을 산출하지 못했습니다.');
    setPreview(r.data as ManualPreview);
    setSlot({ date: '', hour: '' });
  };

  const send = async (duplicateConfirmed: boolean) => {
    setConfirm(false);
    setBusy(true);
    setError(null);
    const q = quoteInput();
    const r = await submitManual({
      customerId: found?.id ?? '',
      name: found ? '' : name,
      phone: found ? '' : phone,
      address: { zipcode: address?.zipcode, roadAddress: address?.roadAddress, jibunAddress: address?.jibunAddress, legalDongCode: address?.legalDongCode },
      ...visit,
      lines: q.lines,
      options: q.options,
      customerType,
      slotDate: slot.date,
      slotHour: slot.hour,
      ...meta,
      duplicateConfirmed,
    });
    setBusy(false);
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      return setError(r.message ?? (r.fieldErrors ? '입력값을 확인하세요.' : '등록하지 못했습니다.'));
    }
    const d = r.data as { ok: true; id: number } | { ok: false; duplicates: string[] };
    if (!d.ok) return setDuplicates(d.duplicates);
    toast(MSG.saved);
    router.push(`/admin/ord/orders/${d.id}`);
  };

  const day = preview?.days.find((x) => x.date === slot.date);
  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">수동 주문 등록</h1>
      </div>
      {readOnly ? <Alert tone="warning">임시 개발 모드에서는 조회만 할 수 있습니다. 저장하려면 로그인해 주세요.</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <fieldset disabled={readOnly || busy} style={{ border: 0, padding: 0, margin: 0 }}>
        <section className="ac-card adm-section" style={{ marginTop: 0 }}>
          <h2 className="ac-h3">고객</h2>
          <div className="adm-form-grid">
            <Field label="연락처" required error={errors.phone}>
              {(id) => (
                <div className="ac-row" style={{ flexWrap: 'nowrap' }}>
                  <Input id={id} inputMode="tel" value={phone} onChange={(e) => (setPhone(e.target.value), setFound(undefined))} />
                  <Button
                    onClick={async () => {
                      const r = await lookupCustomer(phone);
                      if (!r.ok) return setError(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? null);
                      setFound((r.data as { id: number; nameMasked: string } | null) ?? null);
                    }}
                  >
                    고객 검색
                  </Button>
                </div>
              )}
            </Field>
            {found ? (
              <p className="ac-body-sm">
                기존 고객 <span className="ac-masked">{found.nameMasked}</span> 으로 접수합니다.
              </p>
            ) : (
              <Field label="이름" required={found === null} error={errors.name} help={found === null ? '신규 고객으로 등록합니다.' : '먼저 연락처로 고객을 검색하세요.'}>
                {(id, d) => <Input id={id} aria-describedby={d} value={name} onChange={(e) => setName(e.target.value)} disabled={found === undefined} />}
              </Field>
            )}
            <Field label="고객 유형">
              {(id) => (
                <Select id={id} value={customerType} onChange={(e) => (setCustomerType(e.target.value as 'PERSONAL' | 'BUSINESS'), setPreview(null))}>
                  {codes.CUSTOMER_TYPE?.filter((c) => c.value === 'PERSONAL' || c.value === 'BUSINESS').map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </section>

        <section className="ac-card adm-section">
          <h2 className="ac-h3">방문지</h2>
          <div className="adm-form-grid">
            <div className="adm-span-2">
              <Field label="방문 주소" required>
                {(id) => (
                  <div className="ac-row" style={{ flexWrap: 'nowrap' }}>
                    <Input id={id} readOnly value={address?.roadAddress ?? ''} />
                    <Button onClick={() => setSearching(true)}>주소 검색</Button>
                  </div>
                )}
              </Field>
            </div>
            <Field label="상세주소" required error={errors.detailAddress}>
              {(id) => <Input id={id} value={visit.detailAddress} maxLength={200} onChange={(e) => setVisit({ ...visit, detailAddress: e.target.value })} />}
            </Field>
            <Field label="주거 유형" required error={errors.housingType}>
              {(id) => (
                <Select id={id} value={visit.housingType} onChange={(e) => setVisit({ ...visit, housingType: e.target.value })}>
                  <option value="">선택</option>
                  {codes.HOUSING_TYPE?.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Check label="엘리베이터 있음" checked={visit.hasElevator} onChange={(e) => setVisit({ ...visit, hasElevator: e.target.checked })} />
            <Field label="주차 안내">{(id) => <Input id={id} value={visit.parkingNote} maxLength={200} onChange={(e) => setVisit({ ...visit, parkingNote: e.target.value })} />}</Field>
          </div>
        </section>

        <section className="ac-card adm-section">
          <h2 className="ac-h3">항목·견적</h2>
          {lines.map((l, i) => (
            <div key={i} className="adm-form-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', marginBottom: 'var(--space-2)' }}>
              <Field label="기기 형태">
                {(id) => (
                  <Select id={id} value={l.deviceType} onChange={(e) => (setLines(lines.map((x, j) => (j === i ? { ...x, deviceType: e.target.value, cleanLevel: '' } : x))), setPreview(null))}>
                    {devices.map((d) => (
                      <option key={d} value={d}>
                        {labelOf(codes.DEVICE_TYPE, d)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="작업 범위">
                {(id) => (
                  <Select id={id} value={l.cleanLevel || levelsOf(l.deviceType)[0] || ''} onChange={(e) => (setLines(lines.map((x, j) => (j === i ? { ...x, cleanLevel: e.target.value } : x))), setPreview(null))}>
                    {levelsOf(l.deviceType).map((c) => (
                      <option key={c} value={c}>
                        {labelOf(codes.CLEAN_LEVEL, c)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="대수">
                {(id) => <Input id={id} inputMode="numeric" value={l.quantity} onChange={(e) => (setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x))), setPreview(null))} />}
              </Field>
              <div style={{ alignSelf: 'end' }}>
                {lines.length > 1 ? (
                  <Button variant="ghost" size="sm" onClick={() => (setLines(lines.filter((_, j) => j !== i)), setPreview(null))}>
                    삭제
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setLines([...lines, { deviceType: devices[0] ?? '', cleanLevel: '', quantity: '1' }])}>
            기기 추가
          </Button>
          {choices.options.length ? (
            <div className="adm-form-grid" style={{ marginTop: 'var(--space-3)' }}>
              {choices.options.map((o) => (
                <Field key={o.id} label={`${o.name} (${won(o.price)}) 수량`}>
                  {(id) => <Input id={id} inputMode="numeric" value={opts[o.id] ?? ''} onChange={(e) => (setOpts({ ...opts, [o.id]: e.target.value }), setPreview(null))} />}
                </Field>
              ))}
            </div>
          ) : null}
          <div className="adm-toolbar">
            <span className="ac-body-sm">
              {preview ? (
                <>
                  표준 견적 <strong className="ac-num">{won(preview.totalAmount)}</strong> · 예상 <span className="ac-num">{preview.durationMin}</span>분 (야간·휴일 할증은 일정에 따라 붙습니다)
                </>
              ) : (
                '주소와 항목을 넣고 견적을 계산하세요.'
              )}
            </span>
            <Button size="sm" onClick={calc}>
              견적 계산·일정 조회
            </Button>
          </div>
        </section>

        <section className="ac-card adm-section">
          <h2 className="ac-h3">일정·접수 정보</h2>
          <div className="adm-form-grid">
            <Field label="방문일" required error={errors.slotDate}>
              {(id) => (
                <Select id={id} value={slot.date} disabled={!preview} onChange={(e) => setSlot({ date: e.target.value, hour: '' })}>
                  <option value="">선택</option>
                  {preview?.days.map((d) => (
                    <option key={d.date} value={d.date} disabled={!d.hours.length}>
                      {d.date}
                      {d.hours.length ? '' : ' (마감)'}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="시작 시각" required error={errors.slotHour}>
              {(id) => (
                <Select id={id} value={slot.hour} disabled={!day} onChange={(e) => setSlot({ ...slot, hour: e.target.value })}>
                  <option value="">선택</option>
                  {day?.hours.map((h) => (
                    <option key={h.hour} value={String(h.hour)}>
                      {h.label}
                      {h.surcharge ? ` (${h.surcharge})` : ''}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="접수 유형" required>
              {(id) => (
                <Select id={id} value={meta.orderType} onChange={(e) => setMeta({ ...meta, orderType: e.target.value })}>
                  {codes.ORDER_TYPE?.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="접수 채널" required>
              {(id) => (
                <Select id={id} value={meta.channel} onChange={(e) => setMeta({ ...meta, channel: e.target.value })}>
                  {codes.ORDER_CHANNEL?.filter((c) => c.value !== 'APP').map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="adm-span-2">
              <Field label="요청사항">{(id) => <Textarea id={id} rows={2} maxLength={500} value={meta.customerRequest} onChange={(e) => setMeta({ ...meta, customerRequest: e.target.value })} />}</Field>
            </div>
            <div className="adm-span-2">
              <Field label="내부 메모">{(id) => <Textarea id={id} rows={2} maxLength={1000} value={meta.internalNote} onChange={(e) => setMeta({ ...meta, internalNote: e.target.value })} />}</Field>
            </div>
          </div>
        </section>
        <div className="adm-toolbar">
          <span />
          <Button
            variant="primary"
            loading={busy}
            disabled={!preview || !slot.date || slot.hour === ''}
            onClick={() => {
              const miss: Record<string, string> = {};
              if (found === undefined) miss.phone = '연락처로 고객을 먼저 검색하세요.';
              if (found === null && !name.trim()) miss.name = MSG.required('이름');
              if (!visit.detailAddress.trim()) miss.detailAddress = MSG.required('상세주소');
              if (!visit.housingType) miss.housingType = MSG.required('주거 유형');
              setErrors(miss);
              if (Object.keys(miss).length === 0) setConfirm(true);
            }}
          >
            주문 등록
          </Button>
        </div>
      </fieldset>
      <AddressSearchModal
        prefix="adm"
        open={searching}
        onClose={() => setSearching(false)}
        onSelect={(a) => {
          setAddress(a);
          setSearching(false);
          setPreview(null);
        }}
      />
      <ConfirmModal open={confirm} onConfirm={() => send(false)} onCancel={() => setConfirm(false)} />
      <Modal
        open={duplicates !== null}
        title="중복 접수 확인"
        description={`같은 연락처나 주소로 진행 중인 주문이 있습니다: ${(duplicates ?? []).join(', ')}`}
        onClose={() => setDuplicates(null)}
        actions={
          <>
            <Button onClick={() => setDuplicates(null)}>취소</Button>
            <Button
              variant="primary"
              onClick={() => {
                setDuplicates(null);
                send(true);
              }}
            >
              그래도 등록
            </Button>
          </>
        }
      />
    </div>
  );
}
