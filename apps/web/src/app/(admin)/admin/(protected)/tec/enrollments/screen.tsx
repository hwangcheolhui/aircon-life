'use client';
// A-TEC-041 수강·수료 관리 (F-ADM-TEC-06): 과정 전환, 수강 등록, 행별 출석률·실습 점수 입력 후 [저장]·[판정]·[중도 포기]
import { Alert, Button, ConfirmModal, Empty, Field, Input, MSG, Select, Tag, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf, won } from '@/admin/crud-screen';
import type { listEnrollments } from '@/server/training';
import { addEnrollmentAction, scoreEnrollmentAction } from './actions';

type Row = NonNullable<Awaited<ReturnType<typeof listEnrollments>>>['rows'][number];
const TONE: Record<string, 'primary' | 'success' | 'warning' | 'danger' | undefined> = { ENROLLED: 'primary', PASSED: 'success', FAILED: 'danger', DROPPED: 'warning' };

export function EnrollmentsScreen(p: {
  course: { id: number; code: string; name: string; courseType: string; status: string; fee: number; capacity: number | null };
  courses: Option[];
  rows: Row[];
  techs: Option[];
  codes: Record<string, Option[]>;
  passNote: string;
  canCreate: boolean;
  canUpdate: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [add, setAdd] = useState({ technicianId: '', paidAmount: String(p.course.fee) });
  const [scores, setScores] = useState<Record<number, { attendanceRate: string; practicalScore: string }>>({});
  // 입력 중인 값이 없으면 저장된 값을 보여 준다 (새로 등록한 수강생 행도 바로 입력 가능)
  const scoreOf = (r: Row) => scores[r.id] ?? { attendanceRate: r.attendanceRate == null ? '' : String(r.attendanceRate), practicalScore: r.practicalScore == null ? '' : String(r.practicalScore) };
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'ADD' } | { kind: 'SAVE' | 'JUDGE' | 'DROP'; row: Row } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const c = confirm!;
    setConfirm(null);
    setBusy(true);
    setError(null);
    const r = c.kind === 'ADD' ? await addEnrollmentAction({ courseId: String(p.course.id), ...add }) : await scoreEnrollmentAction({ id: String(c.row.id), ...scoreOf(c.row), action: c.kind });
    setBusy(false);
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      return setError(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? null);
    }
    setErrors({});
    if (c.kind === 'ADD') setAdd({ technicianId: '', paidAmount: String(p.course.fee) });
    const d = r.data as { result?: string; certificateNo?: string | null; activated?: boolean } | undefined;
    toast(
      c.kind === 'JUDGE' && d?.result
        ? `${labelOf(p.codes.ENROLLMENT_RESULT, d.result)} 처리했습니다.${d.certificateNo ? ` 수료증 ${d.certificateNo}` : ''}${d.activated ? ' 기사가 활동 상태가 됐습니다.' : ''}`
        : MSG.saved,
    );
    router.refresh();
  };

  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">수강·수료 관리</h1>
        <p className="ac-caption">{p.passNote}</p>
      </div>
      <div className="ac-search-panel">
        <Field label="과정">
          {(id) => (
            <Select id={id} value={String(p.course.id)} onChange={(e) => router.push(`/admin/tec/enrollments?courseId=${e.target.value}`)}>
              {p.courses.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <p className="ac-body-sm">
          {labelOf(p.codes.COURSE_TYPE, p.course.courseType)} · {labelOf(p.codes.COURSE_STATUS, p.course.status)} · 수강료 <span className="ac-num">{won(p.course.fee)}</span> · 정원{' '}
          <span className="ac-num">{p.course.capacity ?? '-'}</span>
        </p>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {p.canCreate ? (
        <form
          className="adm-toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            if (!add.technicianId) return setErrors({ technicianId: MSG.required('기사') });
            setConfirm({ kind: 'ADD' });
          }}
        >
          <div className="ac-row">
            <Field label="기사" required error={errors.technicianId}>
              {(id, d, inv) => (
                <Select id={id} aria-describedby={d} aria-invalid={inv} value={add.technicianId} onChange={(e) => setAdd({ ...add, technicianId: e.target.value })}>
                  <option value="">선택</option>
                  {p.techs.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="납부액(원)" required error={errors.paidAmount}>
              {(id, d, inv) => <Input id={id} aria-describedby={d} aria-invalid={inv} inputMode="numeric" value={add.paidAmount} onChange={(e) => setAdd({ ...add, paidAmount: e.target.value })} />}
            </Field>
          </div>
          <Button type="submit" size="sm" loading={busy}>
            수강 등록
          </Button>
        </form>
      ) : null}
      <div className="adm-toolbar">
        <span className="ac-body-sm">
          총 <strong className="ac-num">{p.rows.length}</strong>명
        </span>
      </div>
      {p.rows.length ? (
        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                <th scope="col">결과</th>
                <th scope="col">기사</th>
                <th scope="col">기사 상태</th>
                <th scope="col" className="is-num">
                  납부액
                </th>
                <th scope="col" className="is-num">
                  출석률(%)
                </th>
                <th scope="col" className="is-num">
                  실습(점)
                </th>
                <th scope="col">수료증</th>
                <th scope="col">처리</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => {
                const s = scoreOf(r);
                const open = r.result === 'ENROLLED' && p.canUpdate;
                const set = (k: 'attendanceRate' | 'practicalScore') => (e: { target: { value: string } }) => setScores({ ...scores, [r.id]: { ...s, [k]: e.target.value } });
                return (
                  <tr key={r.id}>
                    <td>
                      <Tag tone={TONE[r.result]}>{labelOf(p.codes.ENROLLMENT_RESULT, r.result)}</Tag>
                    </td>
                    <td>
                      {r.techName} <span className="ac-caption ac-num">{r.techCode}</span>
                    </td>
                    <td>{labelOf(p.codes.TECH_STATUS, r.techStatus)}</td>
                    <td className="is-num ac-num">{won(r.paidAmount)}</td>
                    <td className="is-num">
                      {open ? <Input aria-label={`${r.techName} 출석률`} inputMode="decimal" className="adm-num-input" value={s.attendanceRate} onChange={set('attendanceRate')} /> : <span className="ac-num">{r.attendanceRate ?? '-'}</span>}
                    </td>
                    <td className="is-num">
                      {open ? <Input aria-label={`${r.techName} 실습 점수`} inputMode="numeric" className="adm-num-input" value={s.practicalScore} onChange={set('practicalScore')} /> : <span className="ac-num">{r.practicalScore ?? '-'}</span>}
                    </td>
                    <td className="ac-num">{r.certificateNo ?? ''}</td>
                    <td>
                      {open ? (
                        <div className="ac-row">
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirm({ kind: 'SAVE', row: r })}>
                            저장
                          </Button>
                          <Button size="sm" variant="dark" disabled={busy} onClick={() => setConfirm({ kind: 'JUDGE', row: r })}>
                            판정
                          </Button>
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm({ kind: 'DROP', row: r })}>
                            중도 포기
                          </Button>
                        </div>
                      ) : (
                        <span className="ac-num">{r.completedAt ?? ''}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty />
      )}
      <ConfirmModal
        open={confirm !== null}
        message={confirm?.kind === 'JUDGE' ? '수료 여부를 판정하시겠습니까?' : confirm?.kind === 'DROP' ? '중도 포기로 처리하시겠습니까?' : MSG.confirmSave}
        description={confirm?.kind === 'JUDGE' ? '판정 후에는 점수를 고칠 수 없습니다.' : undefined}
        confirmLabel={confirm?.kind === 'JUDGE' ? '판정' : confirm?.kind === 'DROP' ? '중도 포기' : confirm?.kind === 'ADD' ? '등록' : '저장'}
        danger={confirm?.kind === 'DROP'}
        onCancel={() => setConfirm(null)}
        onConfirm={run}
      />
    </div>
  );
}
