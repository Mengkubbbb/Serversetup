import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useI18n, type TKey } from '../i18n';
import { useEscape } from './format';

export type IconName =
  | 'dashboard'
  | 'folder'
  | 'package'
  | 'layers'
  | 'sparkles'
  | 'sliders'
  | 'settings'
  | 'plus'
  | 'search'
  | 'upload'
  | 'download'
  | 'trash'
  | 'edit'
  | 'chevron'
  | 'x'
  | 'refresh'
  | 'check'
  | 'alert'
  | 'info'
  | 'undo'
  | 'redo'
  | 'copy'
  | 'external'
  | 'file'
  | 'arrowRight'
  | 'plugin'
  | 'shield'
  | 'bug';

const PATHS: Record<IconName, string> = {
  dashboard: 'M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z',
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  package: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  sparkles: 'M12 3l1.8 4.7L18 9.5l-4.2 1.8L12 16l-1.8-4.7L6 9.5l4.2-1.8zM18 15l.9 2.4L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.6z',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.1V4a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  plus: 'M12 5v14M5 12h14',
  search: 'M21 21l-4.3-4.3M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0z',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  chevron: 'M9 18l6-6-6-6',
  x: 'M6 6l12 12M18 6L6 18',
  refresh: 'M21 12a9 9 0 1 1-3-6.7M21 3v6h-6',
  check: 'M20 6L9 17l-5-5',
  alert: 'M12 9v4M12 17h0M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 16v-4M12 8h0M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  copy: 'M8 8h11v11H8zM5 16H4V5h11v1',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  plugin: 'M9 3v4M15 3v4M5 7h14v5a7 7 0 0 1-14 0zM12 19v2',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  bug: 'M8 3l1.5 2M16 3l-1.5 2M12 8a5 5 0 0 1 5 5v2a5 5 0 0 1-10 0v-2a5 5 0 0 1 5-5zM3 12h2M19 12h2M3 17h2M19 17h2M12 8V6',
};

export function Icon({ name, size = 16, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">{title}</h1>
        {subtitle ? <p className="mt-0.5 max-w-3xl text-sm text-slate-400">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-surface-600 border-t-accent" />
      {label ? <span>{label}</span> : null}
    </div>
  );
}

export function LoadingBlock({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[140px] items-center justify-center">
      <Spinner label={label} />
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon = 'info',
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-surface-700 bg-surface-900/40 px-6 py-10 text-center">
      <span className="rounded-full border border-surface-700 bg-surface-850 p-2 text-slate-400">
        <Icon name={icon} size={18} />
      </span>
      <h3 className="text-sm font-medium text-slate-200">{title}</h3>
      {description ? <p className="max-w-md text-sm text-slate-400">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-start gap-2 rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
      <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
      <span className="min-w-0 flex-1 break-words">{message}</span>
      {onRetry ? (
        <button type="button" className="btn btn-xs btn-secondary" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function WarningList({ warnings, tone = 'warn' }: { warnings: string[]; tone?: 'warn' | 'error' | 'info' }) {
  if (warnings.length === 0) return null;
  const styles =
    tone === 'error'
      ? 'border-red-900/60 bg-red-950/30 text-red-200'
      : tone === 'info'
        ? 'border-surface-700 bg-surface-850/70 text-slate-300'
        : 'border-amber-900/60 bg-amber-950/25 text-amber-100';
  return (
    <ul className={`space-y-1 rounded-md border px-3 py-2 text-xs ${styles}`}>
      {warnings.map((warning, index) => (
        <li key={index} className="flex gap-2">
          <span className="mt-0.5">•</span>
          <span className="min-w-0 break-words">{warning}</span>
        </li>
      ))}
    </ul>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width = 'max-w-2xl',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}) {
  const close = React.useCallback(() => onClose(), [onClose]);
  useEscape(close, open);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`fade-in relative z-10 w-full ${width} rounded-lg border border-surface-700 bg-surface-900 shadow-2xl outline-none`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-surface-700 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
          <button type="button" className="rounded p-1 text-slate-400 hover:bg-surface-800 hover:text-slate-100" onClick={onClose} aria-label="Close dialog">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-3">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-surface-700 px-4 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
  busy,
  children,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      width="max-w-md"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="button" className={danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={onConfirm} disabled={busy}>
            {busy ? t('common.loading') : confirmLabel ?? t('common.confirm')}
          </button>
        </>
      }
    >
      <p className="text-sm text-slate-300">{message}</p>
      {children ? <div className="mt-3">{children}</div> : null}
    </Modal>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string; count?: number }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 border-b border-surface-700/70 pb-px">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`-mb-px flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors ${
            active === tab.id
              ? 'border-accent text-slate-100'
              : 'border-transparent text-slate-400 hover:border-surface-600 hover:text-slate-200'
          }`}
        >
          {tab.label}
          {typeof tab.count === 'number' ? (
            <span className="rounded bg-surface-800 px-1.5 py-0.5 text-[10px] text-slate-400">{tab.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

const COMPAT_STYLES: Record<string, string> = {
  verified: 'badge badge-verified',
  potential: 'badge badge-potential',
  incompatible: 'badge badge-incompatible',
  unknown: 'badge badge-unknown',
};

export function CompatBadge({ level, label }: { level: string; label?: string }) {
  const text = label ?? (level === 'verified' ? 'Verified' : level === 'potential' ? 'Potentially compatible' : level === 'incompatible' ? 'Incompatible' : 'Unknown');
  return (
    <span className={COMPAT_STYLES[level] ?? COMPAT_STYLES.unknown}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {text}
    </span>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      {error ? <p className="mt-1 text-xs text-red-300">{error}</p> : null}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-md border border-surface-700 bg-surface-850/40 px-3 py-2">
      <span>
        <span className="block text-sm text-slate-200">{label}</span>
        {description ? <span className="block text-xs text-slate-500">{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors ${
          checked ? 'border-accent bg-accent/70' : 'border-surface-600 bg-surface-700'
        }`}
      >
        <span
          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`}
        />
      </button>
    </label>
  );
}

export function LinkButton({ to, children, variant = 'secondary' }: { to: string; children: React.ReactNode; variant?: 'primary' | 'secondary' }) {
  return (
    <Link to={to} className={variant === 'primary' ? 'btn btn-primary' : 'btn btn-secondary'}>
      {children}
    </Link>
  );
}

export function StatCard({ label, value, hint, icon }: { label: string; value: React.ReactNode; hint?: string; icon: IconName }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between text-slate-400">
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        <Icon name={icon} size={15} />
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-100">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      className="btn btn-xs btn-secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
      aria-label={label ?? t('common.copy')}
    >
      <Icon name={copied ? 'check' : 'copy'} size={12} />
      {copied ? t('common.saved') : t('common.copy')}
    </button>
  );
}

export function KeyValue({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline justify-between gap-3 border-b border-surface-800 py-1 last:border-0">
          <dt className="text-slate-500">{item.label}</dt>
          <dd className="text-right text-slate-200">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="text-xs text-red-300">{message}</p>;
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500">
        <Icon name="search" size={14} />
      </span>
      <input
        className="input pl-8"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </div>
  );
}

export function useT() {
  const { t } = useI18n();
  return (key: TKey) => t(key);
}
