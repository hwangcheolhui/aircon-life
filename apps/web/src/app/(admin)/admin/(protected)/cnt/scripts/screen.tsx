'use client';
import type { consultScript } from '@aircon/db';
import { CrudScreen, type Option, labelOf } from '@/admin/crud-screen';
import { deleteScript, saveScript } from './actions';

type Row = typeof consultScript.$inferSelect;

export function ScriptsScreen(p: { rows: Row[]; codes: Record<string, Option[]>; canCreate: boolean; canUpdate: boolean; canDelete: boolean }) {
  const trigger = p.codes.SCRIPT_TRIGGER;
  return (
    <CrudScreen<Row>
      title="상담 스크립트"
      noun="스크립트"
      rows={p.rows}
      rowKey={(r) => r.id}
      canCreate={p.canCreate}
      canUpdate={p.canUpdate}
      canDelete={p.canDelete}
      columns={[
        { header: '코드', cell: (r) => <span className="ac-num">{r.scriptCode}</span> },
        { header: '사용 시점', cell: (r) => labelOf(trigger, r.triggerPoint) },
        { header: '제목', cell: (r) => r.title },
        { header: '사용', cell: (r) => (r.isActive ? '사용' : '미사용') },
      ]}
      toForm={(r) => ({ ...r })}
      defaults={{ isActive: true }}
      fields={[
        { name: 'scriptCode', label: '스크립트 코드', required: true, lockOnEdit: true, help: '영문 대문자·숫자·밑줄' },
        { name: 'triggerPoint', label: '사용 시점', type: 'select', required: true, options: trigger, emptyOption: '선택' },
        { name: 'title', label: '제목', required: true },
        { name: 'isActive', label: '사용', type: 'checkbox' },
        { name: 'content', label: '내용', type: 'textarea', required: true, span2: true },
      ]}
      save={saveScript}
      remove={deleteScript}
    />
  );
}
