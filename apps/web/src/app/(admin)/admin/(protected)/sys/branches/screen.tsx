'use client';
import type { branch } from '@aircon/db';
import { CrudScreen, type Option, labelOf } from '@/admin/crud-screen';
import { deleteBranch, saveBranch } from './actions';

type Row = typeof branch.$inferSelect;
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '');

export function BranchesScreen(p: {
  rows: Row[];
  codes: Record<string, Option[]>;
  managers: Option[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const status = p.codes.BRANCH_STATUS;
  return (
    <CrudScreen<Row>
      title="거점 관리"
      noun="거점"
      rows={p.rows}
      rowKey={(r) => r.id}
      canCreate={p.canCreate}
      canUpdate={p.canUpdate}
      canDelete={p.canDelete}
      filters={[
        { name: 'q', label: '거점 코드·명', match: (r, v) => `${r.branchCode} ${r.name}`.toLowerCase().includes(v.toLowerCase()) },
        { name: 'status', label: '운영 상태', options: status, match: (r, v) => r.status === v },
      ]}
      columns={[
        { header: '거점 코드', cell: (r) => <span className="ac-num">{r.branchCode}</span> },
        { header: '거점명', cell: (r) => r.name },
        { header: '운영 상태', cell: (r) => labelOf(status, r.status) },
        { header: '운영 시간', cell: (r) => <span className="ac-num">{r.openTime ? `${hhmm(r.openTime)}~${hhmm(r.closeTime)}` : ''}</span> },
        { header: '반경(km)', num: true, cell: (r) => r.radiusKm ?? '' },
        { header: '대표 전화', cell: (r) => <span className="ac-num">{r.phone ?? ''}</span> },
        { header: '거점장', cell: (r) => labelOf(p.managers, r.managerAdminId ? String(r.managerAdminId) : null) },
        { header: '개소일', cell: (r) => <span className="ac-num">{r.openedAt ?? ''}</span> },
      ]}
      defaults={{ status: 'PREPARING', openTime: '08:00', closeTime: '18:00', radiusKm: '5.0' }}
      toForm={(r) => ({ ...r, openTime: hhmm(r.openTime), closeTime: hhmm(r.closeTime), managerAdminId: r.managerAdminId ? String(r.managerAdminId) : '' })}
      fields={[
        { name: 'branchCode', label: '거점 코드', required: true, lockOnEdit: true, help: '예: EP01' },
        { name: 'name', label: '거점명', required: true },
        { name: 'status', label: '운영 상태', type: 'select', required: true, options: status },
        { name: 'managerAdminId', label: '거점장', type: 'select', options: p.managers, emptyOption: '미지정' },
        { name: 'openTime', label: '운영 시작', type: 'time' },
        { name: 'closeTime', label: '운영 종료', type: 'time' },
        { name: 'radiusKm', label: '서비스 반경(km)', inputMode: 'decimal' },
        { name: 'phone', label: '대표 전화', inputMode: 'tel' },
        { name: 'address', label: '주소(교육장)', span2: true },
        { name: 'centerLat', label: '중심 위도', inputMode: 'decimal' },
        { name: 'centerLng', label: '중심 경도', inputMode: 'decimal' },
        { name: 'openedAt', label: '개소일', type: 'date' },
      ]}
      save={saveBranch}
      remove={deleteBranch}
    />
  );
}
