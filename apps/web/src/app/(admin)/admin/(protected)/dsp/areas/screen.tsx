'use client';
import type { serviceArea } from '@aircon/db';
import { Tag } from '@aircon/ui';
import { CrudScreen, type Option, labelOf, won } from '@/admin/crud-screen';
import { deleteArea, saveArea } from './actions';

type Row = typeof serviceArea.$inferSelect;
const YN: Option[] = [
  { value: 'Y', label: '가능' },
  { value: 'N', label: '불가' },
];

export function AreasScreen(p: { rows: Row[]; branches: Option[]; canCreate: boolean; canUpdate: boolean; canDelete: boolean }) {
  return (
    <CrudScreen<Row>
      title="관할 지역 관리"
      noun="관할 지역"
      rows={p.rows}
      rowKey={(r) => r.id}
      canCreate={p.canCreate}
      canUpdate={p.canUpdate}
      canDelete={p.canDelete}
      filters={[
        { name: 'branch', label: '담당 거점', options: p.branches, match: (r, v) => String(r.branchId) === v },
        { name: 'q', label: '지역명·법정동 코드', match: (r, v) => `${r.sido} ${r.sigungu} ${r.eupmyeondong} ${r.legalDongCode ?? ''}`.includes(v) },
        { name: 'yn', label: '서비스 가능', options: YN, match: (r, v) => r.isServiceable === (v === 'Y') },
      ]}
      columns={[
        { header: '담당 거점', cell: (r) => labelOf(p.branches, String(r.branchId)) },
        { header: '시도', cell: (r) => r.sido },
        { header: '시군구', cell: (r) => r.sigungu },
        { header: '읍면동', cell: (r) => r.eupmyeondong },
        { header: '법정동 코드', cell: (r) => <span className="ac-num">{r.legalDongCode ?? ''}</span> },
        { header: '서비스 가능', cell: (r) => (r.isServiceable ? <Tag tone="success">가능</Tag> : <Tag tone="danger">불가</Tag>) },
        { header: '원거리 출장비', num: true, cell: (r) => won(r.travelFee) },
      ]}
      defaults={{ isServiceable: true, travelFee: '0', branchId: p.branches.length === 1 ? p.branches[0]!.value : '' }}
      toForm={(r) => ({ ...r, branchId: String(r.branchId) })}
      fields={[
        { name: 'branchId', label: '담당 거점', type: 'select', required: true, options: p.branches, emptyOption: '선택' },
        { name: 'legalDongCode', label: '법정동 코드', inputMode: 'numeric', help: '숫자 10자리' },
        { name: 'sido', label: '시도', required: true },
        { name: 'sigungu', label: '시군구', required: true },
        { name: 'eupmyeondong', label: '읍면동', required: true },
        { name: 'travelFee', label: '원거리 출장비(원)', type: 'number', required: true },
        { name: 'isServiceable', label: '서비스 가능', type: 'checkbox' },
      ]}
      save={saveArea}
      remove={deleteArea}
    />
  );
}
