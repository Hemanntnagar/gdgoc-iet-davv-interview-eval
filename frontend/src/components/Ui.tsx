import { useEffect, useRef, useState, type ReactNode } from 'react';

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="dialog">
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className={`btn ${danger ? 'danger' : ''}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="empty">
      <span className="spinner" /> {label}
    </div>
  );
}

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <p>{message}</p>
      {action}
    </div>
  );
}

/** Four-dot Google-coloured brand mark used beside the product name. */
export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

/** Centred, branded shell shared by the login / register / verify screens. */
export function AuthShell({
  title,
  subtitle,
  children,
  compact = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'auth-inline' : 'auth-shell'}>
      <div className="auth-card">
        <div className="auth-brand">
          <img className="auth-logo" src="/gdg-logo.png" alt="Google Developer Group IET DAVV" />
        </div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

/**
 * Counts a number up (or down) to its new value. Purely decorative: the
 * final rendered value is always the real one, and reduced-motion users get
 * the value immediately.
 */
export function AnimatedNumber({
  value,
  duration = 600,
}: {
  value: number;
  duration?: number;
}) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = fromRef.current;
    const to = value;
    fromRef.current = to;
    if (reduce || from === to) {
      setDisplay(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <span className="animated-number">{display}</span>;
}

/** Accessible progress bar with an animated width. */
export function ProgressBar({
  value,
  max = 100,
  tone,
  label,
}: {
  value: number;
  max?: number;
  tone?: 'blue' | 'green' | 'yellow';
  label?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div
      className={`progress${tone ? ` ${tone}` : ''}`}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Metric card with an optional colour accent and animated numeric value. */
export function Stat({
  value,
  label,
  sub,
  tone = 'blue',
  children,
}: {
  value?: number;
  label: string;
  sub?: ReactNode;
  tone?: 'blue' | 'green' | 'yellow' | 'red';
  children?: ReactNode;
}) {
  return (
    <div className={`card stat ${tone}`}>
      <div className="value">{children ?? (value !== undefined ? <AnimatedNumber value={value} /> : '—')}</div>
      <div className="label">{label}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}
