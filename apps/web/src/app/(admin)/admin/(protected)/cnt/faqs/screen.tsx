'use client';
// A-CNT-020 FAQ (F-ADM-CNT-02): 목록형 공통 틀. 상담에서 만든 초안은 "상담 전환" 표시, 검토 후 게시
import type { faq } from '@aircon/db';
import { Tag } from '@aircon/ui';
import { CrudScreen, type Option, labelOf } from '@/admin/crud-screen';
import { deleteFaqAction, saveFaqAction } from './actions';

type Row = typeof faq.$inferSelect;

export function FaqsScreen(p: { rows: Row[]; codes: Record<string, Option[]>; canCreate: boolean; canUpdate: boolean; canDelete: boolean }) {
  return (
    <CrudScreen<Row>
      title="FAQ"
      noun="FAQ"
      rows={p.rows}
      rowKey={(r) => r.id}
      canCreate={p.canCreate}
      canUpdate={p.canUpdate}
      canDelete={p.canDelete}
      filters={[
        { name: 'audience', label: '대상', options: p.codes.FAQ_AUDIENCE, match: (r, v) => r.audience === v },
        { name: 'category', label: '분류', options: p.codes.FAQ_CATEGORY, match: (r, v) => r.category === v },
        { name: 'question', label: '질문', match: (r, v) => r.question.includes(v) },
      ]}
      columns={[
        { header: '대상', cell: (r) => labelOf(p.codes.FAQ_AUDIENCE, r.audience) },
        { header: '분류', cell: (r) => labelOf(p.codes.FAQ_CATEGORY, r.category) },
        {
          header: '질문',
          cell: (r) => (
            <>
              {r.question}
              {r.sourceConsultationId ? <Tag>상담 전환</Tag> : null}
            </>
          ),
        },
        { header: '게시', cell: (r) => (r.isPublished ? <Tag tone="success">게시</Tag> : <Tag>미게시</Tag>) },
        { header: '순서', num: true, cell: (r) => <span className="ac-num">{r.sortOrder}</span> },
      ]}
      toForm={(r) => ({ ...r })}
      defaults={{ audience: 'CUSTOMER', category: 'ETC', isPublished: true, sortOrder: '100' }}
      fields={[
        { name: 'audience', label: '대상', type: 'select', required: true, options: p.codes.FAQ_AUDIENCE },
        { name: 'category', label: '분류', type: 'select', required: true, options: p.codes.FAQ_CATEGORY },
        { name: 'sortOrder', label: '순서', type: 'number', inputMode: 'numeric', help: '작을수록 위에 보입니다.' },
        { name: 'isPublished', label: '게시', type: 'checkbox' },
        { name: 'question', label: '질문', required: true, span2: true },
        { name: 'answer', label: '답변', type: 'textarea', required: true, span2: true },
      ]}
      save={saveFaqAction}
      remove={deleteFaqAction}
    />
  );
}
