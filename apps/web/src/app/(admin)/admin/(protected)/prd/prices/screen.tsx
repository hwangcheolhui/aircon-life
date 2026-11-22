'use client';
import type { pricePolicy } from '@aircon/db';
import { Alert, Button, Card, Field, Input, Select } from '@aircon/ui';
import { useState } from 'react';
import { CrudScreen, type Option, labelOf, won } from '@/admin/crud-screen';
import { deletePrice, previewPrice, savePrice } from './actions';

type Row = typeof pricePolicy.$inferSelect;
type Preview = { policyId: number; unitPrice: number; tiers: { min: number; rate: number }[] } | null;

const tiersText = (t: { min: number; rate: number }[] | null) => (t?.length ? t.map((x) => `${x.min}대↑ ${x.rate}%`).join(', ') : '');

export function PricesScreen(p: {
  rows: Row[];
  products: Option[];
  branches: Option[];
  codes: Record<string, Option[]>;
  today: string;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const ctype = p.codes.CUSTOMER_TYPE;
  return (
    <>
      <CrudScreen<Row>
        title="가격 정책"
        noun="가격 정책"
        rows={p.rows}
        rowKey={(r) => r.id}
        canCreate={p.canCreate}
        canUpdate={p.canUpdate}
        canDelete={p.canDelete}
        filters={[
          { name: 'product', label: '상품', options: p.products, match: (r, v) => String(r.productId) === v },
          { name: 'branch', label: '거점', options: p.branches, match: (r, v) => String(r.branchId) === v },
        ]}
        columns={[
          { header: '상품', cell: (r) => labelOf(p.products, String(r.productId)) },
          { header: '거점', cell: (r) => (r.branchId ? labelOf(p.branches, String(r.branchId)) : '전 거점 공통') },
          { header: '고객 유형', cell: (r) => (r.customerType ? labelOf(ctype, r.customerType) : '공통') },
          { header: '단가', num: true, cell: (r) => won(r.unitPrice) },
          { header: '대수 할인', cell: (r) => tiersText(r.multiUnitDiscountJson) },
          { header: '적용 기간', cell: (r) => <span className="ac-num">{`${r.validFrom} ~ ${r.validTo ?? ''}`}</span> },
          { header: '우선순위', num: true, cell: (r) => r.priority },
        ]}
        defaults={{ validFrom: p.today, priority: '0', multiUnitDiscountJson: '[{"min":2,"rate":5},{"min":3,"rate":10}]' }}
        toForm={(r) => ({
          ...r,
          productId: String(r.productId),
          branchId: r.branchId ? String(r.branchId) : '',
          customerType: r.customerType ?? '',
          multiUnitDiscountJson: r.multiUnitDiscountJson ? JSON.stringify(r.multiUnitDiscountJson) : '',
        })}
        fields={[
          { name: 'productId', label: '상품', type: 'select', required: true, options: p.products, emptyOption: '선택', span2: true },
          { name: 'branchId', label: '거점', type: 'select', options: p.branches, emptyOption: '전 거점 공통' },
          { name: 'customerType', label: '고객 유형', type: 'select', options: ctype, emptyOption: '공통' },
          { name: 'unitPrice', label: '1대 단가(원, 부가세 포함)', type: 'number', required: true },
          { name: 'priority', label: '우선순위', type: 'number', required: true, help: '같은 조건이면 큰 값이 적용됩니다.' },
          { name: 'validFrom', label: '적용 시작일', type: 'date', required: true },
          { name: 'validTo', label: '적용 종료일', type: 'date' },
          { name: 'multiUnitDiscountJson', label: '대수 할인(JSON)', type: 'json', help: '예: [{"min":2,"rate":5},{"min":3,"rate":10}] (2대 이상 5%)' },
        ]}
        save={savePrice}
        remove={deletePrice}
      />
      <PricePreview products={p.products} branches={p.branches} ctype={ctype ?? []} today={p.today} />
    </>
  );
}

function PricePreview({ products, branches, ctype, today }: { products: Option[]; branches: Option[]; ctype: Option[]; today: string }) {
  const [result, setResult] = useState<{ preview: Preview; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Card className="adm-section">
      <h2 className="ac-h3">적용 예정 가격 미리보기</h2>
      <form
        className="adm-form-grid"
        style={{ marginTop: 'var(--space-4)' }}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const values = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
          const res = await previewPrice(values);
          setBusy(false);
          setResult(
            res.ok
              ? { preview: res.data as Preview }
              : { preview: null, error: res.message ?? Object.values(res.fieldErrors ?? {})[0] },
          );
        }}
      >
        <Field label="상품" required>
          {(id) => (
            <Select id={id} name="productId" defaultValue="">
              <option value="">선택</option>
              {products.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="거점">
          {(id) => (
            <Select id={id} name="branchId" defaultValue="">
              <option value="">지정 안 함</option>
              {branches.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="고객 유형">
          {(id) => (
            <Select id={id} name="customerType" defaultValue="">
              <option value="">지정 안 함</option>
              {ctype.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="적용일" required>
          {(id) => <Input id={id} name="date" type="date" defaultValue={today} />}
        </Field>
        <div className="adm-span-2 ac-row" style={{ justifyContent: 'flex-end' }}>
          <Button type="submit" variant="secondary" size="sm" loading={busy}>
            미리보기
          </Button>
        </div>
      </form>
      {result ? (
        result.error ? (
          <Alert tone="danger">{result.error}</Alert>
        ) : result.preview ? (
          <Alert tone="success">
            적용 단가 <strong className="ac-num">{won(result.preview.unitPrice)}</strong> (정책 #{result.preview.policyId})
            {result.preview.tiers.length ? ` · 대수 할인 ${tiersText(result.preview.tiers)}` : ''}
          </Alert>
        ) : (
          <Alert tone="warning">이 조건에 적용되는 가격 정책이 없습니다.</Alert>
        )
      ) : null}
    </Card>
  );
}
