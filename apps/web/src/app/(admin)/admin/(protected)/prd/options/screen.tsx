'use client';
import type { material, serviceOption } from '@aircon/db';
import { Tabs, Tag } from '@aircon/ui';
import { useState } from 'react';
import { CrudScreen, type Option, labelOf, won } from '@/admin/crud-screen';
import { deleteMaterial, deleteOption, saveMaterial, saveOption } from './actions';

type OptionRow = typeof serviceOption.$inferSelect;
type MaterialRow = typeof material.$inferSelect;
type Flags = { canCreate: boolean; canUpdate: boolean; canDelete: boolean };

export function OptionsScreen(p: { options: OptionRow[]; materials: MaterialRow[]; products: Option[]; codes: Record<string, Option[]> } & Flags) {
  const [tab, setTab] = useState<'option' | 'material'>('option');
  const flags = { canCreate: p.canCreate, canUpdate: p.canUpdate, canDelete: p.canDelete };
  const active = (v: boolean) => (v ? <Tag tone="success">사용</Tag> : <Tag>중지</Tag>);
  const tabs = (
    <Tabs
      value={tab}
      onChange={setTab}
      items={[
        { value: 'option', label: '부가 옵션' },
        { value: 'material', label: '자재·소모품' },
      ]}
    />
  );
  if (tab === 'option') {
    return (
      <CrudScreen<OptionRow>
        title="옵션·자재 마스터"
        headerExtra={tabs}
        noun="옵션"
        rows={p.options}
        rowKey={(r) => r.id}
        {...flags}
        filters={[{ name: 'q', label: '옵션 코드·명', match: (r, v) => `${r.optionCode} ${r.name}`.includes(v) }]}
        columns={[
          { header: '옵션 코드', cell: (r) => <span className="ac-num">{r.optionCode}</span> },
          { header: '옵션명', cell: (r) => r.name },
          { header: '대상 상품', cell: (r) => (r.productId ? labelOf(p.products, String(r.productId)) : '전체 공통') },
          { header: '가격', num: true, cell: (r) => won(r.price) },
          { header: '추가 시간(분)', num: true, cell: (r) => r.durationMin },
          { header: '사용', cell: (r) => active(r.isActive) },
        ]}
        defaults={{ isActive: true, durationMin: '0' }}
        toForm={(r) => ({ ...r, productId: r.productId ? String(r.productId) : '' })}
        fields={[
          { name: 'optionCode', label: '옵션 코드', required: true, lockOnEdit: true },
          { name: 'name', label: '옵션명', required: true },
          { name: 'productId', label: '대상 상품', type: 'select', options: p.products, emptyOption: '전체 공통' },
          { name: 'price', label: '가격(원)', type: 'number', required: true },
          { name: 'durationMin', label: '추가 소요 시간(분)', type: 'number', required: true },
          { name: 'isActive', label: '사용', type: 'checkbox' },
        ]}
        save={saveOption}
        remove={deleteOption}
      />
    );
  }
  const unit = p.codes.MATERIAL_UNIT;
  return (
    <CrudScreen<MaterialRow>
      title="옵션·자재 마스터"
      headerExtra={tabs}
      noun="자재"
      rows={p.materials}
      rowKey={(r) => r.id}
      {...flags}
      filters={[{ name: 'q', label: '자재 코드·명', match: (r, v) => `${r.materialCode} ${r.name}`.includes(v) }]}
      columns={[
        { header: '자재 코드', cell: (r) => <span className="ac-num">{r.materialCode}</span> },
        { header: '자재명', cell: (r) => r.name },
        { header: '단위', cell: (r) => labelOf(unit, r.unit) },
        { header: '원가', num: true, cell: (r) => won(r.unitCost) },
        { header: '판매가', num: true, cell: (r) => won(r.salePrice) },
        { header: '안전 재고', num: true, cell: (r) => r.safetyStock },
        { header: '사용', cell: (r) => active(r.isActive) },
      ]}
      defaults={{ isActive: true, unit: 'EA', unitCost: '0', salePrice: '0', safetyStock: '0' }}
      toForm={(r) => ({ ...r })}
      fields={[
        { name: 'materialCode', label: '자재 코드', required: true, lockOnEdit: true },
        { name: 'name', label: '자재명', required: true },
        { name: 'unit', label: '단위', type: 'select', required: true, options: unit },
        { name: 'unitCost', label: '원가(원)', type: 'number', required: true },
        { name: 'salePrice', label: '판매가(원)', type: 'number', required: true },
        { name: 'safetyStock', label: '안전 재고', type: 'number', required: true },
        { name: 'isActive', label: '사용', type: 'checkbox' },
      ]}
      save={saveMaterial}
      remove={deleteMaterial}
    />
  );
}
