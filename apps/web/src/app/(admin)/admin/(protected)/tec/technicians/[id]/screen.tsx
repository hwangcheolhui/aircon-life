'use client';
// A-TEC-020 기사 상세. 연락처·계좌는 마스킹, [보기]는 수정 권한자에게만(감사 로그, BR-100).
import { Alert, Button, Check, ConfirmModal, Empty, Field, Input, MSG, Masked, Modal, Select, StatusBadge, Tabs, Tag, Textarea, useToast } from '@aircon/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useMemo, useState } from 'react';
import { type Option, labelOf } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import type { getTechnicianDetail } from '@/server/admin-technicians';
import { changeGrade, saveAreas, saveProfile, saveSkills, unlockLogin, viewPii } from './actions';

type Detail = NonNullable<Awaited<ReturnType<typeof getTechnicianDetail>>>;
type Res = { ok: boolean; message?: string; fieldErrors?: Record<string, string>; data?: unknown };
type Job = { orderId: number; orderNo: string; status: string; promisedAt: string | null; role: string };

const TABS = [
  { value: 'basic', label: '기본·계약' },
  { value: 'skill', label: '숙련·지역' },
  { value: 'grade', label: '등급이력' },
  { value: 'stats', label: '작업통계' },
  { value: 'settle', label: '정산' },
  { value: 'voc', label: 'VOC' },
] as const;
type Tab = (typeof TABS)[number]['value'];

function useSaver() {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<null | (() => Promise<Res>)>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const modal = (
    <ConfirmModal
      open={pending !== null}
      onCancel={() => setPending(null)}
      onConfirm={async () => {
        const fn = pending!;
        setPending(null);
        setBusy(true);
        const r = await fn();
        setBusy(false);
        if (!r.ok) {
          setFieldErrors(r.fieldErrors ?? {});
          setError(r.message ?? (r.fieldErrors ? Object.values(r.fieldErrors)[0]! : '저장하지 못했습니다.'));
          return;
        }
        setError(null);
        setFieldErrors({});
        toast(MSG.saved);
        router.refresh();
      }}
    />
  );
  return { ask: (fn: () => Promise<Res>) => setPending(() => fn), modal, error, fieldErrors, busy };
}

function Kv({ children }: { children: ReactNode }) {
  return <dl className="adm-kv">{children}</dl>;
}

export function TechnicianDetailScreen({ d, jobs, codes, branches, canUpdate }: { d: Detail; jobs: Job[]; codes: Record<string, Option[]>; branches: Option[]; canUpdate: boolean }) {
  const [tab, setTab] = useState<Tab>('basic');
  const t = d.tech;
  const L = (g: string, v: string | null | undefined) => labelOf(codes[g], v);
  return (
    <>
      <div className="adm-page-head">
        <div className="adm-detail-head">
          <h1 className="ac-h1">
            {t.name} <span className="ac-caption ac-num">{t.techCode}</span>
          </h1>
          <Tag tone="primary">{L('TECH_GRADE', t.grade)}</Tag>
          <Tag>{L('TECH_STATUS', t.status)}</Tag>
          {t.grade === 'TRAINEE' ? (
            <Tag tone="warning">
              동행 <span className="ac-num">{Math.min(t.accompanyDoneCount, t.accompanyRequiredCount)}/{t.accompanyRequiredCount}</span>
            </Tag>
          ) : null}
        </div>
        <Link href="/admin/tec/technicians" className="ac-btn ac-btn--outline">
          목록
        </Link>
      </div>
      <Tabs items={[...TABS]} value={tab} onChange={setTab} />
      <div className="adm-cus-tab">
        {tab === 'basic' ? <BasicTab d={d} codes={codes} branches={branches} canUpdate={canUpdate} /> : null}
        {tab === 'skill' ? <SkillAreaTab d={d} codes={codes} canUpdate={canUpdate} /> : null}
        {tab === 'grade' ? <GradeTab d={d} codes={codes} canUpdate={canUpdate} /> : null}
        {tab === 'stats' ? (
          <>
            <Kv>
              <dt>이번 달 배정</dt>
              <dd className="ac-num">{d.stats.month}건</dd>
              <dt>전체 배정</dt>
              <dd className="ac-num">{d.stats.total}건</dd>
              <dt>작업 완료</dt>
              <dd className="ac-num">{d.stats.completed}건</dd>
              <dt>방문 예정</dt>
              <dd className="ac-num">{d.stats.upcoming}건</dd>
              <dt>미처리</dt>
              <dd className="ac-num">{d.stats.pending}건</dd>
              <dt>평점·VOC</dt>
              <dd className="ac-num">
                {t.ratingAvg ?? '-'} · {t.vocCount}건
              </dd>
            </Kv>
            <h2 className="ac-h3">최근 90일 배정</h2>
            {jobs.length ? (
              <div className="ac-table-wrap">
                <table className="ac-table">
                  <thead>
                    <tr>
                      <th scope="col">접수번호</th>
                      <th scope="col">방문 일시</th>
                      <th scope="col">역할</th>
                      <th scope="col">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((j) => (
                      <tr key={`${j.orderId}-${j.role}`}>
                        <td className="ac-num">
                          <Link href={`/admin/ord/orders/${j.orderId}`}>{j.orderNo}</Link>
                        </td>
                        <td className="ac-num">{j.promisedAt ? formatDateTime(new Date(j.promisedAt)) : ''}</td>
                        <td>{L('ASSIGN_ROLE', j.role)}</td>
                        <td>
                          <StatusBadge code={j.status} audience="staff" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty />
            )}
          </>
        ) : null}
        {tab === 'settle' ? <Empty>정산 이력은 정산 단계(단계 7)에서 표시됩니다.</Empty> : null}
        {tab === 'voc' ? <Empty>VOC 이력은 사후관리 단계(단계 8)에서 표시됩니다.</Empty> : null}
      </div>
    </>
  );
}

function BasicTab({ d, codes, branches, canUpdate }: { d: Detail; codes: Record<string, Option[]>; branches: Option[]; canUpdate: boolean }) {
  const t = d.tech;
  const saver = useSaver();
  const router = useRouter();
  const [pii, setPii] = useState<{ phone: string; bankAccount: string } | null>(null);
  const [v, setV] = useState<Record<string, string | boolean>>({
    name: t.name,
    displayName: t.displayName ?? '',
    phone: '',
    branchId: String(t.branchId),
    contractType: t.contractType,
    status: t.status,
    joinedAt: t.joinedAt ?? '',
    leftAt: t.leftAt ?? '',
    leaveReason: t.leaveReason ?? '',
    bizRegNo: t.bizRegNo ?? '',
    licenses: t.licenses ?? '',
    bankCode: t.bankCode ?? '',
    bankAccount: '',
    accountHolder: t.accountHolder ?? '',
    hasVehicle: t.hasVehicle,
    vehicleNo: t.vehicleNo ?? '',
    insuranceJoined: t.insuranceJoined,
    intro: t.intro ?? '',
    accompanyRequiredCount: String(t.accompanyRequiredCount),
  });
  const set = (k: string) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const text = (k: string, label: string, opts: { required?: boolean; help?: string; inputMode?: 'numeric' | 'tel' } = {}) => (
    <Field label={label} required={opts.required} error={saver.fieldErrors[k]} help={opts.help}>
      {(id, desc, inv) => <Input id={id} aria-describedby={desc} aria-invalid={inv} value={String(v[k] ?? '')} onChange={set(k)} disabled={!canUpdate} inputMode={opts.inputMode} />}
    </Field>
  );
  const select = (k: string, label: string, options: Option[], required = true) => (
    <Field label={label} required={required} error={saver.fieldErrors[k]}>
      {(id, desc, inv) => (
        <Select id={id} aria-describedby={desc} aria-invalid={inv} value={String(v[k] ?? '')} onChange={set(k)} disabled={!canUpdate}>
          {!required ? <option value="">선택 안 함</option> : null}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canUpdate) saver.ask(() => saveProfile(t.id, { ...v, phone: v.phone || pii?.phone || '' }));
      }}
    >
      {saver.error ? <Alert tone="danger">{saver.error}</Alert> : null}
      <section className="adm-section">
        <h2 className="ac-h3">기본 정보</h2>
        <Kv>
          <dt>연락처</dt>
          <dd>
            {pii ? (
              <span className="ac-num">{pii.phone}</span>
            ) : (
              <Masked
                masked={t.phoneMasked}
                canView={canUpdate}
                onView={async () => {
                  const r = await viewPii(t.id);
                  if (!r.ok) return null;
                  const data = r.data as { phone: string; bankAccount: string };
                  setPii(data);
                  return data.phone;
                }}
              />
            )}
          </dd>
          <dt>기사 앱 로그인</dt>
          <dd>
            {t.hasPassword ? '비밀번호 등록됨' : '인증번호 로그인만'}
            {t.locked && canUpdate ? (
              <>
                {' '}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const r = await unlockLogin(t.id);
                    if (r.ok) router.refresh();
                  }}
                >
                  비밀번호 실패 횟수 초기화
                </Button>
              </>
            ) : null}
          </dd>
        </Kv>
        <div className="adm-form-grid adm-gap-top">
          {text('name', '이름', { required: true })}
          {text('displayName', '고객 표시 이름', { help: '동명이인 구분 (예: 김민수_A)' })}
          {canUpdate ? text('phone', '연락처 변경', { inputMode: 'tel', help: '바꿀 때만 입력합니다. 기사 앱 로그인 번호도 함께 바뀝니다.' }) : null}
          {select('branchId', '소속 거점', branches)}
          {select('contractType', '계약 형태', codes.CONTRACT_TYPE ?? [])}
          {select('status', '상태', codes.TECH_STATUS ?? [])}
          <Field label="입사일">{(id) => <Input id={id} type="date" value={String(v.joinedAt)} onChange={set('joinedAt')} disabled={!canUpdate} />}</Field>
          <Field label="이탈일">{(id) => <Input id={id} type="date" value={String(v.leftAt)} onChange={set('leftAt')} disabled={!canUpdate} />}</Field>
          {text('leaveReason', '이탈 사유')}
          {text('accompanyRequiredCount', '초기 동행 건수', { required: true, inputMode: 'numeric', help: `견습 기사 단독 배정 전 팀장 동행 건수 (완료 ${t.accompanyDoneCount}건, BR-071)` })}
        </div>
      </section>
      <section className="adm-section">
        <h2 className="ac-h3">계약·정산·자격</h2>
        <div className="adm-form-grid">
          {text('bizRegNo', '사업자번호')}
          {text('licenses', '보유 자격')}
          {text('bankCode', '정산 은행')}
          <Field label="정산 계좌" help={`현재: ${pii?.bankAccount || t.bankAccountMasked || '없음'} · 바꿀 때만 입력`} error={saver.fieldErrors.bankAccount}>
            {(id, desc) => <Input id={id} aria-describedby={desc} value={String(v.bankAccount)} onChange={set('bankAccount')} disabled={!canUpdate} inputMode="numeric" />}
          </Field>
          {text('accountHolder', '예금주')}
          {text('vehicleNo', '차량 번호')}
          <Check label="차량 보유" checked={Boolean(v.hasVehicle)} onChange={(e) => setV((s) => ({ ...s, hasVehicle: e.target.checked }))} disabled={!canUpdate} />
          <Check label="배상책임보험 가입" checked={Boolean(v.insuranceJoined)} onChange={(e) => setV((s) => ({ ...s, insuranceJoined: e.target.checked }))} disabled={!canUpdate} />
          <div className="adm-span-2">
            <Field label="고객 노출 소개">{(id) => <Textarea id={id} value={String(v.intro)} onChange={set('intro')} maxLength={300} rows={2} disabled={!canUpdate} />}</Field>
          </div>
        </div>
      </section>
      {canUpdate ? (
        <div className="adm-toolbar">
          <span />
          <Button type="submit" variant="primary" loading={saver.busy}>
            저장
          </Button>
        </div>
      ) : null}
      {saver.modal}
    </form>
  );
}

function SkillAreaTab({ d, codes, canUpdate }: { d: Detail; codes: Record<string, Option[]>; canUpdate: boolean }) {
  const skillSaver = useSaver();
  const areaSaver = useSaver();
  const devices = codes.DEVICE_TYPE ?? [];
  const levels = codes.SKILL_LEVEL ?? [];
  const [skills, setSkills] = useState<Record<string, string>>(() => Object.fromEntries(d.skills.map((s) => [s.deviceType, s.skillLevel])));
  const [areas, setAreas] = useState<Record<string, number>>(() => Object.fromEntries(d.areas.map((a) => [a.legalDongCode, a.priority])));
  const [q, setQ] = useState('');
  const shown = useMemo(() => d.branchAreas.filter((a) => !q || a.label.includes(q)), [d.branchAreas, q]);
  return (
    <>
      <section className="adm-section">
        <h2 className="ac-h3">숙련 (BR-072)</h2>
        <p className="ac-caption">숙련이 없는 기기를 배정하면 경고가 뜨고, &lsquo;보조 가능&rsquo;만 있으면 지원기사로만 배정됩니다.</p>
        {skillSaver.error ? <Alert tone="danger">{skillSaver.error}</Alert> : null}
        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">기기 유형</th>
                <th scope="col">숙련</th>
                <th scope="col">인정일</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((dv) => (
                <tr key={dv.value}>
                  <td>{dv.label}</td>
                  <td>
                    <Select
                      aria-label={`${dv.label} 숙련`}
                      value={skills[dv.value] ?? ''}
                      disabled={!canUpdate}
                      onChange={(e) => setSkills((s) => ({ ...s, [dv.value]: e.target.value }))}
                    >
                      <option value="">없음</option>
                      {levels.map((l) => (
                        <option key={l.value} value={l.value}>
                          {l.label}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="ac-num">{d.skills.find((s) => s.deviceType === dv.value)?.certifiedAt ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canUpdate ? (
          <div className="adm-toolbar">
            <span />
            <Button
              variant="outline"
              loading={skillSaver.busy}
              onClick={() =>
                skillSaver.ask(() =>
                  saveSkills({
                    technicianId: d.tech.id,
                    skills: Object.entries(skills)
                      .filter(([, lv]) => lv)
                      .map(([deviceType, skillLevel]) => ({ deviceType, skillLevel })),
                  }),
                )
              }
            >
              숙련 저장
            </Button>
          </div>
        ) : null}
        {skillSaver.modal}
      </section>
      <section className="adm-section">
        <h2 className="ac-h3">
          활동지역 <span className="ac-caption ac-num">{Object.keys(areas).length}곳</span>
        </h2>
        <p className="ac-caption">배정 보드에서 활동지역 밖 주문을 배정하면 경고가 뜹니다. 지도 관할 구역은 단계 4-2(A-DSP-060)에서 지정합니다.</p>
        {areaSaver.error ? <Alert tone="danger">{areaSaver.error}</Alert> : null}
        {d.branchAreas.length === 0 ? (
          <Empty>소속 거점에 서비스 가능 지역이 없습니다. 관할 지역 관리(A-DSP-050)에서 먼저 등록하세요.</Empty>
        ) : (
          <>
            <div className="adm-toolbar">
              <Input aria-label="지역 검색" placeholder="동 이름 검색" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="ac-table-wrap">
              <table className="ac-table">
                <thead>
                  <tr>
                    <th scope="col">지역</th>
                    <th scope="col">법정동 코드</th>
                    <th scope="col">활동지역</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((a) => (
                    <tr key={a.code}>
                      <td>{a.label}</td>
                      <td className="ac-num">{a.code}</td>
                      <td>
                        <Select
                          aria-label={`${a.label} 활동지역`}
                          value={String(areas[a.code] ?? '')}
                          disabled={!canUpdate}
                          onChange={(e) =>
                            setAreas((s) => {
                              const n = { ...s };
                              if (e.target.value) n[a.code] = Number(e.target.value);
                              else delete n[a.code];
                              return n;
                            })
                          }
                        >
                          <option value="">아님</option>
                          <option value="1">주 관할</option>
                          <option value="2">보조 관할</option>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {canUpdate && d.branchAreas.length ? (
          <div className="adm-toolbar">
            <span />
            <Button
              variant="outline"
              loading={areaSaver.busy}
              onClick={() =>
                areaSaver.ask(() => saveAreas({ technicianId: d.tech.id, areas: Object.entries(areas).map(([legalDongCode, priority]) => ({ legalDongCode, priority })) }))
              }
            >
              활동지역 저장
            </Button>
          </div>
        ) : null}
        {areaSaver.modal}
      </section>
    </>
  );
}

function GradeTab({ d, codes, canUpdate }: { d: Detail; codes: Record<string, Option[]>; canUpdate: boolean }) {
  const saver = useSaver();
  const [open, setOpen] = useState(false);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const [v, setV] = useState({ toGrade: '', reason: '', effectiveDate: today });
  const L = (g: string | null) => labelOf(codes.TECH_GRADE, g);
  return (
    <>
      <div className="adm-toolbar">
        <span className="ac-body">
          현재 등급 <Tag tone="primary">{L(d.tech.grade)}</Tag>
        </span>
        {canUpdate ? (
          <Button variant="outline" onClick={() => setOpen(true)}>
            등급 변경
          </Button>
        ) : null}
      </div>
      {saver.error ? <Alert tone="danger">{saver.error}</Alert> : null}
      {d.grades.length ? (
        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">적용일</th>
                <th scope="col">변경</th>
                <th scope="col">사유</th>
                <th scope="col">승인자</th>
                <th scope="col">등록 일시</th>
              </tr>
            </thead>
            <tbody>
              {d.grades.map((g) => (
                <tr key={g.id}>
                  <td className="ac-num">{g.effectiveDate}</td>
                  <td>
                    {g.fromGrade ? `${L(g.fromGrade)} → ` : ''}
                    {L(g.toGrade)}
                  </td>
                  <td>{g.reason}</td>
                  <td>{g.approver ?? ''}</td>
                  <td className="ac-num">{formatDateTime(new Date(g.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty />
      )}
      <Modal
        open={open}
        title="등급 변경"
        description="견습 → 정식 → 팀장 승급 등. 변경 이력은 수정·삭제할 수 없습니다."
        onClose={() => setOpen(false)}
        form
        actions={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              닫기
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setOpen(false);
                saver.ask(() => changeGrade({ technicianId: String(d.tech.id), ...v }));
              }}
            >
              변경
            </Button>
          </>
        }
      >
        <div className="adm-csl-modal-body">
          <Field label="변경 등급" required>
            {(id) => (
              <Select id={id} value={v.toGrade} onChange={(e) => setV((s) => ({ ...s, toGrade: e.target.value }))}>
                <option value="">선택</option>
                {(codes.TECH_GRADE ?? [])
                  .filter((o) => o.value !== d.tech.grade)
                  .map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field label="변경 사유" required>
            {(id) => <Textarea id={id} value={v.reason} onChange={(e) => setV((s) => ({ ...s, reason: e.target.value }))} maxLength={200} rows={2} />}
          </Field>
          <Field label="적용일" required>
            {(id) => <Input id={id} type="date" value={v.effectiveDate} onChange={(e) => setV((s) => ({ ...s, effectiveDate: e.target.value }))} />}
          </Field>
        </div>
      </Modal>
      {saver.modal}
    </>
  );
}
