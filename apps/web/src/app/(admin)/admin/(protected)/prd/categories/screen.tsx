'use client';
import type { serviceCategory } from '@aircon/db';
import { Tag } from '@aircon/ui';
import { CrudScreen, type Option, labelOf } from '@/admin/crud-screen';
import { deleteCategory, saveCategory } from './actions';

type Row = typeof serviceCategory.$inferSelect;

export function CategoriesScreen(p: { rows: Row[]; codes: Record<string, Option[]>; canCreate: boolean; canUpdate: boolean; canDelete: boolean }) {
  const phase = p.codes.SERVICE_PHASE;
  return (
    <CrudScreen<Row>
      title="카테고리 관리"
      noun="카테고리"
      rows={p.rows}
      rowKey={(r) => r.id}
      canCreate={p.canCreate}
      canUpdate={p.canUpdate}
      canDelete={p.canDelete}
      filters={[{ name: 'q', label: '코드·표시명', match: (r, v) => `${r.code} ${r.name}`.toLowerCase().includes(v.toLowerCase()) }]}
      columns={[
        { header: '정렬', num: true, cell: (r) => r.sortOrder },
        { header: '카테고리 코드', cell: (r) => <span className="ac-num">{r.code}</span> },
        { header: '표시명', cell: (r) => r.name },
        { header: '오픈 단계', cell: (r) => labelOf(phase, r.phase == null ? null : String(r.phase)) },
        { header: '노출', cell: (r) => (r.isActive ? <Tag tone="success">노출</Tag> : <Tag>숨김</Tag>) },
      ]}
      defaults={{ isActive: true, sortOrder: '0', phase: '1' }}
      toForm={(r) => ({ ...r, phase: r.phase == null ? '' : String(r.phase) })}
      fields={[
        { name: 'code', label: '카테고리 코드', required: true, lockOnEdit: true, help: '예: AIRCON_CLEAN' },
        { name: 'name', label: '표시명', required: true },
        { name: 'phase', label: '오픈 단계', type: 'select', options: phase },
        { name: 'sortOrder', label: '정렬 순서', type: 'number', required: true },
        { name: 'isActive', label: '노출', type: 'checkbox' },
      ]}
      save={saveCategory}
      remove={deleteCategory}
    />
  );
}
