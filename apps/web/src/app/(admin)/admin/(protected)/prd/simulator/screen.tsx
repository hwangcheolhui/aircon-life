'use client';
// A-PRD-050 견적 시뮬레이터 · F-ADM-PRD-05
import type { QuoteSnapshot } from '@aircon/domain';
import { Alert, Button, Empty, Field, Input, Select } from '@aircon/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { type Option, labelOf, won } from '@/admin/crud-screen';
import { simulateQuote } from './actions';

interface Line {
  deviceType: string;
  cleanLevel: string;
  quantity: string;
}
interface Result {
  subtotalAmount: number;
  discountAmount: number;
  surchargeAmount: number;
  totalAmount: number;
  estimatedDurationMin: number;
  needsSiteSurvey: boolean;
  snapshot: QuoteSnapshot;
}

export function SimulatorScreen(p: {
  demoNotice?: string | null;
  areas: Option[];
  products: { deviceType: string; cleanLevel: string }[];
  options: { id: number; name: string; price: number }[];
  codes: Record<string, Option[]>;
}) {
  const {
    DEVICE_TYPE: devices = [],
    CLEAN_LEVEL: levels = [],
    CUSTOMER_TYPE: customerTypes = [],
    QUOTE_ITEM_TYPE: itemTypes = [],
  } = p.codes;
  const usedDevices = devices.filter((d) => p.products.some((x) => x.deviceType === d.value));
  const levelsOf = (d: string) =>
    levels.filter((l) => p.products.some((x) => x.deviceType === d && x.cleanLevel === l.value));
  const newLine = (): Line => {
    const d = usedDevices[0]?.value ?? '';
    return { deviceType: d, cleanLevel: levelsOf(d)[0]?.value ?? '', quantity: '1' };
  };
  const initial = () => ({
    legalDongCode: p.areas[0]?.value ?? '',
    customerType: 'PERSONAL',
    visitDate: '',
    visitTime: '',
    lines: [newLine()],
    options: {} as Record<string, string>,
  });
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const setLine = (idx: number, patch: Partial<Line>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) }));

  const run = async () => {
    setLoading(true);
    setErrors({});
    setFailure(null);
    const r = await simulateQuote({
      legalDongCode: form.legalDongCode,
      customerType: form.customerType,
      visitDate: form.visitDate,
      visitTime: form.visitTime,
      lines: form.lines,
      options: Object.entries(form.options)
        .filter(([, q]) => Number(q) > 0)
        .map(([optionId, quantity]) => ({ optionId, quantity })),
    });
    setLoading(false);
    if (!r.ok) {
      setResult(null);
      if (r.fieldErrors) setErrors(r.fieldErrors);
      setFailure(
        r.message ?? (r.fieldErrors ? Object.values(r.fieldErrors)[0]! : '처리 중 오류가 발생했습니다.'),
      );
      return;
    }
    if (r.data && !r.data.ok) {
      setResult(null);
      setFailure(r.data.message);
      return;
    }
    setResult(r.data as Result);
  };

  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">견적 시뮬레이터</h1>
        <span className="ac-caption">
          고객 견적 화면과 같은 계산 모듈로 결과를 보여 줍니다. 저장하지 않습니다.
        </span>
      </div>

      {p.demoNotice ? <Alert tone="warning">{p.demoNotice}</Alert> : null}
      <form
        className="ac-search-panel"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <Field
          label="법정동 코드"
          required
          error={errors.legalDongCode}
          help="관할 지역을 고르거나 코드를 직접 입력"
        >
          {(id, describedBy, invalid) => (
            <>
              <Input
                id={id}
                list="sim-areas"
                inputMode="numeric"
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                value={form.legalDongCode}
                onChange={(e) => setForm({ ...form, legalDongCode: e.target.value })}
              />
              <datalist id="sim-areas">
                {p.areas.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label="고객 유형" required error={errors.customerType}>
          {(id) => (
            <Select
              id={id}
              value={form.customerType}
              onChange={(e) => setForm({ ...form, customerType: e.target.value })}
            >
              {customerTypes.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="희망 방문일" error={errors.visitDate} help="입력하면 야간·휴일 할증까지 계산">
          {(id, describedBy) => (
            <Input
              id={id}
              type="date"
              aria-describedby={describedBy}
              value={form.visitDate}
              onChange={(e) => setForm({ ...form, visitDate: e.target.value })}
            />
          )}
        </Field>
        <Field label="희망 방문 시각" error={errors.visitTime}>
          {(id, describedBy, invalid) => (
            <Input
              id={id}
              type="time"
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              value={form.visitTime}
              onChange={(e) => setForm({ ...form, visitTime: e.target.value })}
            />
          )}
        </Field>

        <div className="adm-span-2" style={{ gridColumn: '1 / -1' }}>
          <div className="adm-toolbar" style={{ marginTop: 0 }}>
            <strong className="ac-body-sm">기기</strong>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setForm({ ...form, lines: [...form.lines, newLine()] })}
            >
              <Plus aria-hidden size={16} />
              기기 추가
            </Button>
          </div>
          {form.lines.map((l, idx) => (
            <div key={idx} className="ac-row" style={{ flexWrap: 'nowrap', marginBottom: 'var(--space-2)' }}>
              <Select
                aria-label={`기기 형태 ${idx + 1}`}
                value={l.deviceType}
                onChange={(e) =>
                  setLine(idx, {
                    deviceType: e.target.value,
                    cleanLevel: levelsOf(e.target.value)[0]?.value ?? '',
                  })
                }
              >
                {usedDevices.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </Select>
              <Select
                aria-label={`작업 범위 ${idx + 1}`}
                value={l.cleanLevel}
                onChange={(e) => setLine(idx, { cleanLevel: e.target.value })}
              >
                {levelsOf(l.deviceType).map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
              <Input
                aria-label={`대수 ${idx + 1}`}
                type="number"
                min={1}
                max={99}
                className="is-num"
                value={l.quantity}
                onChange={(e) => setLine(idx, { quantity: e.target.value })}
              />
              <Button
                icon
                variant="ghost"
                size="sm"
                aria-label={`기기 ${idx + 1} 삭제`}
                disabled={form.lines.length === 1}
                onClick={() => setForm({ ...form, lines: form.lines.filter((_, i) => i !== idx) })}
              >
                <Trash2 aria-hidden size={16} />
              </Button>
            </div>
          ))}
          {p.options.length ? (
            <>
              <strong className="ac-body-sm">옵션 수량</strong>
              <div className="ac-row" style={{ marginTop: 'var(--space-2)' }}>
                {p.options.map((o) => (
                  <label key={o.id} className="ac-row ac-body-sm">
                    {o.name} ({won(o.price)})
                    <Input
                      type="number"
                      min={0}
                      max={99}
                      className="is-num"
                      style={{ width: 'var(--space-20)' }}
                      value={form.options[String(o.id)] ?? '0'}
                      onChange={(e) =>
                        setForm({ ...form, options: { ...form.options, [String(o.id)]: e.target.value } })
                      }
                    />
                  </label>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <div className="ac-search-panel__actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setForm(initial());
              setResult(null);
              setFailure(null);
              setErrors({});
            }}
          >
            초기화
          </Button>
          <Button type="submit" variant="primary" size="sm" loading={loading}>
            조회
          </Button>
        </div>
      </form>

      <div className="adm-section">
        {failure ? <Alert tone="warning">{failure}</Alert> : null}
        {!failure && !result ? <Empty /> : null}
        {result ? (
          <>
            {result.needsSiteSurvey ? (
              <Alert tone="warning">
                시스템·천장형 대수가 기준 이상이라 고객에게 "현장 확인 견적" 안내가 함께 표시됩니다.
              </Alert>
            ) : null}
            <div className="ac-table-wrap" style={{ marginTop: 'var(--space-3)' }}>
              <table className="ac-table">
                <thead>
                  <tr>
                    <th>구분</th>
                    <th>항목</th>
                    <th className="is-num">수량</th>
                    <th className="is-num">단가</th>
                    <th className="is-num">금액</th>
                    <th>근거</th>
                  </tr>
                </thead>
                <tbody>
                  {result.snapshot.items.map((i, idx) => (
                    <tr key={idx}>
                      <td>{labelOf(itemTypes, i.itemType)}</td>
                      <td>{i.name}</td>
                      <td className="is-num">{i.quantity}</td>
                      <td className="is-num">{won(i.unitPrice)}</td>
                      <td className="is-num">{won(i.amount)}</td>
                      <td className="ac-caption">
                        {i.pricePolicyId ? `가격 정책 #${i.pricePolicyId}` : ''}
                        {i.discountRate ? `대수 ${result.snapshot.totalUnits}대 · ${i.discountRate}%` : ''}
                        {i.ruleCode ? `규칙 ${i.ruleCode}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}>상품 합계</td>
                    <td className="is-num">{won(result.subtotalAmount)}</td>
                    <td />
                  </tr>
                  <tr>
                    <td colSpan={4}>할인</td>
                    <td className="is-num">{won(-result.discountAmount)}</td>
                    <td />
                  </tr>
                  <tr>
                    <td colSpan={4}>할증</td>
                    <td className="is-num">{won(result.surchargeAmount)}</td>
                    <td />
                  </tr>
                  <tr>
                    <th colSpan={4}>총 견적 금액</th>
                    <th className="is-num">{won(result.totalAmount)}</th>
                    <th className="ac-caption">예상 {result.estimatedDurationMin}분</th>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="ac-caption">
              단가 기준일 <span className="ac-num">{result.snapshot.priceDate}</span>
              {result.snapshot.visit
                ? ` · 방문 ${result.snapshot.visit.date} ${result.snapshot.visit.time}`
                : ' · 방문 일시 미입력(야간·휴일 할증 제외)'}
            </p>
            {result.snapshot.onSiteRules.length ? (
              <p className="ac-caption">
                현장 추가요금 안내: {result.snapshot.onSiteRules.map((r) => r.name).join(', ')}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
