'use client';
// A-CUS-010 고객 목록 (검색 영역 Enter = 조회, 그리드 더블클릭 = 상세, 03 §6.2)
import { Button, Empty, Field, Input, Select } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';

interface Row {
  id: number;
  customerNo: string;
  customerType: string;
  nameMasked: string;
  phoneMasked: string;
  grade: string;
  status: string;
  joinChannel: string;
  privacyAgreeStatus: string;
  lastServiceDate: string | null;
  createdAt: Date;
  roadAddress: string | null;
  tags: string[];
}

const EMPTY = { name: '', phone: '', address: '', grade: '', tag: '', from: '', to: '' };

export function CustomersScreen(p: { rows: Row[]; query: Record<string, string | undefined>; codes: Record<string, Option[]> }) {
  const router = useRouter();
  const [f, setF] = useState({ ...EMPTY, ...Object.fromEntries(Object.entries(p.query).filter(([k, v]) => k in EMPTY && v)) });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const open = (id: number) => router.push(`/admin/cus/customers/${id}`);
  const text = (label: string, key: keyof typeof EMPTY, type = 'text') => (
    <Field label={label}>{(id) => <Input id={id} type={type} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} />}</Field>
  );
  const select = (label: string, key: keyof typeof EMPTY, options: Option[] | undefined) => (
    <Field label={label}>
      {(id) => (
        <Select id={id} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })}>
          <option value="">전체</option>
          {options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">고객 목록</h1>
      </div>
      <form
        className="ac-search-panel"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/admin/cus/customers${qs ? `?${qs}` : ''}`);
        }}
      >
        {text('이름', 'name')}
        {text('전화번호', 'phone', 'tel')}
        {text('주소', 'address')}
        {select('등급', 'grade', p.codes.CUSTOMER_GRADE)}
        {select('태그', 'tag', p.codes.CUSTOMER_TAG)}
        {text('최근 작업일(시작)', 'from', 'date')}
        {text('최근 작업일(종료)', 'to', 'date')}
        <div className="ac-search-panel__actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setF(EMPTY);
              router.push('/admin/cus/customers');
            }}
          >
            초기화
          </Button>
          <Button type="submit" variant="primary" size="sm">
            조회
          </Button>
        </div>
      </form>
      <div className="adm-toolbar">
        <span className="ac-body-sm">
          총 <strong className="ac-num">{p.rows.length.toLocaleString()}</strong>건
        </span>
      </div>
      {p.rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">고객번호</th>
                <th scope="col">이름</th>
                <th scope="col">연락처</th>
                <th scope="col">유형</th>
                <th scope="col">등급</th>
                <th scope="col">태그</th>
                <th scope="col">주소</th>
                <th scope="col">최근 작업일</th>
                <th scope="col">개인정보 동의</th>
                <th scope="col">가입일시</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.id} tabIndex={0} aria-label={`${r.customerNo} 상세 보기`} onDoubleClick={() => open(r.id)} onKeyDown={(e) => e.key === 'Enter' && open(r.id)}>
                  <td className="ac-num">{r.customerNo}</td>
                  <td>
                    <span className="ac-masked">{r.nameMasked}</span>
                  </td>
                  <td>
                    <span className="ac-masked ac-num">{r.phoneMasked}</span>
                  </td>
                  <td>{labelOf(p.codes.CUSTOMER_TYPE, r.customerType)}</td>
                  <td>{labelOf(p.codes.CUSTOMER_GRADE, r.grade)}</td>
                  <td>{r.tags.map((t) => labelOf(p.codes.CUSTOMER_TAG, t)).join(', ') || '-'}</td>
                  <td>{r.roadAddress ?? '-'}</td>
                  <td className="ac-num">{r.lastServiceDate ?? '-'}</td>
                  <td>{labelOf(p.codes.PRIVACY_AGREE_STATUS, r.privacyAgreeStatus)}</td>
                  <td className="ac-num">{formatDateTime(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
