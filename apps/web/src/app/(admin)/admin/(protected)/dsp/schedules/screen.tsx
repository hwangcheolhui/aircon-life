'use client';
import { Alert, Button, Check, ConfirmModal, Empty, Field, Input, MSG, Modal, Select, useToast } from '@aircon/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type Option, labelOf } from '@/admin/crud-screen';
import { saveSchedules } from './actions';

interface Tech {
  id: number;
  techCode: string;
  name: string;
  branchName: string;
  status: string;
}
interface Sched {
  technicianId: number;
  workDate: string;
  scheduleType: string;
  startTime: string | null;
  endTime: string | null;
}
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

export function SchedulesScreen(p: {
  from: string;
  prev: string;
  next: string;
  dates: string[];
  techs: Tech[];
  schedules: Sched[];
  codes: Record<string, Option[]>;
  canUpdate: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const types = p.codes.SCHEDULE_TYPE ?? [];
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    technicianIds: [] as number[],
    dateFrom: p.dates[0]!,
    dateTo: p.dates[6]!,
    weekdays: [1, 2, 3, 4, 5],
    scheduleType: 'WORK',
    startTime: '',
    endTime: '',
    note: '',
  });
  const cell = (t: number, d: string) => p.schedules.find((s) => s.technicianId === t && s.workDate === d);
  const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

  const save = async () => {
    setConfirm(false);
    setBusy(true);
    const r = await saveSchedules({ ...form, maxJobs: '', startTime: form.startTime || null, endTime: form.endTime || null });
    setBusy(false);
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      return setMessage(r.message ?? null);
    }
    setOpen(false);
    toast(MSG.saved);
    router.refresh();
  };

  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">기사 근무 일정</h1>
        <div className="ac-row">
          <Link className="ac-btn ac-btn--ghost ac-btn--sm" href={`/admin/dsp/schedules?from=${p.prev}`}>
            이전 2주
          </Link>
          <Link className="ac-btn ac-btn--ghost ac-btn--sm" href={`/admin/dsp/schedules?from=${p.next}`}>
            다음 2주
          </Link>
          {p.canUpdate ? (
            <Button size="sm" onClick={() => (setErrors({}), setMessage(null), setOpen(true))}>
              일정 일괄 등록
            </Button>
          ) : null}
        </div>
      </div>
      <p className="ac-body-sm">일정을 저장하면 그 기간의 운영 슬롯 수용 건수가 자동으로 다시 계산됩니다. 일정이 없는 날은 슬롯이 만들어지지 않습니다.</p>
      {p.techs.length === 0 ? (
        <Empty>등록된 기사가 없습니다. 기사 목록(A-TEC-010)에서 먼저 등록하세요.</Empty>
      ) : (
        <div className="ac-table-wrap">
          <table className="ac-table adm-schedule-grid">
            <thead>
              <tr>
                <th scope="col">기사</th>
                {p.dates.map((d) => (
                  <th key={d} scope="col" className="ac-num">
                    {d.slice(5)}
                    <br />
                    {WEEK[dow(d)]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.techs.map((t) => (
                <tr key={t.id}>
                  <td>
                    {t.name} <span className="ac-caption ac-num">{t.techCode}</span>
                    <br />
                    <span className="ac-caption">
                      {t.branchName}
                      {t.status !== 'ACTIVE' ? ` · ${labelOf(p.codes.TECH_STATUS, t.status)}` : ''}
                    </span>
                  </td>
                  {p.dates.map((d) => {
                    const s = cell(t.id, d);
                    return (
                      <td key={d} title={s?.startTime ? `${s.startTime.slice(0, 5)}~${s.endTime?.slice(0, 5)}` : undefined}>
                        {s ? labelOf(types, s.scheduleType) : '–'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={open} form title="근무 일정 일괄 등록" onClose={() => setOpen(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const miss: Record<string, string> = {};
            if (form.technicianIds.length === 0) miss.technicianIds = MSG.required('기사');
            if (form.weekdays.length === 0) miss.weekdays = MSG.required('요일');
            setErrors(miss);
            if (Object.keys(miss).length === 0) setConfirm(true);
          }}
          noValidate
        >
          {message ? <Alert tone="danger">{message}</Alert> : null}
          <div className="adm-form-grid">
            <div className="adm-span-2">
              <Field label="기사" required error={errors.technicianIds}>
                {() => (
                  <div className="ac-row" style={{ flexWrap: 'wrap' }}>
                    {p.techs.map((t) => (
                      <Check
                        key={t.id}
                        label={`${t.name}(${t.techCode})`}
                        checked={form.technicianIds.includes(t.id)}
                        onChange={(e) =>
                          setForm({ ...form, technicianIds: e.target.checked ? [...form.technicianIds, t.id] : form.technicianIds.filter((x) => x !== t.id) })
                        }
                      />
                    ))}
                  </div>
                )}
              </Field>
            </div>
            <Field label="시작일" required error={errors.dateFrom}>
              {(id) => <Input id={id} type="date" value={form.dateFrom} onChange={(e) => setForm({ ...form, dateFrom: e.target.value })} />}
            </Field>
            <Field label="종료일" required error={errors.dateTo}>
              {(id) => <Input id={id} type="date" value={form.dateTo} onChange={(e) => setForm({ ...form, dateTo: e.target.value })} />}
            </Field>
            <div className="adm-span-2">
              <Field label="요일" required error={errors.weekdays}>
                {() => (
                  <div className="ac-row">
                    {WEEK.map((w, i) => (
                      <Check
                        key={w}
                        label={w}
                        checked={form.weekdays.includes(i)}
                        onChange={(e) => setForm({ ...form, weekdays: e.target.checked ? [...form.weekdays, i] : form.weekdays.filter((x) => x !== i) })}
                      />
                    ))}
                  </div>
                )}
              </Field>
            </div>
            <Field label="근무 유형" required error={errors.scheduleType}>
              {(id) => (
                <Select id={id} value={form.scheduleType} onChange={(e) => setForm({ ...form, scheduleType: e.target.value })}>
                  {types.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="메모" error={errors.note}>
              {(id) => <Input id={id} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={200} />}
            </Field>
            <Field label="근무 시작" error={errors.startTime} help="비우면 기본 근무 시간(시스템 기준값)">
              {(id) => <Input id={id} type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />}
            </Field>
            <Field label="근무 종료" error={errors.endTime}>
              {(id) => <Input id={id} type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />}
            </Field>
          </div>
          <div className="ac-modal__actions">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              닫기
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              저장
            </Button>
          </div>
        </form>
      </Modal>
      <ConfirmModal open={confirm} onConfirm={save} onCancel={() => setConfirm(false)} />
    </div>
  );
}
