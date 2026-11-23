'use client';
import Link from 'next/link';
import { CrudScreen, type Option, labelOf } from '@/admin/crud-screen';
import { saveTechnician, technicianDetail } from './actions';

interface Row {
  id: number;
  techCode: string;
  name: string;
  displayName: string | null;
  phoneMasked: string;
  branchId: number;
  branchName: string;
  grade: string;
  contractType: string;
  status: string;
  joinedAt: string | null;
}

export function TechniciansScreen(p: {
  rows: Row[];
  branches: Option[];
  codes: Record<string, Option[]>;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const { TECH_GRADE: grade, CONTRACT_TYPE: contract, TECH_STATUS: status } = p.codes;
  return (
    <CrudScreen<Row>
      title="기사 목록"
      noun="기사"
      rows={p.rows}
      rowKey={(r) => r.id}
      canCreate={p.canCreate}
      canUpdate={p.canUpdate}
      canDelete={false}
      filters={[
        { name: 'q', label: '기사 코드·이름', match: (r, v) => `${r.techCode} ${r.name}`.toLowerCase().includes(v.toLowerCase()) },
        { name: 'branchId', label: '소속 거점', options: p.branches, match: (r, v) => String(r.branchId) === v },
        { name: 'grade', label: '등급', options: grade, match: (r, v) => r.grade === v },
        { name: 'contractType', label: '계약 형태', options: contract, match: (r, v) => r.contractType === v },
        { name: 'status', label: '상태', options: status, match: (r, v) => r.status === v },
      ]}
      columns={[
        { header: '기사 코드', cell: (r) => <span className="ac-num">{r.techCode}</span> },
        { header: '이름', cell: (r) => r.name },
        { header: '연락처', cell: (r) => <span className="ac-masked ac-num">{r.phoneMasked}</span> },
        { header: '소속 거점', cell: (r) => r.branchName },
        { header: '등급', cell: (r) => labelOf(grade, r.grade) },
        { header: '계약 형태', cell: (r) => labelOf(contract, r.contractType) },
        { header: '상태', cell: (r) => labelOf(status, r.status) },
        { header: '입사일', cell: (r) => <span className="ac-num">{r.joinedAt ?? ''}</span> },
        {
          header: '상세',
          cell: (r) => (
            <Link className="ac-btn ac-btn--ghost ac-btn--sm" href={`/admin/tec/technicians/${r.id}`} onDoubleClick={(e) => e.stopPropagation()}>
              상세
            </Link>
          ),
        },
      ]}
      defaults={{ status: 'ACTIVE', grade: 'REGULAR', contractType: 'FREELANCER', branchId: p.branches.length === 1 ? p.branches[0]!.value : '' }}
      toForm={(r) => ({ ...r, branchId: String(r.branchId) })}
      loadDetail={async (r) => {
        if (!p.canUpdate) return { ...r, branchId: String(r.branchId), phone: r.phoneMasked };
        const res = await technicianDetail(r.id);
        return res.ok ? { ...(res.data as Record<string, unknown>), branchId: String(r.branchId) } : null;
      }}
      fields={[
        { name: 'techCode', label: '기사 코드', required: true, lockOnEdit: true, help: '예: T0001' },
        { name: 'name', label: '이름', required: true },
        { name: 'displayName', label: '고객 표시 이름' },
        { name: 'phone', label: '연락처', required: true, inputMode: 'tel' },
        { name: 'branchId', label: '소속 거점', type: 'select', required: true, options: p.branches },
        { name: 'grade', label: '등급', type: 'select', required: true, options: grade, lockOnEdit: true, help: '등록 뒤에는 기사 상세의 [등급 변경]에서 바꿉니다.' },
        { name: 'contractType', label: '계약 형태', type: 'select', required: true, options: contract },
        { name: 'status', label: '상태', type: 'select', required: true, options: status, help: '활동(ACTIVE) 기사만 슬롯 수용 건수에 들어갑니다.' },
        { name: 'joinedAt', label: '입사일', type: 'date' },
      ]}
      save={saveTechnician}
    />
  );
}
