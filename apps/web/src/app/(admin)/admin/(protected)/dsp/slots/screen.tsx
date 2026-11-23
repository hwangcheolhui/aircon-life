'use client';
import { Alert, Button, Field, Input, Modal, Select, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CrudScreen, type Option, labelOf } from '@/admin/crud-screen';
import { regenerateSlots, saveSlot } from './actions';

interface Row {
  id: number;
  branchId: number;
  branchName: string;
  slotDate: string;
  slotHour: number;
  slotKind: string;
  capacity: number;
  bookedCount: number;
  isClosed: boolean;
  remaining: number;
}

export function SlotsScreen(p: { rows: Row[]; dates: string[]; branches: Option[]; kinds: Option[]; canCreate: boolean; canUpdate: boolean; canDelete: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ branchId: p.branches[0]?.value ?? '', dateFrom: p.dates[1] ?? p.dates[0] ?? '', dateTo: p.dates[p.dates.length - 1] ?? '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dateOptions = p.dates.map((d) => ({ value: d, label: d }));
  return (
    <>
      <CrudScreen<Row>
        title="운영 슬롯 관리"
        noun="슬롯"
        rows={p.rows}
        rowKey={(r) => r.id}
        canCreate={false}
        canUpdate={p.canUpdate}
        canDelete={false}
        rowClassName={(r) => (r.isClosed ? 'adm-slot-closed' : undefined)}
        filters={[
          { name: 'branchId', label: '거점', options: p.branches, match: (r, v) => String(r.branchId) === v },
          { name: 'date', label: '날짜', options: dateOptions, match: (r, v) => r.slotDate === v },
          { name: 'kind', label: '구분', options: p.kinds, match: (r, v) => r.slotKind === v },
        ]}
        columns={[
          { header: '거점', cell: (r) => r.branchName },
          { header: '날짜', cell: (r) => <span className="ac-num">{r.slotDate}</span> },
          { header: '시간', cell: (r) => <span className="ac-num">{`${String(r.slotHour).padStart(2, '0')}:00`}</span> },
          { header: '구분', cell: (r) => labelOf(p.kinds, r.slotKind) },
          { header: '수용', num: true, cell: (r) => r.capacity },
          { header: '예약', num: true, cell: (r) => r.bookedCount },
          { header: '잔여', num: true, cell: (r) => r.remaining },
          { header: '마감', cell: (r) => (r.isClosed ? '마감' : '') },
        ]}
        toForm={(r) => ({ capacity: String(r.capacity), isClosed: r.isClosed })}
        fields={[
          { name: 'capacity', label: '수용 건수', type: 'number', required: true, help: '예약된 건수보다 작게 줄일 수 없습니다.' },
          { name: 'isClosed', label: '마감 (고객 예약 막기)', type: 'checkbox' },
        ]}
        save={saveSlot}
        toolbarExtra={
          p.canUpdate ? (
            <Button size="sm" onClick={() => setOpen(true)}>
              근무표로 재계산
            </Button>
          ) : null
        }
      />
      <Modal
        open={open}
        form
        title="근무표로 슬롯 재계산"
        description="기간 안의 슬롯 수용 건수를 근무표(활동 기사 수 × 시간당 처리량)에 맞춥니다. 예약된 건수 아래로는 줄이지 않습니다."
        onClose={() => setOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              닫기
            </Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const r = await regenerateSlots(form);
                setBusy(false);
                if (!r.ok) return setError(r.message ?? Object.values(r.fieldErrors ?? {})[0] ?? '재계산하지 못했습니다.');
                setOpen(false);
                toast(`재계산했습니다 (${(r.data as { changed: number }).changed}칸 변경).`);
                router.refresh();
              }}
            >
              재계산
            </Button>
          </>
        }
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="adm-form-grid">
          <Field label="거점" required>
            {(id) => (
              <Select id={id} value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
                {p.branches.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div />
          <Field label="시작일" required>
            {(id) => <Input id={id} type="date" value={form.dateFrom} onChange={(e) => setForm({ ...form, dateFrom: e.target.value })} />}
          </Field>
          <Field label="종료일" required>
            {(id) => <Input id={id} type="date" value={form.dateTo} onChange={(e) => setForm({ ...form, dateTo: e.target.value })} />}
          </Field>
        </div>
      </Modal>
    </>
  );
}
