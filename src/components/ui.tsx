import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useState, type ReactNode } from "react";

/** Shared primitives so every panel in the launcher looks like one app. */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-dim border border-transparent",
  secondary:
    "bg-accent/10 text-accent border border-accent/25 hover:bg-accent/20",
  ghost:
    "border border-trim text-secondary hover:text-primary hover:border-trim/60",
  danger:
    "border border-accent/30 text-accent hover:bg-accent/10 hover:border-accent/50",
};

export function Button({
  children,
  onClick,
  variant = "ghost",
  disabled,
  title,
  className = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  title?: string;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${BUTTON_STYLES[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = "max-w-xl",
}: {
  title: string;
  subtitle?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div
        className={`w-full ${width} max-h-full flex flex-col rounded-lg border border-trim bg-surface shadow-2xl overflow-hidden`}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-trim">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-primary truncate">{title}</h2>
            {subtitle && (
              <div className="text-xs text-muted mt-0.5 truncate">{subtitle}</div>
            )}
          </div>
          {onClose && (
            <button
              onClick={onClose}
              title="Close"
              className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-muted hover:text-primary hover:bg-elevated transition-colors cursor-pointer"
            >
              <Icon name="close" />
            </button>
          )}
        </div>

        <div className="px-5 py-4 overflow-y-auto min-h-0">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-trim bg-base/40">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  missing = false,
  missingLabel = "Required",
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  /** Highlights the field as something the user still has to fill in. */
  missing?: boolean;
  missingLabel?: string;
}) {
  return (
    <label className="block">
      <span className="flex items-center gap-2 mb-1.5">
        <span className="text-xs font-semibold text-muted uppercase tracking-widest">
          {label}
        </span>
        {missing && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-accent/15 text-accent border border-accent/30">
            {missingLabel}
          </span>
        )}
      </span>
      {children}
      {hint && <span className="block text-xs text-muted mt-1">{hint}</span>}
    </label>
  );
}

const INPUT_CLASS =
  "w-full px-2.5 py-1.5 rounded-md bg-elevated border border-trim text-sm text-primary focus:outline-none focus:border-accent transition-colors";
const INPUT_MISSING_CLASS =
  "w-full px-2.5 py-1.5 rounded-md bg-accent/5 border border-accent/40 text-sm text-primary focus:outline-none focus:border-accent transition-colors";

export function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  onEnter,
  onBlur,
  disabled,
  missing = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password";
  onEnter?: () => void;
  onBlur?: () => void;
  disabled?: boolean;
  missing?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={(e) => {
        if (e.key === "Enter" && onEnter) onEnter();
      }}
      className={missing ? INPUT_MISSING_CLASS : INPUT_CLASS}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${INPUT_CLASS} appearance-none cursor-pointer`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function CheckRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-2.5 group ${disabled ? "opacity-50" : "cursor-pointer"}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 w-3.5 h-3.5 rounded accent-accent cursor-pointer"
      />
      <span className="min-w-0">
        <span className="block text-sm text-secondary group-hover:text-primary transition-colors">
          {label}
        </span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; count?: number }[];
}) {
  return (
    <div className="flex p-0.5 rounded-md bg-elevated border border-trim">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`flex-1 px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
            value === option.value
              ? "bg-overlay text-primary"
              : "text-secondary hover:text-primary"
          }`}
        >
          {option.label}
          {option.count !== undefined && (
            <span className="ml-1 text-muted">{option.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Banner({
  tone = "warn",
  title,
  children,
  action,
}: {
  tone?: "warn" | "danger" | "info" | "success";
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const tones = {
    warn: "border-warn/30 bg-warn/5",
    danger: "border-accent/30 bg-accent/5",
    info: "border-trim bg-elevated",
    success: "border-good/40 bg-good/10",
  } as const;
  const iconTones = {
    warn: "text-warn",
    danger: "text-accent",
    info: "text-secondary",
    success: "text-good",
  } as const;

  return (
    <div className={`flex items-start gap-3 rounded-md border px-3 py-2.5 ${tones[tone]}`}>
      <span className={`mt-0.5 shrink-0 ${iconTones[tone]}`}>
        <Icon name={tone === "success" ? "check" : "warning"} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-primary">{title}</p>
        {children && <div className="text-xs text-secondary mt-0.5">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * A command or path the user may need to run. When the content is plain text
 * it gets a copy button. These are usually commands that have to be pasted
 * into a terminal, and retyping an account name invites typos.
 */
export function Code({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = typeof children === "string" ? children : null;

  const copy = async () => {
    if (!text) return;
    try {
      await writeText(text);
    } catch {
      // Outside the Tauri runtime (or if the plugin is unavailable) fall back
      // to the web clipboard so the button is never simply dead.
      try {
        await navigator.clipboard?.writeText(text);
      } catch {
        return;
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  // The outer block puts the command on its own line; inline it would trail
  // off the end of a sentence. The inner box is sized to the content so the
  // button stays next to the text instead of drifting to the panel's edge.
  return (
    <div className="mt-2">
      <div className="inline-flex max-w-full items-stretch rounded border border-trim bg-base overflow-hidden">
        <code className="px-2.5 py-1.5 font-mono text-xs text-primary break-all select-all">
          {children}
        </code>
        {text && (
          <button
            onClick={copy}
            title="Copy to clipboard"
            aria-label={copied ? "Copied" : "Copy to clipboard"}
            className={`shrink-0 inline-flex items-center gap-1 px-2.5 border-l text-[10px] font-medium transition-colors cursor-pointer ${
              copied
                ? "bg-good/15 text-good border-good/30"
                : "bg-elevated text-secondary border-trim hover:text-primary hover:bg-overlay"
            }`}
          >
            <Icon name={copied ? "check" : "copy"} size={10} />
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
    </div>
  );
}

export function ProgressBar({ percent }: { percent: number | null }) {
  const indeterminate = percent === null;
  return (
    <div className="h-1.5 w-full bg-elevated rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full bg-accent transition-all ${
          indeterminate ? "animate-pulse w-1/3" : ""
        }`}
        style={indeterminate ? undefined : { width: `${Math.min(100, percent)}%` }}
      />
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={`animate-spin ${className}`}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

const ICON_PATHS: Record<string, ReactNode> = {
  close: (
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>
  ),
  refresh: (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
  play: <polygon points="5 3 19 12 5 21 5 3" />,
  star: (
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
    </>
  ),
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  servers: (
    <>
      <rect x="2" y="3" width="20" height="8" rx="2" />
      <rect x="2" y="13" width="20" height="8" rx="2" />
      <line x1="6" y1="7" x2="6.01" y2="7" />
      <line x1="6" y1="17" x2="6.01" y2="17" />
    </>
  ),
  mods: (
    <>
      <path d="M12 2l9 5v10l-9 5-9-5V7z" />
      <path d="M3.3 7L12 12l8.7-5" />
      <line x1="12" y1="22" x2="12" y2="12" />
    </>
  ),
  warning: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </>
  ),
  check: <polyline points="20 6 9 17 4 12" />,
  copy: (
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  external: (
    <>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </>
  ),
  plug: (
    <>
      <path d="M9 2v6" />
      <path d="M15 2v6" />
      <path d="M6 8h12v4a6 6 0 0 1-12 0z" />
      <path d="M12 18v4" />
    </>
  ),
};

export function Icon({
  name,
  size = 12,
  filled = false,
  className = "",
}: {
  name: keyof typeof ICON_PATHS | string;
  size?: number;
  filled?: boolean;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {ICON_PATHS[name] ?? null}
    </svg>
  );
}
