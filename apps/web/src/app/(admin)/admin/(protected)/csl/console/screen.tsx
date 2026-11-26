'use client';
/**
 * A-CSL-010 상담 콘솔 (03 §4.3): ① 고객 영역 ② 상담 유형 탭(출장접수 | 문의·클레임 | 독촉/전달 A-CSL-030 | 안전사고 A-CSL-040) ③ 거점·지역 현황 ④ Time Table ⑤ 이력 탭
 * - 초기 상태: 전화1 외 모든 입력 비활성. 고객 확정 후 활성.
 * - 고객 확정 시 순서: 개인정보 동의 팝업(BR-023) → 미완료 상담 → 미완료 클레임 → 당일 상담 이력(BR-022)
 */
import { canWithdrawPrivacy } from '@aircon/domain';
import { Alert, Button, ConfirmModal, Field, Input, Masked, Modal, Select, Tag, Tabs, useToast } from '@aircon/ui';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { type Option, labelOf } from '@/admin/crud-screen';
import type { ConsoleCustomerMatch, getConsoleCustomer } from '@/server/consult';
import { answerConsent, confirmCustomer, loadBranchStatus, reloadCustomer, searchCustomers, viewCustomerPii } from './actions';
import { FollowupTab, IncidentTab } from './aftercare-tabs';
import { ConsentModal, EditCustomerModal, LookupModal } from './customer-modals';
import { HistoryTabs } from './history-tabs';
import { InquiryTab } from './inquiry-tab';
import { type Choices, OrderForm, TimeTableSection, useOrderDraft } from './order-tab';

export type ConsoleData = Awaited<ReturnType<typeof getConsoleCustomer>> & { callLogId: number | null };
type Res = { ok: boolean; message?: string; fieldErrors?: Record<string, string>; data?: unknown };
type Script = { scriptCode: string; title: string; content: string; triggerPoint: string };
type BranchStatus = { branchId: number; branchName: string; areaCount: number; assignWait: number; pending: number; onCallToday: number; workingToday: number };

const errOf = (r: Res) => r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '처리하지 못했습니다.';
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

export function ConsoleScreen(p: {
  choices: Choices;
  codes: Record<string, Option[]>;
  scripts: Script[];
  branches: { id: number; name: string }[];
  canWrite: boolean;
  canUpdate: boolean;
  readOnly: boolean;
}) {
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const [lookup, setLookup] = useState<{ matches: ConsoleCustomerMatch[]; hiddenCount: number } | null>(null);
  const [data, setData] = useState<ConsoleData | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [withdraw, setWithdraw] = useState(false);
  const [alerts, setAlerts] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<'ORDER' | 'INQUIRY' | 'FOLLOWUP' | 'SAFETY'>('ORDER');
  const [branchId, setBranchId] = useState<number | null>(p.branches.length === 1 ? p.branches[0]!.id : null);
  const [status, setStatus] = useState<BranchStatus | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const draft = useOrderDraft(p.choices);
  const today = kstToday();
  const script = (t: string) => p.scripts.find((s) => s.triggerPoint === t)?.content ?? null;

  useEffect(() => {
    if (!branchId) return setStatus(null);
    void loadBranchStatus(branchId).then((r) => setStatus((r as Res).ok ? ((r as Res).data as BranchStatus) : null));
  }, [branchId, reloadKey]);

  const search = async () => {
    setError(null);
    const r = (await searchCustomers(phone)) as Res;
    if (!r.ok) return setError(errOf(r));
    setLookup(r.data as { matches: ConsoleCustomerMatch[]; hiddenCount: number });
  };

  const select = async (customerId: number) => {
    setLookup(null);
    setBusy(true);
    const r = (await confirmCustomer(customerId, phone)) as Res;
    setBusy(false);
    if (!r.ok) return setError(errOf(r));
    const d = r.data as ConsoleData;
    draft.reset();
    setData(d);
    setTab('ORDER');
    setConsentOpen(d.needsConsent && p.canUpdate);
    setAlerts(d.alerts.map((a) => a.message));
  };

  const reload = useCallback(async () => {
    if (!data) return;
    const r = (await reloadCustomer(data.customer.id)) as Res;
    if (r.ok) setData({ ...(r.data as ConsoleData), callLogId: data.callLogId });
    setReloadKey((k) => k + 1);
  }, [data]);

  const answer = async (action: 'AGREE' | 'DISAGREE' | 'NOT_ASKED' | 'WITHDRAW') => {
    if (!data) return;
    setBusy(true);
    const r = (await answerConsent({ customerId: data.customer.id, callLogId: data.callLogId ?? '', action })) as Res;
    setBusy(false);
    setConsentOpen(false);
    setWithdraw(false);
    if (!r.ok) return setError(errOf(r));
    toast('저장에 성공하였습니다.');
    await reload();
  };

  const clear = () => {
    setPhone('');
    setData(null);
    setLookup(null);
    setAlerts([]);
    setConsentOpen(false);
    setError(null);
    draft.reset();
  };

  const c = data?.customer;
  const addr = data?.addresses.find((a) => a.isDefault) ?? data?.addresses[0];
  const onBranch = useCallback((id: number) => setBranchId(id), []);

  return (
    <div className="adm-csl">
      <div className="adm-page-head">
        <h1 className="ac-h2">상담 콘솔</h1>
        <Link className="ac-btn ac-btn--sm ac-btn--ghost" href="/admin/csl/history">
          상담 이력 조회
        </Link>
      </div>
      {p.readOnly ? <Alert tone="warning">임시 개발 모드에서는 조회만 할 수 있습니다. 저장하려면 로그인해 주세요.</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {/* ① 고객 영역 */}
      <section className="ac-card adm-csl-customer" aria-label="고객">
        <form
          className="adm-csl-customer__row"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <Field label="전화1">
            {(id) => (
              <div className="ac-row adm-csl-phone">
                <Input id={id} inputMode="tel" value={phone} placeholder="010-0000-0000" onChange={(e) => setPhone(e.target.value)} />
                <Button type="submit" variant="dark" icon aria-label="고객 조회" disabled={busy}>
                  <Search aria-hidden />
                </Button>
              </div>
            )}
          </Field>
          {c ? (
            <div className="adm-csl-who">
              <Masked masked={`${c.nameMasked} 고객님`} canView={p.canUpdate} onView={async () => {
                const r = (await viewCustomerPii(c.id)) as Res;
                return r.ok ? `${(r.data as { name: string }).name} 고객님` : null;
              }} />
              <span className="ac-masked ac-num">{c.phoneMasked}</span>
              <span className="ac-caption ac-num">{c.customerNo}</span>
              {c.hasAppLogin ? <Tag tone="primary">앱 가입</Tag> : null}
            </div>
          ) : (
            <p className="ac-body-sm adm-csl-who">전화번호를 입력하고 Enter 를 누르면 고객을 찾습니다.</p>
          )}
          <div className="ac-row">
            <Button size="sm" disabled={!c || !p.canUpdate} onClick={() => setEditing(true)}>
              고객정보수정
            </Button>
            <Button size="sm" variant="ghost" onClick={clear}>
              초기화
            </Button>
          </div>
        </form>
        {c ? (
          <dl className="adm-csl-facts">
            <div>
              <dt>전화2</dt>
              <dd className="ac-masked ac-num">{c.phone2Masked || '-'}</dd>
            </div>
            <div>
              <dt>주소</dt>
              <dd>{addr ? `${addr.roadAddress}${addr.branchName ? ` (${addr.branchName})` : ''}` : '-'}</dd>
            </div>
            <div>
              <dt>고객등급</dt>
              <dd>
                {labelOf(p.codes.CUSTOMER_GRADE, c.grade)}
                {c.tags.map((t) => (
                  <Tag key={t} tone={t === 'CAUTION' ? 'danger' : 'warning'}>
                    {labelOf(p.codes.CUSTOMER_TAG, t)}
                  </Tag>
                ))}
              </dd>
            </div>
            <div>
              <dt>동의상태</dt>
              <dd>
                {labelOf(p.codes.PRIVACY_AGREE_STATUS, c.privacyAgreeStatus)}{' '}
                {canWithdrawPrivacy(c.privacyAgreeStatus) ? (
                  <Button size="sm" variant="text" disabled={!p.canUpdate} onClick={() => setWithdraw(true)}>
                    동의 철회
                  </Button>
                ) : (
                  <Button size="sm" variant="text" disabled={!p.canUpdate} onClick={() => setConsentOpen(true)}>
                    동의 받기
                  </Button>
                )}
              </dd>
            </div>
            <div>
              <dt>최근작업일</dt>
              <dd className="ac-num">{c.lastServiceDate ?? '-'}</dd>
            </div>
            <div>
              <dt>해피콜</dt>
              <dd>{c.happycallReject ? '거부' : '수신'}</dd>
            </div>
          </dl>
        ) : null}
      </section>

      <div className="adm-csl-main">
        {/* ② 상담 유형 탭 */}
        <section className="ac-card adm-csl-tabs" aria-label="상담 유형">
          <Tabs
            items={[
              { value: 'ORDER', label: '출장접수' },
              { value: 'INQUIRY', label: '문의·클레임' },
              { value: 'FOLLOWUP', label: '독촉/전달' },
              { value: 'SAFETY', label: '안전사고' },
            ]}
            value={tab}
            onChange={setTab}
          />
          <fieldset className="adm-fieldset" disabled={!data || !p.canWrite} aria-label={data ? undefined : '고객을 먼저 확정하세요'}>
            {tab === 'ORDER' ? (
              <OrderForm d={draft} data={data} codes={p.codes} choices={p.choices} onBranch={onBranch} />
            ) : tab === 'INQUIRY' ? (
              <InquiryTab data={data} codes={p.codes} canWrite={p.canWrite} onSaved={reload} />
            ) : tab === 'FOLLOWUP' ? (
              <FollowupTab data={data} codes={p.codes} canWrite={p.canWrite} onSaved={reload} />
            ) : (
              <IncidentTab data={data} codes={p.codes} canWrite={p.canWrite} onSaved={reload} />
            )}
          </fieldset>
        </section>

        {/* ③ 거점·지역 현황 */}
        <aside className="ac-card adm-csl-panel" aria-label="거점·지역 현황">
          <h2 className="ac-h3">거점·지역 현황</h2>
          {p.branches.length > 1 ? (
            <Field label="거점">
              {(id) => (
                <Select id={id} value={branchId ?? ''} onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">선택</option>
                  {p.branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          {status ? (
            <dl className="adm-csl-stats">
              <dt>거점</dt>
              <dd>{status.branchName}</dd>
              <dt>관할</dt>
              <dd className="ac-num">{status.areaCount}개 동</dd>
              <dt>미지정</dt>
              <dd className="ac-num">{status.assignWait}건</dd>
              <dt>미처리</dt>
              <dd className="ac-num">{status.pending}건</dd>
              <dt>오늘 근무 기사</dt>
              <dd className="ac-num">{status.workingToday}명</dd>
              <dt>오늘 휴일 근무</dt>
              <dd className="ac-num">{status.onCallToday}명</dd>
            </dl>
          ) : (
            <p className="ac-body-sm">거점을 고르면 현황이 보입니다.</p>
          )}
          <Link className="ac-btn ac-btn--sm ac-btn--outline" href="/admin/dsp/slots">
            운영슬롯관리
          </Link>
          <h3 className="ac-title adm-csl-scripts-title">응대 멘트</h3>
          <ul className="adm-csl-scripts">
            {p.scripts.map((s) => (
              <li key={s.scriptCode}>
                <details>
                  <summary>{s.title}</summary>
                  <p className="ac-body-sm">{s.content}</p>
                </details>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {/* ④ Time Table */}
      <TimeTableSection
        d={draft}
        data={data}
        branchId={branchId}
        today={today}
        codes={p.codes}
        scripts={p.scripts}
        canWrite={p.canWrite}
        active={tab === 'ORDER'}
        reloadKey={reloadKey}
        onSaved={reload}
      />

      {/* ⑤ 이력 탭 */}
      <HistoryTabs data={data} codes={p.codes} />

      {lookup ? (
        <LookupModal open phone={phone} matches={lookup.matches} hiddenCount={lookup.hiddenCount} codes={p.codes} canWrite={p.canWrite} onClose={() => setLookup(null)} onSelect={select} />
      ) : null}
      <ConsentModal open={consentOpen} script={script('PRIVACY_CONSENT')} busy={busy} onAnswer={answer} onClose={() => setConsentOpen(false)} />
      <ConfirmModal open={withdraw} message="개인정보 수집 동의를 철회하시겠습니까?" description="철회하면 마케팅 발송도 즉시 중단됩니다." confirmLabel="철회" danger onConfirm={() => answer('WITHDRAW')} onCancel={() => setWithdraw(false)} />
      <Modal
        open={!consentOpen && alerts.length > 0}
        title="확인이 필요합니다"
        description={alerts[0]}
        onClose={() => setAlerts((a) => a.slice(1))}
        actions={
          <Button variant="primary" block onClick={() => setAlerts((a) => a.slice(1))}>
            확인
          </Button>
        }
      />
      {data ? <EditCustomerModal open={editing} customerId={data.customer.id} happycallReject={data.customer.happycallReject} codes={p.codes} onClose={() => setEditing(false)} onSaved={() => (setEditing(false), void reload())} /> : null}
    </div>
  );
}
