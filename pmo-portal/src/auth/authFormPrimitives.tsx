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
}> = ({ id, label, type, autoComplete, required, value, onChange, errorId, disabled }) => {
  // Secret fields render MASKED by default with an eye toggle to reveal (same contract as the shared
  // TextField primitive) — so a typed/pasted password can be confirmed without sitting legible on
  // screen. Reveal is local, ephemeral state; nothing is persisted or logged.
  const isSecret = type === 'password';
  const [revealed, setRevealed] = React.useState(false);

  return (
  <div className="flex flex-col gap-1.5">
    <label
      htmlFor={id}
      className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
    >
      {label}
    </label>
    <div className="relative">
    <input
      id={id}
      type={isSecret && revealed ? 'text' : type}
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
        isSecret && 'pr-8',
      )}
    />
      {isSecret && (
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          tabIndex={-1}
          // "value" not "password" on purpose: an accessible name containing the field's own label
          // makes getByLabelText(/password/i) ambiguous (the toggle and the input both match), which
          // is a real usability smell as well as a test one. Matches the shared TextField toggle.
          aria-label={revealed ? 'Hide value' : 'Show value'}
          aria-pressed={revealed}
          disabled={disabled}
          className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Icon name={revealed ? 'eye-off' : 'eye'} className="size-3.55" aria-hidden="true" />
        </button>
      )}
    </div>
  </div>
  );
};
