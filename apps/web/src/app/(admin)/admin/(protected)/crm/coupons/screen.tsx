'use client';
// A-CRM-030 쿠폰 관리 (F-ADM-CRM-03): 목록형 공통 틀(검색 Enter = 조회, 더블클릭 = 수정) + [쿠폰 발급] 모달(고객번호 개별 / 마케팅 동의 고객 일괄)
import { Alert, Button, ConfirmModal, Field, MSG, Modal, Select, Tag, Textarea, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CrudScreen, type Option, labelOf, won } from '@/admin/crud-screen';
import type { listCoupons } from '@/server/coupons';
import { deleteCouponAction, issueCouponAction, saveCouponAction } from './actions';

type Row = Awaited<ReturnType<typeof listCoupons>>[number];
type Res = { ok: boolean; data?: unknown; message?: string; fieldErrors?: Record<string, string> };

const TYPES: Option[] = [
  { value: 'FIXED', label: '정액(원)' },
  { value: 'RATE', label: '정률(%)' },
];

export function CouponsScreen(p: { rows: Row[]; categories: Option[]; branches: Option[]; canCreate: boolean; canUpdate: boolean; canDelete: boolean }) {
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const issuable = p.rows.filter((r) => r.isActive && r.validTo >= today);
  const [issue, setIssue] = useState(false);
  return (
    <>
      <CrudScreen<Row>
        title="쿠폰 관리"
        noun="쿠폰"
        rows={p.rows}
        rowKey={(r) => r.id}
        canCreate={p.canCreate}
        canUpdate={p.canUpdate}
        canDelete={p.canDelete}
        toolbarExtra={
          p.canCreate ? (
            <Button variant="outline" size="sm" disabled={!issuable.length} onClick={() => setIssue(true)}>
              쿠폰 발급
            </Button>
          ) : undefined
        }
        filters={[
          { name: 'name', label: '쿠폰명·코드', match: (r, v) => r.name.includes(v) || r.code.includes(v.toUpperCase()) },
          {
            name: 'state',
            label: '상태',
            options: [
              { value: 'ON', label: '사용 중' },
              { value: 'OFF', label: '사용 안 함·만료' },
            ],
            match: (r, v) => (v === 'ON') === (r.isActive && r.validTo >= today),
          },
        ]}
        columns={[
          { header: '코드', cell: (r) => <span className="ac-num">{r.code}</span> },
          { header: '쿠폰명', cell: (r) => r.name },
          { header: '할인', cell: (r) => (r.discountType === 'RATE' ? `${r.discountValue}%${r.maxDiscount ? ` (최대 ${won(r.maxDiscount)})` : ''}` : won(r.discountValue)) },
          { header: '최소 주문', num: true, cell: (r) => <span className="ac-num">{r.minOrderAmount ? won(r.minOrderAmount) : '-'}</span> },
          { header: '대상', cell: (r) => (r.targetCategoryId ? labelOf(p.categories, String(r.targetCategoryId)) : '전체') },
          { header: '사용 기간', cell: (r) => <span className="ac-num">{`${r.validFrom ?? ''} ~ ${r.validTo}`}</span> },
          { header: '발급', num: true, cell: (r) => <span className="ac-num">{`${r.issuedCount.toLocaleString()}${r.issueLimit ? ` / ${r.issueLimit.toLocaleString()}` : ''}`}</span> },
          { header: '사용', num: true, cell: (r) => <span className="ac-num">{r.usedCount.toLocaleString()}</span> },
          { header: '상태', cell: (r) => (r.isActive && r.validTo >= today ? <Tag tone="success">사용 중</Tag> : <Tag>{r.isActive ? '만료' : '사용 안 함'}</Tag>) },
        ]}
        toForm={(r) => ({
          ...r,
          discountValue: String(r.discountValue),
          maxDiscount: r.maxDiscount === null ? '' : String(r.maxDiscount),
          minOrderAmount: String(r.minOrderAmount),
          issueLimit: r.issueLimit === null ? '' : String(r.issueLimit),
          validFrom: r.validFrom ?? '',
          targetCategoryId: r.targetCategoryId ? String(r.targetCategoryId) : '',
        })}
        defaults={{ discountType: 'FIXED', validFrom: today, isActive: true, minOrderAmount: '0' }}
        fields={[
          { name: 'code', label: '쿠폰 코드', required: true, lockOnEdit: true, help: '영문 대문자·숫자 4~20자. 고객이 쿠폰함에서 입력합니다.' },
          { name: 'name', label: '쿠폰명', required: true },
          { name: 'discountType', label: '할인 방식', type: 'select', required: true, options: TYPES },
          { name: 'discountValue', label: '할인 값', type: 'number', required: true, inputMode: 'numeric', help: '정액은 원, 정률은 % (1~100)' },
          { name: 'maxDiscount', label: '최대 할인 금액', type: 'number', inputMode: 'numeric', help: '정률일 때 상한(원)' },
          { name: 'minOrderAmount', label: '최소 주문 금액', type: 'number', inputMode: 'numeric' },
          { name: 'validFrom', label: '사용 시작일', type: 'date' },
          { name: 'validTo', label: '사용 종료일', type: 'date', required: true },
          { name: 'issueLimit', label: '발급 한도', type: 'number', inputMode: 'numeric', help: '비우면 제한 없음' },
          { name: 'targetCategoryId', label: '대상 카테고리', type: 'select', options: p.categories, emptyOption: '전체' },
          { name: 'isActive', label: '사용', type: 'checkbox' },
        ]}
        save={saveCouponAction}
        remove={deleteCouponAction}
      />
      {issue ? <IssueModal coupons={issuable} branches={p.branches} onClose={() => setIssue(false)} /> : null}
    </>
  );
}

function IssueModal({ coupons, branches, onClose }: { coupons: Row[]; branches: Option[]; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState({ couponId: String(coupons[0]?.id ?? ''), mode: 'CUSTOMERS', customerNos: '', branchId: '' });
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setConfirm(false);
    const r = (await issueCouponAction(v)) as Res;
    if (!r.ok) return setError(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '발급하지 못했습니다.');
    const d = r.data as { issued: number; skipped: number };
    toast(`${MSG.saved} ${d.issued.toLocaleString()}명 발급${d.skipped ? `, ${d.skipped.toLocaleString()}명 건너뜀(이미 받음·한도)` : ''}`);
    onClose();
    router.refresh();
  };
  return (
    <>
      <Modal
        open
        title="쿠폰 발급"
        onClose={onClose}
        form
        actions={
          <>
            <Button variant="outline" onClick={onClose}>
              닫기
            </Button>
            <Button variant="primary" onClick={() => setConfirm(true)}>
              발급
            </Button>
          </>
        }
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="쿠폰" required>
          {(id) => (
            <Select id={id} value={v.couponId} onChange={(e) => setV({ ...v, couponId: e.target.value })}>
              {coupons.map((c) => (
                <option key={c.id} value={c.id}>
                  {`${c.name} (${c.code})`}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="발급 방식" required>
          {(id) => (
            <Select id={id} value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value })}>
              <option value="CUSTOMERS">고객번호로 개별 발급</option>
              <option value="BULK">마케팅 수신 동의 고객 일괄</option>
            </Select>
          )}
        </Field>
        {v.mode === 'CUSTOMERS' ? (
          <Field label="고객번호" required help="쉼표나 줄바꿈으로 구분, 한 번에 1,000명까지">
            {(id, d) => <Textarea id={id} aria-describedby={d} rows={4} value={v.customerNos} onChange={(e) => setV({ ...v, customerNos: e.target.value })} />}
          </Field>
        ) : (
          <Field label="거점" help="고르면 그 거점 주소를 가진 고객에게만 발급합니다.">
            {(id, d) => (
              <Select id={id} aria-describedby={d} value={v.branchId} onChange={(e) => setV({ ...v, branchId: e.target.value })}>
                <option value="">전체</option>
                {branches.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <p className="ac-caption">이미 받은 고객은 건너뛰고, 발급 한도까지만 발급합니다. 발급 안내 알림은 마케팅 수신 동의 고객에게만 보냅니다.</p>
      </Modal>
      <ConfirmModal open={confirm} message="발급하시겠습니까?" confirmLabel="발급" onConfirm={run} onCancel={() => setConfirm(false)} />
    </>
  );
}
