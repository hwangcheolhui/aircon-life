'use client';
import type { commonCode } from '@aircon/db';
import { Tag } from '@aircon/ui';
import { CrudScreen } from '@/admin/crud-screen';
import { deleteCode, saveCode } from './actions';

type Row = typeof commonCode.$inferSelect;

export function CodesScreen(p: { rows: Row[]; canCreate: boolean; canUpdate: boolean; canDelete: boolean }) {
  const groups = [...new Set(p.rows.map((r) => r.groupCode))].map((g) => ({ value: g, label: g }));
  return (
    <CrudScreen<Row>
      title="공통 코드"
      noun="코드"
      rows={p.rows}
      rowKey={(r) => r.id}
      canCreate={p.canCreate}
      canUpdate={p.canUpdate}
      canDelete={p.canDelete}
      filters={[
        { name: 'group', label: '코드 그룹', options: groups, match: (r, v) => r.groupCode === v },
        { name: 'q', label: '코드·표시명', match: (r, v) => `${r.code} ${r.name}`.toLowerCase().includes(v.toLowerCase()) },
      ]}
      columns={[
        { header: '코드 그룹', cell: (r) => <span className="ac-num">{r.groupCode}</span> },
        { header: '코드', cell: (r) => <span className="ac-num">{r.code}</span> },
        { header: '표시명', cell: (r) => r.name },
        { header: '정렬', num: true, cell: (r) => r.sortOrder },
        { header: '사용', cell: (r) => (r.isActive ? <Tag tone="success">사용</Tag> : <Tag>중지</Tag>) },
      ]}
      rowClassName={(r) => (r.isActive ? undefined : 'is-muted')}
      defaults={{ isActive: true, sortOrder: '0' }}
      toForm={(r) => ({ ...r, extraJson: r.extraJson ? JSON.stringify(r.extraJson) : '' })}
      fields={[
        { name: 'groupCode', label: '코드 그룹', required: true, lockOnEdit: true, help: '예: DEVICE_TYPE' },
        { name: 'code', label: '코드', required: true, lockOnEdit: true },
        { name: 'name', label: '표시명', required: true },
        { name: 'sortOrder', label: '정렬 순서', type: 'number', required: true },
        { name: 'extraJson', label: '부가 속성(JSON)', type: 'json' },
        { name: 'isActive', label: '사용', type: 'checkbox' },
      ]}
      save={saveCode}
      remove={deleteCode}
    />
  );
}
