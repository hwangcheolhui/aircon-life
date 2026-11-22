'use client';
/**
 * components.css 의 ac- 클래스를 그대로 감싼 React 컴포넌트 (CLAUDE.md §8: 같은 클래스명·변형 이름 유지).
 */
import { CheckCircle2, Inbox } from 'lucide-react';
import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { MSG } from '@aircon/domain';
import { statusBadgeInfo } from './status';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/* ---------- Button ---------- */
export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'dark' | 'danger' | 'text';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  block?: boolean;
  loading?: boolean;
  /** 아이콘 전용 버튼이면 aria-label 필수 */
  icon?: boolean;
}
export function Button({ variant = 'secondary', size = 'md', block, loading, icon, className, children, disabled, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      className={cx('ac-btn', `ac-btn--${variant}`, size !== 'md' && `ac-btn--${size}`, block && 'ac-btn--block', icon && 'ac-btn--icon', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="ac-spinner" aria-hidden /> : null}
      {children}
    </button>
  );
}

/* ---------- Field / inputs ---------- */
export interface FieldProps {
  label: string;
  required?: boolean;
  error?: string | null;
  help?: string;
  children: (id: string, describedBy: string | undefined, invalid: boolean) => ReactNode;
}
export function Field({ label, required, error, help, children }: FieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const msg = error ?? help;
  return (
    <div className={cx('ac-field', error && 'ac-field--error')}>
      <label className="ac-label" htmlFor={id}>
        {label}
        {required ? <span className="ac-req" aria-hidden>*</span> : null}
      </label>
      {children(id, msg ? helpId : undefined, Boolean(error))}
      {msg ? (
        <span className="ac-help" id={helpId} role={error ? 'alert' : undefined}>
          {msg}
        </span>
      ) : null}
    </div>
  );
}
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input className={cx('ac-input', className)} {...p} />;
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select className={cx('ac-select', className)} {...p} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={cx('ac-textarea', className)} {...p} />
);
export function Check({ label, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="ac-check">
      <input type="checkbox" {...p} />
      <span>{label}</span>
    </label>
  );
}

/* ---------- Badge / Alert / Empty / Card ---------- */
export function StatusBadge({ code, audience, overdue48h }: { code: string; audience: 'customer' | 'staff'; overdue48h?: boolean }) {
  const info = statusBadgeInfo(code, audience, { overdue48h });
  return <span className={cx('ac-badge', info.className)}>{info.label}</span>;
}
export function Tag({ tone, children }: { tone?: 'primary' | 'success' | 'warning' | 'danger'; children: ReactNode }) {
  return <span className={cx('ac-tag', tone && `ac-tag--${tone}`)}>{children}</span>;
}
export function Alert({ tone, children }: { tone?: 'success' | 'warning' | 'danger'; children: ReactNode }) {
  return (
    <div className={cx('ac-alert', tone && `ac-alert--${tone}`)} role={tone === 'danger' ? 'alert' : 'status'}>
      <div>{children}</div>
    </div>
  );
}
export function Empty({ children = MSG.empty }: { children?: ReactNode }) {
  return (
    <div className="ac-empty">
      <Inbox aria-hidden />
      <p>{children}</p>
    </div>
  );
}
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('ac-card', className)}>{children}</section>;
}

/* ---------- Masked (개인정보) ---------- */
export function Masked({ masked, canView, onView }: { masked: string; canView: boolean; onView: () => Promise<string | null> }) {
  const [plain, setPlain] = useState<string | null>(null);
  return (
    <span className="ac-masked">
      <span>{plain ?? masked}</span>
      {canView && plain === null && masked ? (
        <button type="button" onClick={async () => setPlain(await onView())}>
          보기
        </button>
      ) : null}
    </span>
  );
}

/* ---------- Modal ---------- */
export interface ModalProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  actions?: ReactNode;
  form?: boolean;
}
export function Modal({ open, title, description, onClose, children, actions, form }: ModalProps) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="ac-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={cx('ac-modal', form && 'ac-modal--form')} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 className="ac-modal__title" id={titleId}>
          {title}
        </h2>
        {description ? <p className="ac-modal__desc">{description}</p> : null}
        {children}
        {actions ? <div className={form ? 'ac-modal__actions' : 'ac-btn-group'}>{actions}</div> : null}
      </div>
    </div>
  );
}

/** 저장 전 Confirm (03 §6.2) */
export function ConfirmModal({
  open,
  message = MSG.confirmSave,
  description,
  confirmLabel = '저장',
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  message?: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      title={message}
      description={description}
      onClose={onCancel}
      actions={
        <>
          <Button variant="outline" block onClick={onCancel}>
            취소
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} block onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

/* ---------- Toast ---------- */
const ToastCtx = createContext<(msg: string) => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([]);
  const show = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, msg }]);
    setTimeout(() => setItems((s) => s.filter((i) => i.id !== id)), 3000);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="ac-toast-region" role="status" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className="ac-toast">
            <CheckCircle2 aria-hidden />
            {i.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ---------- Tabs ---------- */
export function Tabs<T extends string>({ items, value, onChange }: { items: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="ac-tabs" role="tablist">
      {items.map((i) => (
        <button key={i.value} type="button" role="tab" className="ac-tab" aria-selected={i.value === value} onClick={() => onChange(i.value)}>
          {i.label}
        </button>
      ))}
    </div>
  );
}
