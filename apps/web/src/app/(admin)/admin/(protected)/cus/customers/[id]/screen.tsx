'use client';
// A-CUS-020 고객 상세 (One View). 상세주소·연락처는 마스킹, [보기]는 권한자에게만 노출하고 감사 로그를 남긴다(BR-100).
import { Alert, Button, Check, ConfirmModal, Empty, Field, MSG, Masked, Select, StatusBadge, Tabs, Textarea, useToast } from '@aircon/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { type Option, labelOf, won } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import type { getCustomerOneView } from '@/server/admin-customers';
import { saveGradeTags, saveMemo, viewCustomerPii } from '../actions';

type Detail = NonNullable<Awaited<ReturnType<typeof getCustomerOneView>>>;
type Pii = { name: string; phone1: string; phone2: string; details: { id: number; detailAddress: string }[] };
type Res = { ok: boolean; message?: string; fieldErrors?: Record<string, string>; data?: unknown };
const TABS = [
  { value: 'basic', label: '기본' },
  { value: 'address', label: '주소·기기' },
  { value: 'orders', label: '주문' },
  { value: 'payments', label: '결제' },
  { value: 'voc', label: 'VOC·AS' },
  { value: 'coupons', label: '쿠폰' },
  { value: 'consents', label: '동의이력' },
  { value: 'memo', label: '메모' },
] as const;
type Tab = (typeof TABS)[number]['value'];

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="ac-table-wrap">
      <table className="ac-table">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className={h === '금액' ? 'is-num' : undefined}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function CustomerDetailScreen({ d, codes, canUpdate }: { d: Detail; codes: Record<string, Option[]>; canUpdate: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const c = d.customer;
  const L = (g: string, v: string | null | undefined) => labelOf(codes[g], v);
  const [tab, setTab] = useState<Tab>('basic');
  const [pii, setPii] = useState<Pii | null>(null);
  const [grade, setGrade] = useState(c.grade);
  const [tags, setTags] = useState<string[]>(d.tags);
  const [memo, setMemo] = useState(c.memo ?? '');
  const [confirm, setConfirm] = useState<null | 'grade' | 'memo'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPii = async () => {
    if (pii) return pii;
    const r = (await viewCustomerPii(c.id)) as Res;
    if (!r.ok) {
      toast(r.message ?? '열람할 수 없습니다.');
      return null;
    }
    setPii(r.data as Pii);
    return r.data as Pii;
  };

  const run = async () => {
    const kind = confirm;
    setConfirm(null);
    setBusy(true);
    const r = (kind === 'grade' ? await saveGradeTags({ customerId: c.id, grade, tags }) : await saveMemo({ customerId: c.id, memo })) as Res;
    setBusy(false);
    if (!r.ok) return setError(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '저장하지 못했습니다.');
    setError(null);
    toast(MSG.saved);
    router.refresh();
  };

  return (
    <div>
      <div className="adm-page-head">
        <div className="adm-detail-head">
          <Link href="/admin/cus/customers" className="ac-btn ac-btn--ghost ac-btn--sm">
            목록
          </Link>
          <h1 className="ac-h2">
            <Masked masked={c.nameMasked} canView={canUpdate} onView={async () => (await loadPii())?.name ?? null} />
          </h1>
          <span className="ac-caption ac-num">{c.customerNo}</span>
          <span className="ac-badge">{L('CUSTOMER_GRADE', c.grade)}</span>
          {d.tags.map((t) => (
            <span key={t} className="ac-badge">
              {L('CUSTOMER_TAG', t)}
            </span>
          ))}
        </div>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Tabs items={[...TABS]} value={tab} onChange={setTab} />
      <section className="adm-section adm-cus-tab">
        {tab === 'basic' ? (
          <>
            <dl className="adm-kv">
              <dt>휴대폰</dt>
              <dd className="ac-num">
                <Masked masked={c.phoneMasked} canView={canUpdate} onView={async () => (await loadPii())?.phone1 ?? null} />
              </dd>
              <dt>전화2</dt>
              <dd className="ac-num">{c.phone2Masked ? <Masked masked={c.phone2Masked} canView={canUpdate} onView={async () => (await loadPii())?.phone2 ?? null} /> : '-'}</dd>
              <dt>이메일</dt>
              <dd>{c.email ?? '-'}</dd>
              <dt>유형</dt>
              <dd>{L('CUSTOMER_TYPE', c.customerType)}</dd>
              <dt>상태</dt>
              <dd>{L('CUSTOMER_STATUS', c.status)}</dd>
              <dt>가입 경로</dt>
              <dd>
                {L('JOIN_CHANNEL', c.joinChannel)} · {L('AUTH_PROVIDER', c.authProvider)}
              </dd>
              <dt>개인정보 동의</dt>
              <dd>{L('PRIVACY_AGREE_STATUS', c.privacyAgreeStatus)}</dd>
              <dt>마케팅 수신</dt>
              <dd>{c.marketingAgree ? '동의' : '미동의'}</dd>
              <dt>최근 작업일</dt>
              <dd className="ac-num">{c.lastServiceDate ?? '-'}</dd>
              <dt>누적 주문</dt>
              <dd className="ac-num">{c.totalOrderCount.toLocaleString()}건</dd>
              <dt>가입일시</dt>
              <dd className="ac-num">{formatDateTime(c.createdAt)}</dd>
            </dl>
            <h2 className="ac-h3 adm-section">등급·태그</h2>
            <fieldset className="adm-fieldset adm-form-grid" disabled={!canUpdate || busy}>
              <Field label="등급" required>
                {(id) => (
                  <Select id={id} value={grade} onChange={(e) => setGrade(e.target.value)}>
                    {codes.CUSTOMER_GRADE?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <div className="adm-actions" role="group" aria-label="태그">
                {codes.CUSTOMER_TAG?.map((o) => (
                  <Check
                    key={o.value}
                    label={o.label}
                    checked={tags.includes(o.value)}
                    onChange={(e) => setTags(e.target.checked ? [...tags, o.value] : tags.filter((t) => t !== o.value))}
                  />
                ))}
              </div>
            </fieldset>
            {canUpdate ? (
              <div className="adm-toolbar">
                <span />
                <Button variant="primary" loading={busy} onClick={() => setConfirm('grade')}>
                  저장
                </Button>
              </div>
            ) : null}
          </>
        ) : tab === 'address' ? (
          d.addresses.length === 0 ? (
            <Empty />
          ) : (
            <Table head={['기본', '별칭', '우편번호', '도로명 주소', '상세주소', '주거 형태', '엘리베이터']}>
              {d.addresses.map((a) => (
                <tr key={a.id}>
                  <td>{a.isDefault ? '기본' : ''}</td>
                  <td>{a.alias ?? '-'}</td>
                  <td className="ac-num">{a.zipcode ?? '-'}</td>
                  <td>{a.roadAddress}</td>
                  <td>
                    <Masked
                      masked="상세주소 ****"
                      canView={canUpdate}
                      onView={async () => (await loadPii())?.details.find((x) => x.id === a.id)?.detailAddress || '-'}
                    />
                  </td>
                  <td>{L('HOUSING_TYPE', a.housingType)}</td>
                  <td>{a.hasElevator == null ? '-' : a.hasElevator ? '있음' : '없음'}</td>
                </tr>
              ))}
            </Table>
          )
        ) : tab === 'orders' ? (
          d.orders.length === 0 ? (
            <Empty />
          ) : (
            <Table head={['상태', '접수번호', '채널', '유형', '약속일시', '완료일시', '결제', '금액']}>
              {d.orders.map((o) => (
                <tr
                  key={o.id}
                  tabIndex={0}
                  aria-label={`${o.orderNo} 주문 상세 열기`}
                  onDoubleClick={() => router.push(`/admin/ord/orders/${o.id}`)}
                  onKeyDown={(e) => e.key === 'Enter' && router.push(`/admin/ord/orders/${o.id}`)}
                >
                  <td>
                    <StatusBadge code={o.status} audience="staff" />
                  </td>
                  <td className="ac-num">{o.orderNo}</td>
                  <td>{L('ORDER_CHANNEL', o.channel)}</td>
                  <td>{L('ORDER_TYPE', o.orderType)}</td>
                  <td className="ac-num">{formatDateTime(o.promisedAt) || '-'}</td>
                  <td className="ac-num">{formatDateTime(o.completedAt) || '-'}</td>
                  <td>{L('PAYMENT_STATUS', o.paymentStatus)}</td>
                  <td className="is-num ac-num">{won(o.totalAmount)}</td>
                </tr>
              ))}
            </Table>
          )
        ) : tab === 'payments' ? (
          d.payments.length === 0 ? (
            <Empty />
          ) : (
            <Table head={['결제번호', '접수번호', '단계', '수단', '상태', '승인일시', '금액']}>
              {d.payments.map((x) => (
                <tr key={x.id}>
                  <td className="ac-num">{x.paymentNo}</td>
                  <td className="ac-num">{x.orderNo}</td>
                  <td>{L('PAYMENT_STAGE', x.paymentStage)}</td>
                  <td>{L('PAYMENT_METHOD', x.method)}</td>
                  <td>{L('PAYMENT_STATUS', x.status)}</td>
                  <td className="ac-num">{formatDateTime(x.approvedAt) || '-'}</td>
                  <td className="is-num ac-num">{won(x.amount)}</td>
                </tr>
              ))}
            </Table>
          )
        ) : tab === 'voc' ? (
          d.consults.length === 0 ? (
            <Empty />
          ) : (
            <Table head={['상담번호', '유형', '세부 유형', '상태', '내용', '접수일시']}>
              {d.consults.map((x) => (
                <tr key={x.id}>
                  <td className="ac-num">{x.consultNo}</td>
                  <td>{L('CONSULT_TYPE', x.consultType)}</td>
                  <td>{L('INQUIRY_SUB_TYPE', x.subType)}</td>
                  <td>{L('CONSULT_STATUS', x.status)}</td>
                  <td className="adm-csl-ellipsis">{x.content}</td>
                  <td className="ac-num">{formatDateTime(x.createdAt)}</td>
                </tr>
              ))}
            </Table>
          )
        ) : tab === 'coupons' ? (
          <Empty />
        ) : tab === 'consents' ? (
          d.consents.length === 0 ? (
            <Empty />
          ) : (
            <Table head={['일시', '동의 항목', '행위', '채널', '약관 버전']}>
              {d.consents.map((h) => (
                <tr key={h.id}>
                  <td className="ac-num">{formatDateTime(h.createdAt)}</td>
                  <td>{L('CONSENT_TYPE', h.consentType)}</td>
                  <td>{L('CONSENT_ACTION', h.action)}</td>
                  <td>{L('CONSENT_CHANNEL', h.channel)}</td>
                  <td className="ac-num">{h.termsVersion ?? '-'}</td>
                </tr>
              ))}
            </Table>
          )
        ) : (
          <>
            <Field label="내부 메모" help="상담원·관리자끼리 공유하는 메모입니다. 고객에게는 보이지 않습니다.">
              {(id) => <Textarea id={id} rows={6} maxLength={4000} value={memo} disabled={!canUpdate || busy} onChange={(e) => setMemo(e.target.value)} />}
            </Field>
            {canUpdate ? (
              <div className="adm-toolbar">
                <span />
                <Button variant="primary" loading={busy} onClick={() => setConfirm('memo')}>
                  저장
                </Button>
              </div>
            ) : null}
          </>
        )}
      </section>
      <ConfirmModal open={confirm !== null} onConfirm={run} onCancel={() => setConfirm(null)} />
    </div>
  );
}
