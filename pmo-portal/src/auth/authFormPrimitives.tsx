import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../components/ui/cn';
import { Icon } from '../components/ui/icons';
import { setPreSessionLocale, usePreSessionLocale, type PreSessionLocale } from '../lib/locale/preSessionLocale';

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
    className="flex items-start gap-2 rounded-md border border-success/30 bg-success/[0.07] px-3 py-2.5 text-control"
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
    className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/[0.07] px-3 py-2.5 text-control"
  >
    <Icon name="alert" className="mt-px size-4 shrink-0 text-destructive" aria-hidden="true" />
    <span className="text-destructive-text">{message}</span>
  </div>
);

/** Shared small product line for every shell-less auth screen. */
export const AuthHeader: React.FC<{ className?: string; productName?: string; as?: 'header' | 'div' }> = ({ className, productName = 'PMO Portal', as: Tag = 'header' }) => (
  <Tag className={cn('flex justify-center', className)}>
    <div className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className="flex size-8 items-center justify-center rounded-md bg-primary text-control font-bold text-primary-foreground"
      >
        P
      </span>
      <span className="text-control font-semibold tracking-[-0.01em] text-foreground">
        {productName}
      </span>
    </div>
  </Tag>
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
  // C4: the toggle's accessible name is the label a screen reader user hears on every auth screen.
  const { t } = useTranslation('auth');
  const isSecret = type === 'password';
  const [revealed, setRevealed] = React.useState(false);

  return (
  <div className="flex flex-col gap-1.5">
    <label
      htmlFor={id}
      className="text-control font-semibold text-muted-foreground"
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
        'h-[var(--control-height)] max-sm:min-h-11 w-full rounded-md border border-border hover:enabled:border-input bg-card px-2.5 text-control text-foreground',
        'placeholder:text-muted-foreground',
        'transition-[border-color,box-shadow]',
        'disabled:cursor-not-allowed disabled:opacity-45',
        isSecret && 'pr-11',
      )}
    />
      {isSecret && (
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          // "value" not "password" on purpose: an accessible name containing the field's own label
          // makes getByLabelText(/password/i) ambiguous (the toggle and the input both match), which
          // is a real usability smell as well as a test one. Matches the shared TextField toggle.
          aria-label={revealed ? t('field.hideValue', 'Hide value') : t('field.showValue', 'Show value')}
          aria-pressed={revealed}
          disabled={disabled}
          className="touch-target absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Icon name={revealed ? 'eye-off' : 'eye'} className="size-3.55" aria-hidden="true" />
        </button>
      )}
    </div>
  </div>
  );
};

const LANGUAGE_CHOICES: ReadonlyArray<{ value: PreSessionLocale; label: string }> = [
  { value: 'id', label: 'Bahasa Indonesia' }, // i18n-exempt: a language is always named in itself
  { value: 'en', label: 'English' }, // i18n-exempt: a language is always named in itself
];

/** The sign-in language switch: before any organisation is known the page follows the browser, and a tap here is remembered on this device. */
export const LanguageSwitch: React.FC<{ className?: string }> = ({ className }) => {
  const current = usePreSessionLocale();
  const { t } = useTranslation('auth');
  return (
    <div role="group" aria-label={t('login.language', 'Language')} className={cn('flex justify-end gap-1', className)}>
      {LANGUAGE_CHOICES.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          lang={value}
          aria-pressed={current === value}
          onClick={() => setPreSessionLocale(value)}
          className={cn(
            'touch-target inline-flex min-h-11 items-center rounded-md px-3 text-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            current === value ? 'bg-nav-selected-surface font-semibold text-nav-active-text' : 'text-muted-foreground hover:bg-surface-hover',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
};
