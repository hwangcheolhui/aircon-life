'use client';
import type { serviceProduct } from '@aircon/db';
import { Tag } from '@aircon/ui';
import { CrudScreen, type Option, labelOf } from '@/admin/crud-screen';
import { deleteProduct, saveProduct } from './actions';

type Row = typeof serviceProduct.$inferSelect;

export function ProductsScreen(p: {
  rows: Row[];
  categories: Option[];
  codes: Record<string, Option[]>;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const { DEVICE_TYPE: device, CLEAN_LEVEL: level, TECH_GRADE: grade } = p.codes;
  return (
    <CrudScreen<Row>
      title="상품 관리"
      noun="상품"
      rows={p.rows}
      rowKey={(r) => r.id}
      canCreate={p.canCreate}
      canUpdate={p.canUpdate}
      canDelete={p.canDelete}
      filters={[
        { name: 'cat', label: '카테고리', options: p.categories, match: (r, v) => String(r.categoryId) === v },
        { name: 'device', label: '기기 형태', options: device, match: (r, v) => r.deviceType === v },
        { name: 'level', label: '작업 범위', options: level, match: (r, v) => r.cleanLevel === v },
        { name: 'q', label: '상품 코드·명', match: (r, v) => `${r.productCode} ${r.name}`.toLowerCase().includes(v.toLowerCase()) },
      ]}
      columns={[
        { header: '상품 코드', cell: (r) => <span className="ac-num">{r.productCode}</span> },
        { header: '상품명', cell: (r) => r.name },
        { header: '카테고리', cell: (r) => labelOf(p.categories, String(r.categoryId)) },
        { header: '기기 형태', cell: (r) => labelOf(device, r.deviceType) },
        { header: '작업 범위', cell: (r) => labelOf(level, r.cleanLevel) },
        { header: '소요(분)', num: true, cell: (r) => r.baseDurationMin },
        { header: '인원', num: true, cell: (r) => r.requiredTechCount },
        { header: '필요 숙련', cell: (r) => labelOf(grade, r.requiredSkillLevel) },
        { header: '보증(일)', num: true, cell: (r) => r.warrantyDays },
        { header: '판매', cell: (r) => (r.isActive ? <Tag tone="success">판매</Tag> : <Tag>중지</Tag>) },
      ]}
      defaults={{ isActive: true, requiredTechCount: '1', warrantyDays: '30', baseDurationMin: '90' }}
      toForm={(r) => ({ ...r, categoryId: String(r.categoryId) })}
      fields={[
        { name: 'categoryId', label: '카테고리', type: 'select', required: true, options: p.categories, emptyOption: '선택' },
        { name: 'productCode', label: '상품 코드', required: true, lockOnEdit: true, help: '예: AC-WALL-FULL' },
        { name: 'name', label: '상품명', required: true, span2: true },
        { name: 'deviceType', label: '기기 형태', type: 'select', required: true, options: device, emptyOption: '선택' },
        { name: 'cleanLevel', label: '작업 범위', type: 'select', required: true, options: level, emptyOption: '선택' },
        { name: 'baseDurationMin', label: '표준 소요 시간(분)', type: 'number', required: true },
        { name: 'requiredTechCount', label: '필요 인원', type: 'number', required: true },
        { name: 'requiredSkillLevel', label: '필요 숙련 등급', type: 'select', options: grade, emptyOption: '제한 없음' },
        { name: 'warrantyDays', label: '보증 기간(일)', type: 'number', required: true },
        { name: 'description', label: '작업 범위 설명(고객 노출)', type: 'textarea' },
        { name: 'includedItems', label: '포함 항목', type: 'textarea' },
        { name: 'excludedItems', label: '불포함 항목(추가요금 사유 사전 공개)', type: 'textarea' },
        { name: 'isActive', label: '판매', type: 'checkbox' },
      ]}
      save={saveProduct}
      remove={deleteProduct}
    />
  );
}
