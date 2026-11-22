'use client';
/**
 * 관리자 목록형 화면 공통 틀 (03 §4.1 목록형: 검색 영역 / 결과 그리드 / 등록·수정 모달).
 * - 검색 영역 Enter = 조회, 그리드 더블클릭 = 상세(수정 모달)   (03 §6.2)
 * - 저장 전 Confirm "저장하시겠습니까?", 저장 후 Toast "저장에 성공하였습니다.", 필수 누락 "○○은(는) 필수 입력값입니다."
 */
import { Alert, Button, ConfirmModal, Empty, Field, Input, MSG, Modal, Select, Textarea, useToast } from '@aircon/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useMemo, useRef, useState } from 'react';

export type ActionResult = { ok: true; data?: unknown } | { ok: false; message?: string; fieldErrors?: Record<string, string> };
export type Option = { value: string; label: string };

export interface FieldDef {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'select' | 'checkbox' | 'textarea' | 'date' | 'time' | 'json' | 'password' | 'email';
  required?: boolean;
  options?: Option[];
  /** select 빈 선택지 문구(없으면 빈 선택지 없음) */
  emptyOption?: string;
  help?: string;
  span2?: boolean;
  /** 수정 시 변경 불가 (코드·ID 등) */
  lockOnEdit?: boolean;
  createOnly?: boolean;
  editOnly?: boolean;
  inputMode?: 'numeric' | 'tel' | 'decimal';
}

export interface ColumnDef<T> {
  header: string;
  cell: (row: T) => ReactNode;
  num?: boolean;
}

export interface FilterDef<T> {
  name: string;
  label: string;
  options?: Option[];
  match: (row: T, value: string) => boolean;
}

export type FormValues = Record<string, unknown>;

export interface CrudScreenProps<T> {
  title: string;
  /** 등록 버튼 문구에 쓰는 대상 이름 (예: 거점) */
  noun: string;
  rows: T[];
  rowKey: (row: T) => string | number;
  columns: ColumnDef<T>[];
  fields: FieldDef[];
  filters?: FilterDef<T>[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  toForm: (row: T) => FormValues;
  defaults?: FormValues;
  save: (values: Record<string, string>, id: string | null) => Promise<ActionResult>;
  remove?: (id: string) => Promise<ActionResult>;
  /** 수정 모달을 열 때 상세를 다시 불러와야 할 때(개인정보 원문 열람 등) */
  loadDetail?: (row: T) => Promise<FormValues | null>;
  rowClassName?: (row: T) => string | undefined;
  toolbarExtra?: ReactNode;
  headerExtra?: ReactNode;
}

export function CrudScreen<T>(p: CrudScreenProps<T>) {
  const router = useRouter();
  const toast = useToast();
  const [filterInput, setFilterInput] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ id: string | null; values: FormValues } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'save' | 'delete'>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const pending = useRef<Record<string, string>>({});

  const visibleRows = useMemo(
    () =>
      p.rows.filter((r) =>
        (p.filters ?? []).every((f) => {
          const v = applied[f.name];
          return !v || f.match(r, v);
        }),
      ),
    [p.rows, p.filters, applied],
  );

  const open = async (row: T | null) => {
    setErrors({});
    setFormError(null);
    if (!row) {
      setEditing({ id: null, values: p.defaults ?? {} });
      return;
    }
    const values = p.loadDetail ? await p.loadDetail(row) : p.toForm(row);
    if (values) setEditing({ id: String(p.rowKey(row)), values });
  };

  const isEdit = editing?.id != null;
  const readOnly = isEdit ? !p.canUpdate : !p.canCreate;
  const activeFields = p.fields.filter((f) => (isEdit ? !f.createOnly : !f.editOnly));

  const collect = (): Record<string, string> => {
    const form = formRef.current!;
    const out: Record<string, string> = {};
    for (const f of activeFields) {
      const el = form.elements.namedItem(f.name) as HTMLInputElement | null;
      if (!el) continue;
      out[f.name] = f.type === 'checkbox' ? String(el.checked) : el.value;
    }
    return out;
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const values = collect();
    const missing: Record<string, string> = {};
    for (const f of activeFields) if (f.required && f.type !== 'checkbox' && !values[f.name]?.trim()) missing[f.name] = MSG.required(f.label);
    setErrors(missing);
    if (Object.keys(missing).length) {
      const first = activeFields.find((f) => missing[f.name]);
      (formRef.current?.elements.namedItem(first!.name) as HTMLElement | null)?.focus();
      return;
    }
    pending.current = values;
    setConfirm('save');
  };

  const run = async (kind: 'save' | 'delete') => {
    setConfirm(null);
    setBusy(true);
    try {
      const res =
        kind === 'save' ? await p.save(pending.current, editing?.id ?? null) : await p.remove!(editing!.id!);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.message ?? res.fieldErrors?._ ?? null);
        return;
      }
      setEditing(null);
      toast(kind === 'save' ? MSG.saved : MSG.deleted);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="adm-page-head">
        <h1 className="ac-h2">{p.title}</h1>
        {p.headerExtra}
      </div>

      {p.filters?.length ? (
        <form
          className="ac-search-panel"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(filterInput);
          }}
        >
          {p.filters.map((f) => (
            <Field key={f.name} label={f.label}>
              {(id) =>
                f.options ? (
                  <Select id={id} value={filterInput[f.name] ?? ''} onChange={(e) => setFilterInput({ ...filterInput, [f.name]: e.target.value })}>
                    <option value="">전체</option>
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input id={id} value={filterInput[f.name] ?? ''} onChange={(e) => setFilterInput({ ...filterInput, [f.name]: e.target.value })} />
                )
              }
            </Field>
          ))}
          <div className="ac-search-panel__actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilterInput({});
                setApplied({});
              }}
            >
              초기화
            </Button>
            <Button type="submit" variant="primary" size="sm">
              조회
            </Button>
          </div>
        </form>
      ) : null}

      <div className="adm-toolbar">
        <span className="ac-body-sm">
          총 <strong className="ac-num">{visibleRows.length.toLocaleString()}</strong>건
        </span>
        <div className="ac-row">
          {p.toolbarExtra}
          {p.canCreate ? (
            <Button size="sm" onClick={() => open(null)}>
              {p.noun} 등록
            </Button>
          ) : null}
        </div>
      </div>

      {visibleRows.length === 0 ? (
        <Empty />
      ) : (
        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                {p.columns.map((c) => (
                  <th key={c.header} className={c.num ? 'is-num' : undefined} scope="col">
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => (
                <tr
                  key={p.rowKey(r)}
                  className={p.rowClassName?.(r)}
                  onDoubleClick={() => open(r)}
                  onKeyDown={(e) => e.key === 'Enter' && open(r)}
                  tabIndex={0}
                  aria-label={`${p.noun} 상세 열기`}
                >
                  {p.columns.map((c) => (
                    <td key={c.header} className={c.num ? 'is-num' : undefined}>
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={editing !== null} form title={`${p.noun} ${isEdit ? (readOnly ? '상세' : '수정') : '등록'}`} onClose={() => setEditing(null)}>
        {editing ? (
          <form ref={formRef} onSubmit={onSubmit} noValidate>
            {formError ? <Alert tone="danger">{formError}</Alert> : null}
            <fieldset disabled={readOnly || busy} style={{ border: 0, padding: 0, margin: 0 }}>
              <div className="adm-form-grid">
                {activeFields.map((f) => (
                  <div key={f.name} className={f.span2 || f.type === 'textarea' || f.type === 'json' ? 'adm-span-2' : undefined}>
                    <FieldInput def={f} value={editing.values[f.name]} error={errors[f.name]} locked={isEdit && f.lockOnEdit} />
                  </div>
                ))}
              </div>
            </fieldset>
            <div className="ac-modal__actions">
              {isEdit && p.canDelete && p.remove ? (
                <Button variant="outline" onClick={() => setConfirm('delete')} disabled={busy}>
                  삭제
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => setEditing(null)}>
                닫기
              </Button>
              {!readOnly ? (
                <Button type="submit" variant="primary" loading={busy}>
                  저장
                </Button>
              ) : null}
            </div>
          </form>
        ) : null}
      </Modal>

      <ConfirmModal open={confirm === 'save'} onConfirm={() => run('save')} onCancel={() => setConfirm(null)} />
      <ConfirmModal
        open={confirm === 'delete'}
        message={MSG.confirmDelete}
        confirmLabel="삭제"
        danger
        onConfirm={() => run('delete')}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

function FieldInput({ def, value, error, locked }: { def: FieldDef; value: FormValues[string]; error?: string; locked?: boolean }) {
  const str = value === null || value === undefined ? '' : String(value);
  if (def.type === 'checkbox') {
    return (
      <label className="ac-check">
        <input type="checkbox" name={def.name} defaultChecked={value === true || value === 'true'} />
        <span>{def.label}</span>
      </label>
    );
  }
  return (
    <Field label={def.label} required={def.required} error={error} help={def.help}>
      {(id, d, inv) => {
        const common = { id, name: def.name, 'aria-describedby': d, 'aria-invalid': inv, defaultValue: str, readOnly: locked };
        if (def.type === 'select') {
          return (
            <Select {...common} disabled={locked}>
              {def.emptyOption !== undefined || !def.required ? <option value="">{def.emptyOption ?? '선택'}</option> : null}
              {def.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          );
        }
        if (def.type === 'textarea' || def.type === 'json') return <Textarea {...common} rows={def.type === 'json' ? 3 : 4} spellCheck={def.type !== 'json'} />;
        return (
          <Input
            {...common}
            type={def.type === 'number' ? 'text' : (def.type ?? 'text')}
            inputMode={def.inputMode ?? (def.type === 'number' ? 'numeric' : undefined)}
            autoComplete={def.type === 'password' ? 'new-password' : undefined}
          />
        );
      }}
    </Field>
  );
}

/** 코드값 → 표시명 */
export const labelOf = (options: Option[] | undefined, code: string | null | undefined) =>
  code == null ? '' : (options?.find((o) => o.value === code)?.label ?? code);

export const won = (n: number | null | undefined) => (n == null ? '' : `${n.toLocaleString()}원`);
