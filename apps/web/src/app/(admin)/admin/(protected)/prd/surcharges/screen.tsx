'use client';
import type { surchargeRule } from '@aircon/db';
import { Tag } from '@aircon/ui';
import { CrudScreen, type Option, labelOf, won } from '@/admin/crud-screen';
import { deleteSurcharge, saveSurcharge } from './actions';

type Row = typeof surchargeRule.$inferSelect;

export function SurchargesScreen(p: { rows: Row[]; codes: Record<string, Option[]>; canCreate: boolean; canUpdate: boolean; canDelete: boolean }) {
  const { SURCHARGE_RULE: rules, SURCHARGE_APPLY_TYPE: apply, AMOUNT_TYPE: amountType } = p.codes;
  return (
    <CrudScreen<Row>
      title="할증·추가요금 규칙"
      noun="규칙"
      rows={p.rows}
      rowKey={(r) => r.id}
      canCreate={p.canCreate}
      canUpdate={p.canUpdate}
      canDelete={p.canDelete}
      filters={[{ name: 'apply', label: '적용 시점', options: apply, match: (r, v) => r.applyType === v }]}
      columns={[
        { header: '규칙 코드', cell: (r) => <span className="ac-num">{r.ruleCode}</span> },
        { header: '표시명', cell: (r) => r.name },
        { header: '적용 시점', cell: (r) => labelOf(apply, r.applyType) },
        { header: '금액', num: true, cell: (r) => (r.amountType === 'RATE' ? `${r.amount}%` : won(r.amount)) },
        { header: '대당', cell: (r) => (r.perUnit ? '대당' : '건당') },
        { header: '조건', cell: (r) => <code className="ac-caption">{r.conditionJson ? JSON.stringify(r.conditionJson) : ''}</code> },
        { header: '사용', cell: (r) => (r.isActive ? <Tag tone="success">사용</Tag> : <Tag>중지</Tag>) },
      ]}
      defaults={{ isActive: true, amountType: 'FIXED', applyType: 'AUTO_QUOTE', perUnit: false }}
      toForm={(r) => ({ ...r, conditionJson: r.conditionJson ? JSON.stringify(r.conditionJson) : '' })}
      fields={[
        { name: 'ruleCode', label: '규칙 코드', type: 'select', required: true, options: rules, emptyOption: '선택', lockOnEdit: true },
        { name: 'name', label: '표시명', required: true },
        { name: 'applyType', label: '적용 시점', type: 'select', required: true, options: apply },
        { name: 'amountType', label: '금액 유형', type: 'select', required: true, options: amountType },
        { name: 'amount', label: '금액(원 또는 %)', type: 'number', required: true },
        { name: 'perUnit', label: '대당 적용', type: 'checkbox' },
        {
          name: 'conditionJson',
          label: '조건(JSON)',
          type: 'json',
          help: '예: 야간 {"weekday":true,"after":"18:00"} · 휴일 {"weekend":true,"holiday":true}',
        },
        { name: 'customerNotice', label: '고객 안내 문구', type: 'textarea' },
        { name: 'isActive', label: '사용', type: 'checkbox' },
      ]}
      save={saveSurcharge}
      remove={deleteSurcharge}
    />
  );
}
