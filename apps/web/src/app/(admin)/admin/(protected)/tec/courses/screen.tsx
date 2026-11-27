'use client';
// A-TEC-040 교육 과정 (F-ADM-TEC-05): 목록(검색 Enter = 조회, 더블클릭 = 수정), [수강생] → A-TEC-041
import { Tag } from '@aircon/ui';
import Link from 'next/link';
import { CrudScreen, type Option, labelOf, won } from '@/admin/crud-screen';
import type { listCourses } from '@/server/training';
import { deleteCourseAction, saveCourseAction } from './actions';

type Row = Omit<Awaited<ReturnType<typeof listCourses>>[number], 'createdAt' | 'updatedAt' | 'deletedAt'>;
const TONE: Record<string, 'primary' | 'success' | 'warning' | undefined> = { RECRUITING: 'primary', IN_PROGRESS: 'warning', FINISHED: 'success' };

export function CoursesScreen(p: {
  rows: Row[];
  codes: Record<string, Option[]>;
  branches: Option[];
  allowCommon: boolean;
  passNote: string;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  return (
    <CrudScreen<Row>
      title="교육 과정"
      noun="과정"
      rows={p.rows}
      rowKey={(r) => r.id}
      canCreate={p.canCreate}
      canUpdate={p.canUpdate}
      canDelete={p.canDelete}
      headerExtra={<p className="ac-caption">{p.passNote}</p>}
      filters={[
        { name: 'status', label: '상태', options: p.codes.COURSE_STATUS, match: (r, v) => r.status === v },
        { name: 'courseType', label: '유형', options: p.codes.COURSE_TYPE, match: (r, v) => r.courseType === v },
        { name: 'name', label: '과정명', match: (r, v) => r.name.includes(v) || r.courseCode.includes(v) },
      ]}
      columns={[
        { header: '상태', cell: (r) => <Tag tone={TONE[r.status]}>{labelOf(p.codes.COURSE_STATUS, r.status)}</Tag> },
        { header: '과정 코드', cell: (r) => <span className="ac-num">{r.courseCode}</span> },
        { header: '과정명', cell: (r) => r.name },
        { header: '유형', cell: (r) => labelOf(p.codes.COURSE_TYPE, r.courseType) },
        { header: '거점', cell: (r) => r.branchName ?? '전체 공통' },
        { header: '기간', cell: (r) => <span className="ac-num">{`${r.startDate ?? ''} ~ ${r.endDate ?? ''}`}</span> },
        { header: '수강료', num: true, cell: (r) => <span className="ac-num">{won(r.fee)}</span> },
        { header: '수강/정원', num: true, cell: (r) => <span className="ac-num">{`${r.enrolled} / ${r.capacity ?? '-'}`}</span> },
        { header: '수료', num: true, cell: (r) => <span className="ac-num">{r.passed}</span> },
        {
          header: '수강생',
          cell: (r) => (
            <Link href={`/admin/tec/enrollments?courseId=${r.id}`} className="ac-btn ac-btn--text ac-btn--sm">
              수강·수료 관리
            </Link>
          ),
        },
      ]}
      toForm={(r) => ({ ...r, branchId: r.branchId ? String(r.branchId) : '' })}
      defaults={{ courseType: 'BASIC', status: 'RECRUITING', fee: '0', branchId: p.allowCommon ? '' : (p.branches[0]?.value ?? '') }}
      fields={[
        { name: 'courseCode', label: '과정 코드', required: true, lockOnEdit: true, help: '수료증 번호 앞자리(예: BASIC01-2026-001)' },
        { name: 'name', label: '과정명', required: true },
        { name: 'courseType', label: '유형', type: 'select', required: true, options: p.codes.COURSE_TYPE, help: '기본과정을 수료하면 교육중 기사가 활동으로 바뀝니다.' },
        { name: 'status', label: '상태', type: 'select', required: true, options: p.codes.COURSE_STATUS, help: '모집중 → 진행중 → 종료' },
        { name: 'branchId', label: '거점', type: 'select', options: p.branches, emptyOption: p.allowCommon ? '전체 공통' : undefined, required: !p.allowCommon },
        { name: 'fee', label: '수강료(원)', type: 'number', required: true },
        { name: 'totalHours', label: '총 시간', type: 'number' },
        { name: 'capacity', label: '정원', type: 'number' },
        { name: 'startDate', label: '시작일', type: 'date' },
        { name: 'endDate', label: '종료일', type: 'date' },
        { name: 'passCriteria', label: '수료 기준 안내', span2: true },
      ]}
      save={saveCourseAction}
      remove={deleteCourseAction}
    />
  );
}
