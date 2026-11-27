'use client';
// A-CRM-010 재방문 자동 캠페인 (F-ADM-CRM-01): 규칙·동봉 쿠폰 저장 전 확인, 대상 미리보기(고객번호만, BR-100), 최근 90일 성과
import { Alert, Button, Card, Check, ConfirmModal, Empty, Field, MSG, Select, Tag, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf } from '@/admin/crud-screen';
import { formatDateTime } from '@/customer/format';
import type { revisitOverview } from '@/server/crm';
import { saveRevisitAction } from './actions';

type D = Awaited<ReturnType<typeof revisitOverview>>;

export function RevisitScreen({ d, codes, branches, coupons, canUpdate }: { d: D; codes: Record<string, Option[]>; branches: { id: number; name: string }[]; coupons: Option[]; canUpdate: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [running, setRunning] = useState(d.campaign.running);
  const [ids, setIds] = useState<number[]>(d.campaign.branchIds);
  const [couponId, setCouponId] = useState(d.campaign.couponId ? String(d.campaign.couponId) : '');
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setConfirm(false);
    const r = await saveRevisitAction({ running, branchIds: ids, couponId });
    if (!r.ok) return setError(r.message ?? '저장하지 못했습니다.');
    toast(MSG.saved);
    router.refresh();
  };
  const rate = d.perf.sent ? Math.round((d.perf.converted / d.perf.sent) * 1000) / 10 : null;
  return (
    <div className="ac-stack">
      <div className="adm-page-head">
        <h1 className="ac-h2">재방문 자동 캠페인</h1>
        {d.campaign.running ? <Tag tone="success">실행 중</Tag> : <Tag>중지</Tag>}
      </div>
      <Card>
        <h2 className="ac-h3">자동 규칙</h2>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <p className="ac-body-sm">
          매일 오전 10시, 마지막 작업 후 <strong className="ac-num">{d.months}</strong>개월이 지난(최근 작업일 {d.cutoff} 이전) 마케팅 수신 동의 고객에게 재방문 안내 알림톡을 보냅니다. 진행 중인 예약이
          있거나 이번 작업 주기에 이미 받은 고객, 동의를 철회한 고객은 빠집니다. 기준 개월은 시스템 설정(REVISIT_MONTHS)에서 바꿉니다.
        </p>
        <fieldset className="adm-fieldset" disabled={!canUpdate}>
          <Check label="자동 발송 실행" checked={running} onChange={(e) => setRunning(e.target.checked)} />
          <p className="ac-label adm-gap-top">대상 거점 (선택하지 않으면 전체)</p>
          <div className="ac-row">
            {branches.map((b) => (
              <Check key={b.id} label={b.name} checked={ids.includes(b.id)} onChange={(e) => setIds(e.target.checked ? [...ids, b.id] : ids.filter((x) => x !== b.id))} />
            ))}
          </div>
          <Field label="동봉 쿠폰" help="고르면 안내와 함께 쿠폰을 발급합니다. 쿠폰은 쿠폰 관리에서 만듭니다.">
            {(id, d) => (
              <Select id={id} aria-describedby={d} value={couponId} onChange={(e) => setCouponId(e.target.value)}>
                <option value="">없음</option>
                {coupons.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </fieldset>
        <div className="adm-toolbar">
          <span />
          <Button variant="primary" disabled={!canUpdate} onClick={() => setConfirm(true)}>
            저장
          </Button>
        </div>
      </Card>
      <div className="adm-stat-grid">
        {[
          { label: '오늘 대상(미리보기)', value: `${d.previewCount.toLocaleString()}명` },
          { label: '최근 90일 발송', value: `${d.perf.sent.toLocaleString()}건` },
          { label: '발송 실패', value: `${d.perf.failed.toLocaleString()}건` },
          { label: '예약 전환', value: `${d.perf.converted.toLocaleString()}건` },
          { label: '전환율', value: rate === null ? '-' : `${rate}%` },
        ].map((c) => (
          <section key={c.label} className="ac-card adm-stat">
            <span className="adm-stat__label">{c.label}</span>
            <span className="adm-stat__value ac-num">{c.value}</span>
          </section>
        ))}
      </div>
      <div className="adm-two-col">
        <Card>
          <h2 className="ac-h3">오늘 대상 미리보기</h2>
          {d.preview.length === 0 ? (
            <Empty />
          ) : (
            <table className="ac-table">
              <thead>
                <tr>
                  <th scope="col">고객번호</th>
                  <th scope="col">거점</th>
                  <th scope="col">최근 작업일</th>
                  <th scope="col" className="is-num">경과</th>
                </tr>
              </thead>
              <tbody>
                {d.preview.map((t) => (
                  <tr key={t.id}>
                    <td className="ac-num">{t.customerNo}</td>
                    <td>{t.branchName ?? '-'}</td>
                    <td className="ac-num">{t.lastServiceDate}</td>
                    <td className="is-num ac-num">{t.monthsAgo}개월</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card>
          <h2 className="ac-h3">최근 발송</h2>
          {d.recent.length === 0 ? (
            <Empty />
          ) : (
            <table className="ac-table">
              <thead>
                <tr>
                  <th scope="col">고객번호</th>
                  <th scope="col">발송 일시</th>
                  <th scope="col">결과</th>
                  <th scope="col">전환 접수번호</th>
                </tr>
              </thead>
              <tbody>
                {d.recent.map((t) => (
                  <tr key={t.id}>
                    <td className="ac-num">{t.customerNo}</td>
                    <td className="ac-num">{t.sentAt ? formatDateTime(new Date(t.sentAt)) : '-'}</td>
                    <td>
                      <Tag tone={t.status === 'CONVERTED' ? 'success' : t.status === 'FAILED' ? 'danger' : undefined}>{labelOf(codes.CAMPAIGN_TARGET_STATUS, t.status)}</Tag>
                    </td>
                    <td className="ac-num">{t.orderNo ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
      <ConfirmModal open={confirm} onConfirm={save} onCancel={() => setConfirm(false)} />
    </div>
  );
}
