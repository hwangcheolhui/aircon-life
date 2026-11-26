'use client';
// A-CNT-010 공지사항 (F-ADM-CNT-01): 목록형 공통 틀(검색 Enter = 조회, 더블클릭 = 수정), 기사 대상 공지는 읽은 기사 수/대상 기사 수
import { Tag } from '@aircon/ui';
import { CrudScreen, type Option, labelOf } from '@/admin/crud-screen';
import type { listNotices } from '@/server/content';
import { deleteNoticeAction, saveNoticeAction } from './actions';

type Row = Awaited<ReturnType<typeof listNotices>>[number];

export function NoticesScreen(p: {
  rows: Row[];
  codes: Record<string, Option[]>;
  branches: Option[];
  branchOnly: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const types = p.branchOnly ? (p.codes.NOTICE_TYPE ?? []).filter((o) => o.value === 'BRANCH') : p.codes.NOTICE_TYPE;
  return (
    <CrudScreen<Row>
      title="공지사항"
      noun="공지"
      rows={p.rows}
      rowKey={(r) => r.id}
      canCreate={p.canCreate}
      canUpdate={p.canUpdate}
      canDelete={p.canDelete}
      headerExtra={p.branchOnly ? <p className="ac-caption">거점 소속 관리자는 자기 거점 공지만 등록·수정할 수 있습니다.</p> : undefined}
      filters={[
        { name: 'noticeType', label: '유형', options: p.codes.NOTICE_TYPE, match: (r, v) => r.noticeType === v },
        { name: 'title', label: '제목', match: (r, v) => r.title.includes(v) },
      ]}
      columns={[
        {
          header: '유형',
          cell: (r) => (
            <>
              {labelOf(p.codes.NOTICE_TYPE, r.noticeType)}
              {r.isPinned ? <Tag tone="primary">고정</Tag> : null}
              {r.isPopup ? <Tag tone="warning">팝업</Tag> : null}
            </>
          ),
        },
        { header: '대상', cell: (r) => labelOf(p.codes.NOTICE_AUDIENCE, r.targetAudience) },
        { header: '거점', cell: (r) => r.branchName ?? '전체' },
        { header: '제목', cell: (r) => r.title },
        { header: '게시 기간', cell: (r) => <span className="ac-num">{`${r.publishFrom ?? ''} ~ ${r.publishTo ?? ''}`}</span> },
        { header: '읽음', num: true, cell: (r) => (r.targetCount === null ? '-' : <span className="ac-num">{`${r.readCount} / ${r.targetCount}`}</span>) },
        { header: '작성자', cell: (r) => r.authorName ?? '-' },
      ]}
      toForm={(r) => ({ ...r, branchId: r.branchId ? String(r.branchId) : '', publishTo: r.publishTo ?? '' })}
      defaults={{ noticeType: p.branchOnly ? 'BRANCH' : 'ALL', targetAudience: 'TECHNICIAN', publishFrom: today, branchId: p.branchOnly ? (p.branches[0]?.value ?? '') : '' }}
      fields={[
        { name: 'noticeType', label: '유형', type: 'select', required: true, options: types, help: '고객 공지는 고객 화면에만 나갑니다.' },
        { name: 'targetAudience', label: '대상', type: 'select', required: true, options: p.codes.NOTICE_AUDIENCE },
        { name: 'branchId', label: '거점', type: 'select', options: p.branches, emptyOption: '선택', help: '거점 공지일 때만 필요합니다.' },
        { name: 'publishFrom', label: '게시 시작일', type: 'date', required: true },
        { name: 'publishTo', label: '게시 종료일', type: 'date', help: '비우면 계속 게시' },
        { name: 'isPinned', label: '상단 고정(필독)', type: 'checkbox' },
        { name: 'isPopup', label: '팝업(필독)', type: 'checkbox' },
        { name: 'title', label: '제목', required: true, span2: true },
        { name: 'content', label: '내용', type: 'textarea', required: true, span2: true },
      ]}
      save={saveNoticeAction}
      remove={deleteNoticeAction}
    />
  );
}
