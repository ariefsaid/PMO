import React from 'react';
import { cn } from '../components/ui/cn';
import { Icon } from '../components/ui/icons';

// -----------------------------------------------------------------------
// authFormPrimitives — shared auth-form UI (D-AUTHF-12).
// Verbatim extraction of the three primitives that originally lived inline in
// LoginPage.tsx so /reset-password and /update-password can reuse them without
// triplicating the markup. Behavior-preserving: the existing LoginPage tests
// (which query by role/label/text, not by import location) are unaffected.
// -----------------------------------------------------------------------

/** Tinted success notice (magic-link sent / check-your-email / confirmation sent). */
export const SuccessNotice: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    role="status"
    aria-live="polite"
    className="flex items-start gap-2 rounded-md border border-success/30 bg-success/[0.07] px-3 py-2.5 text-[13px]"
  >
    <Icon name="check" className="mt-px size-4 shrink-0 text-success" aria-hidden="true" />
    <span style={{ color: 'hsl(142 60% 30%)' }}>{children}</span>
  </div>
);

/** Tinted error banner (credential / network / weak-password error). */
export const ErrorBanner: React.FC<{ message: string }> = ({ message }) => (
  <div
    role="alert"
    aria-live="assertive"
    className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/[0.07] px-3 py-2.5 text-[13px]"
  >
    <Icon name="alert" className="mt-px size-4 shrink-0 text-destructive" aria-hidden="true" />
    <span style={{ color: 'hsl(0 72% 42%)' }}>{message}</span>
  </div>
);

/** Single labeled input block — label above, value controlled by parent. */
export const AuthInput: React.FC<{
  id: string;
  label: string;
  type: React.HTMLInputTypeAttribute;
  autoComplete?: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  errorId?: string;
  disabled?: boolean;
}> = ({ id, label, type, autoComplete, required, value, onChange, errorId, disabled }) => (
  <div className="flex flex-col gap-1.5">
    <label
      htmlFor={id}
      className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
    >
      {label}
    </label>
    <input
      id={id}
      type={type}
      autoComplete={autoComplete}
      required={required}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-describedby={errorId}
      className={cn(
        'h-8 w-full rounded-md border border-input bg-background px-2.5 text-[13.5px] text-foreground',
        'placeholder:text-muted-foreground',
        'transition-[border-color,box-shadow] duration-100',
        'disabled:cursor-not-allowed disabled:opacity-45',
      )}
    />
  </div>
);
