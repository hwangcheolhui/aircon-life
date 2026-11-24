'use client';
// A-STL-010 수수료 정책 그리드 + 등록·수정 모달 (F-ADM-STL-01). 비율은 %, 금액은 원.
import { CrudScreen, type Option, labelOf, won } from '@/admin/crud-screen';
import type { PolicyRow } from '@/server/settlements';
import { deletePolicy, savePolicy } from '../actions';

const pct = (v: string | null) => (v === null ? '' : `${Number(v)}%`);

export function PoliciesScreen(p: {
  rows: PolicyRow[];
  branches: Option[];
  codes: Record<string, Option[]>;
  today: string;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const grade = p.codes.TECH_GRADE;
  const contract = p.codes.CONTRACT_TYPE;
  const calc = p.codes.COMMISSION_CALC_TYPE;
  return (
    <CrudScreen<PolicyRow>
      title="수수료 정책"
      noun="정책"
      rows={p.rows}
      rowKey={(r) => r.id}
      canCreate={p.canCreate}
      canUpdate={p.canUpdate}
      canDelete={p.canDelete}
      filters={[
        { name: 'branch', label: '거점', options: p.branches, match: (r, v) => String(r.branchId) === v },
        { name: 'grade', label: '등급', options: grade, match: (r, v) => r.techGrade === v },
      ]}
      columns={[
        { header: '정책명', cell: (r) => r.policyName },
        { header: '거점', cell: (r) => (r.branchId ? labelOf(p.branches, String(r.branchId)) : '전체') },
        { header: '등급', cell: (r) => (r.techGrade ? labelOf(grade, r.techGrade) : '전체') },
        { header: '계약 형태', cell: (r) => (r.contractType ? labelOf(contract, r.contractType) : '전체') },
        { header: '계산 방식', cell: (r) => labelOf(calc, r.calcType) },
        { header: '기사 배분율', num: true, cell: (r) => pct(r.techShareRate) },
        { header: '대당 지급액', num: true, cell: (r) => won(r.perUnitAmount) },
        { header: '추가요금 배분율', num: true, cell: (r) => pct(r.extraChargeShareRate) },
        { header: '지원기사 배분율', num: true, cell: (r) => pct(r.supportRoleRate) },
        { header: '원천징수율', num: true, cell: (r) => pct(r.withholdingRate) },
        { header: '적용 기간', cell: (r) => <span className="ac-num">{`${r.validFrom ?? ''} ~ ${r.validTo ?? ''}`}</span> },
      ]}
      defaults={{
        calcType: 'RATE',
        techShareRate: '55',
        extraChargeShareRate: '70',
        supportRoleRate: '30',
        withholdingRate: '3.3',
        validFrom: p.today,
      }}
      toForm={(r) => ({
        ...r,
        branchId: r.branchId ? String(r.branchId) : '',
        techGrade: r.techGrade ?? '',
        contractType: r.contractType ?? '',
        techShareRate: r.techShareRate === null ? '' : String(Number(r.techShareRate)),
        perUnitAmount: r.perUnitAmount === null ? '' : String(r.perUnitAmount),
        extraChargeShareRate: r.extraChargeShareRate === null ? '' : String(Number(r.extraChargeShareRate)),
        supportRoleRate: r.supportRoleRate === null ? '' : String(Number(r.supportRoleRate)),
        withholdingRate: r.withholdingRate === null ? '' : String(Number(r.withholdingRate)),
        validTo: r.validTo ?? '',
      })}
      fields={[
        { name: 'policyName', label: '정책명', required: true, span2: true },
        { name: 'branchId', label: '적용 거점', type: 'select', options: p.branches, emptyOption: '전체' },
        { name: 'techGrade', label: '적용 등급', type: 'select', options: grade, emptyOption: '전체' },
        { name: 'contractType', label: '적용 계약 형태', type: 'select', options: contract, emptyOption: '전체' },
        { name: 'calcType', label: '계산 방식', type: 'select', required: true, options: calc },
        { name: 'techShareRate', label: '기사 배분율(%)', inputMode: 'decimal', help: '작업비(주문 금액 − 추가요금) × 배분율' },
        { name: 'perUnitAmount', label: '대당 지급액(원)', type: 'number', help: '대당 고정·혼합 방식에서 작업 대수만큼' },
        { name: 'extraChargeShareRate', label: '추가요금 배분율(%)', inputMode: 'decimal', help: '현장 추가요금 중 주기사 몫' },
        { name: 'supportRoleRate', label: '지원기사 배분율(%)', inputMode: 'decimal', help: '2인 작업 때 배분액 중 지원기사 몫' },
        { name: 'withholdingRate', label: '원천징수율(%)', inputMode: 'decimal', help: '도급(사업소득) 기사에게만 적용합니다.' },
        { name: 'validFrom', label: '적용 시작일', type: 'date', required: true },
        { name: 'validTo', label: '적용 종료일', type: 'date' },
      ]}
      save={savePolicy}
      remove={deletePolicy}
    />
  );
}
