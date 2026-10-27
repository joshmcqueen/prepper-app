import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  X,
  LoaderCircle,
  AlertCircle,
  Package,
  Utensils,
  Droplets,
  Flame,
  PawPrint,
  ShieldCheck,
} from 'lucide-react';
import type { Category } from '../shared/model';

export const icons = {
  food: Utensils,
  water: Droplets,
  fuel: Flame,
  dog: PawPrint,
  supplies: Package,
};
export function CategoryIcon({ category, size = 22 }: { category: Category; size?: number }) {
  const Icon = icons[category];
  return (
    <span className={`category-icon ${category}`}>
      <Icon size={size} strokeWidth={1.7} />
    </span>
  );
}
export function Field({
  label,
  children,
  hint,
  className = '',
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Num({
  value,
  onChange,
  label,
  min = 0,
  max,
  required = false,
  placeholder = 'Unknown',
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  label: string;
  min?: number;
  max?: number;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <input
      aria-label={label}
      type="number"
      inputMode="decimal"
      step="any"
      min={min}
      max={max}
      required={required}
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    />
  );
}
export function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <div className="error-message" role="alert">
      <AlertCircle size={18} />
      <span>{message}</span>
    </div>
  ) : null;
}
export function Busy({ label = 'Working…' }: { label?: string }) {
  return (
    <>
      <LoaderCircle className="spin" size={16} />
      {label}
    </>
  );
}
export function Toggle({
  checked,
  onChange,
  children,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{children}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      d.close();
      document.body.style.overflow = '';
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const box = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < box.left ||
            e.clientX > box.right ||
            e.clientY < box.top ||
            e.clientY > box.bottom
          )
            onClose();
        }
      }}
    >
      <header className="modal-header">
        <div>
          <h2 id={id}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={21} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function AsyncButton({
  action,
  children,
  className = 'button',
  disabled = false,
}: {
  action: () => Promise<unknown>;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled || busy}
        onClick={() => {
          setBusy(true);
          setError('');
          action()
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? <Busy /> : children}
      </button>
      <ErrorMessage message={error} />
    </>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <ShieldCheck size={32} strokeWidth={1.3} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
