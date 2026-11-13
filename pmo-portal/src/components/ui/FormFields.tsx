import React, { useEffect, useId, useRef } from 'react';
import { cn } from './cn';
import { Icon } from './icons';
import { Button } from './Button';
import { useMoneyInputMask } from './useMoneyInputMask';

// ---------------------------------------------------------------------------
// Shared form field primitives (crud-components §2.1 / §2.2). Strictly
// DESIGN.md-tokened: the `input` shell (background bg, 1px `input` border,
// `rounded-md`, 38px tall, 12px horizontal padding), the global `:focus-visible` ring,
// 14px/600 labels, the darkened-red AA error text, and
// the destructive-tinted error summary. None reinvents a native control.
//
// a11y (the single source of field accessibility): every field renders a
// visible <label htmlFor>, wires aria-required/aria-invalid/aria-describedby,
// and surfaces errors as role="alert" with a leading icon (state never by
// color alone). Read-only is rendered as a static value row by the caller, NOT
// as a greyed input — disabled here is a transient state only.
// ---------------------------------------------------------------------------

// ---- FieldError -----------------------------------------------------------

export interface FieldErrorProps {
  id?: string;
  children?: React.ReactNode;
  className?: string;
}

/**
 * Inline below-field error. `role="alert"` + a leading `alert` icon so the
 * state is conveyed by icon + text, never red alone. Renders nothing when
 * there is no message.
 */
export const FieldError: React.FC<FieldErrorProps> = ({ id, children, className }) => {
  if (!children) return null;
  return (
    <span
      id={id}
      role="alert"
      className={cn('flex items-center gap-1.5 text-control font-medium text-destructive-text', className)}
    >
      <Icon name="alert" className="size-[13px] shrink-0" />
      {children}
    </span>
  );
};

export interface FormErrorStripProps {
  children?: React.ReactNode;
  className?: string;
}

/** Shared submit-error banner that brings a failed form response into view and reading order. */
export const FormErrorStrip: React.FC<FormErrorStripProps> = ({ children, className }) => {
  const stripRef = useRef<HTMLDivElement>(null);
  const hasMessage = React.Children.count(children) > 0;

  useEffect(() => {
    const strip = stripRef.current;
    if (!hasMessage || !strip) return;
    strip.scrollIntoView({ block: 'center' });
    strip.focus({ preventScroll: true });
  }, [children, hasMessage]);

  if (!hasMessage) return null;
  return (
    <div
      ref={stripRef}
      role="alert"
      tabIndex={-1}
      className={cn(
        'rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        className,
      )}
    >
      {children}
    </div>
  );
};

// ---- FieldShell (label + control + helper/error a11y wrapper) -------------

export interface FieldShellProps {
  /** Stable id; auto-generated if omitted. */
  id?: string;
  label: React.ReactNode;
  required?: boolean;
  helper?: React.ReactNode;
  error?: React.ReactNode;
  /** Span the full grid width inside a FormGrid. */
  fullWidth?: boolean;
  /**
   * Visually hide the label (kept as the accessible name via sr-only) for an
   * in-row / inline control where a visible caption would be noise — e.g. the
   * Tasks status `SelectField` inside a table cell. a11y is preserved.
   */
  hideLabel?: boolean;
  className?: string;
  /** Render-prop receives the wired control props. */
  children: (ctl: {
    id: string;
    'aria-required'?: true;
    'aria-invalid'?: true;
    'aria-describedby'?: string;
  }) => React.ReactNode;
}

/**
 * The label + control + helper/error wrapper — the single source of field
 * a11y (`input-labels`, `required-indicators`, `error-placement`).
 */
export const FieldShell: React.FC<FieldShellProps> = ({
  id,
  label,
  required,
  helper,
  error,
  fullWidth,
  hideLabel,
  className,
  children,
}) => {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const errId = `${fieldId}-err`;
  const helpId = `${fieldId}-help`;
  const describedby =
    [error ? errId : null, helper ? helpId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-2', fullWidth && 'w-full col-span-full', className)}>
      <label
        htmlFor={fieldId}
        className={cn(
          'text-control font-semibold text-foreground',
          hideLabel && 'sr-only',
        )}
      >
        {label}
        {required && (
          <span aria-hidden className="ml-0.5 text-destructive">
            *
          </span>
        )}
      </label>
      {children({
        id: fieldId,
        'aria-required': required || undefined,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedby,
      })}
      {helper && !error && (
        <span id={helpId} className="text-control text-muted-foreground">
          {helper}
        </span>
      )}
      <FieldError id={errId}>{error}</FieldError>
    </div>
  );
};

/** The shared input visual shell (token-pure). */
export const formControlShell =
  'h-auto min-h-[var(--control-height)] w-full rounded-md border border-border hover:enabled:border-input bg-card px-3 py-1 text-control text-foreground ' +
  '[@media(pointer:coarse)]:min-h-11 ' +
  'placeholder:text-muted-foreground disabled:bg-secondary disabled:text-muted-foreground ' +
  'disabled:cursor-not-allowed';
export const formControlInvalid = 'border-destructive hover:enabled:border-destructive';
const compactControlShell =
  'h-[var(--control-height-sm)] rounded-md border border-border hover:enabled:border-input bg-card px-3 text-control text-foreground ' +
  '[@media(pointer:coarse)]:h-11 ' +
  'placeholder:text-muted-foreground disabled:bg-secondary disabled:text-muted-foreground ' +
  'disabled:cursor-not-allowed';

export type FileInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

/** Native file chooser for form and upload surfaces; preserves the browser FileList API. */
export const FileInput = React.forwardRef<HTMLInputElement, FileInputProps>(
  ({ className, ...props }, ref) => (
    <input
      {...props}
      ref={ref}
      type="file"
      className={className}
    />
  ),
);
FileInput.displayName = 'FileInput';

// ---- TextField ------------------------------------------------------------

export interface TextFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  label: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  helper?: React.ReactNode;
  error?: React.ReactNode;
  fullWidth?: boolean;
  /** Optional class name applied to the outer FieldShell wrapper. */
  wrapperClassName?: string;
  /**
   * Visually hide the label (kept as the accessible name via `sr-only`) for an in-row / in-cell
   * control where a visible caption would be noise — the same escape hatch `SelectField` has always
   * had. ⚑ I-4: its absence on the number field is why the budget ETC editor was hand-rolled, and the
   * hand-rolled one shipped with no `aria-invalid`/`aria-describedby` at all.
   */
  hideLabel?: boolean;
  /** Render the value in SF Mono (codes/refs). */
  mono?: boolean;
}

export const TextField: React.FC<TextFieldProps> = ({
  label,
  value,
  onChange,
  required,
  helper,
  error,
  fullWidth,
  hideLabel,
  mono,
  wrapperClassName,
  className,
  type = 'text',
  ...rest
}) => {
  // Secret fields (`type="password"`) render masked with an eye toggle to reveal. Secrets are
  // write-only in this app (never rendered back from the server), so the toggle only ever reveals what
  // the user just typed/pasted — it lets them confirm a pasted API token without the value sitting
  // legible on screen by default (or in a screen recording / over a shoulder).
  const isSecret = type === 'password';
  const [revealed, setRevealed] = React.useState(false);
  const effectiveType = isSecret && revealed ? 'text' : type;

  return (
    <FieldShell
      id={rest.id}
      label={label}
      required={required}
      helper={helper}
      error={error}
      fullWidth={fullWidth}
      hideLabel={hideLabel}
      className={wrapperClassName}
    >
      {(ctl) => (
        <div className={cn('relative', fullWidth && 'w-full')}>
          <input
            {...rest}
            {...ctl}
            type={effectiveType}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={cn(
              formControlShell,
              error && formControlInvalid,
              mono && 'font-mono',
              isSecret && 'pr-8',
              className,
            )}
          />
          {isSecret && (
            <button
              type="button"
              onClick={() => setRevealed((r) => !r)}
              aria-label={revealed ? 'Hide value' : 'Show value'}
              aria-pressed={revealed}
              className="touch-target absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted-foreground hover:text-foreground"
            >
              <Icon name={revealed ? 'eye-off' : 'eye'} className="size-3.55" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </FieldShell>
  );
};

// ---- NumberField ----------------------------------------------------------

export interface NumberFieldProps extends Omit<TextFieldProps, 'mono' | 'type'> {
  /** Leading adornment (e.g. "$"). */
  prefix?: string;
  /** Group valid money drafts using the active number locale while preserving partial decimals. */
  localeAware?: boolean;
}

/**
 * Numeric field — right-aligned, tabular figures, `inputMode="decimal"`. Kept
 * as text (not `type=number`) so formatted thousands separators survive and
 * the spinner chrome stays off (ui-ux-pro-max `number-tabular`).
 */
export const NumberField: React.FC<NumberFieldProps> = ({
  label,
  value,
  onChange,
  required,
  helper,
  error,
  fullWidth,
  hideLabel,
  prefix,
  localeAware,
  className,
  ...rest
}) => {
  const mask = useMoneyInputMask(value, onChange, !!localeAware);

  return (
    <FieldShell
      id={rest.id}
      label={label}
      required={required}
      helper={helper}
      error={error}
      fullWidth={fullWidth}
      hideLabel={hideLabel}
    >
      {(ctl) => (
        <div className="relative">
          {prefix && (
            <span
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-control text-muted-foreground"
            >
              {prefix}
            </span>
          )}
          <input
            {...rest}
            {...ctl}
            ref={mask.ref}
            type="text"
            inputMode="decimal"
            value={value}
            onChange={mask.onChange}
            className={cn(
              formControlShell,
              'tabular text-right',
              prefix && 'pl-6',
              error && formControlInvalid,
              className,
            )}
            // A currency CODE adornment ("IDR") is wider than a single glyph ("$"): reserve room
            // per character so a long value never runs under it (#694).
            style={prefix && prefix.length > 1 ? { paddingLeft: `${14 + prefix.length * 8}px`, ...rest.style } : rest.style}
          />
        </div>
      )}
    </FieldShell>
  );
};

// ---- TextArea -------------------------------------------------------------

export interface TextAreaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> {
  label: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  helper?: React.ReactNode;
  error?: React.ReactNode;
  fullWidth?: boolean;
  hideLabel?: boolean;
  wrapperClassName?: string;
  /** Keep a control's own shell for compact editors that live outside standard form rows. */
  unstyled?: boolean;
}

export const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(
  (
    {
      label,
      value,
      onChange,
      required,
      helper,
      error,
      fullWidth,
      hideLabel,
      wrapperClassName,
      unstyled,
      className,
      rows = 3,
      ...rest
    },
    ref,
  ) => (
    <FieldShell
      id={rest.id}
      label={label}
      required={required}
      helper={helper}
      error={error}
      fullWidth={fullWidth}
      hideLabel={hideLabel}
      className={wrapperClassName}
    >
      {(ctl) => (
        <textarea
          {...rest}
          {...ctl}
          ref={ref}
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            unstyled
              ? 'w-full'
              : 'min-h-16 w-full resize-y rounded-md border border-border hover:enabled:border-input bg-card px-3 py-2 text-control text-foreground placeholder:text-muted-foreground disabled:bg-secondary disabled:text-muted-foreground disabled:cursor-not-allowed',
            error && formControlInvalid,
            className,
          )}
        />
      )}
    </FieldShell>
  ),
);
TextArea.displayName = 'TextArea';

// ---- SelectField (native) -------------------------------------------------

export interface SelectOption {
  value: string;
  label: string;
  /** Offered but not choosable (e.g. an option an org rule holds back); the label should say why. */
  disabled?: boolean;
}

export interface SelectFieldProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  label: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  required?: boolean;
  helper?: React.ReactNode;
  error?: React.ReactNode;
  fullWidth?: boolean;
  /** Use the dense 30px control shell, with a 44px target on coarse pointers. */
  compact?: boolean;
  /** Let an inline compact control size to its selected option. */
  inline?: boolean;
  /** Visually hide the label (kept as the accessible name) for an in-row control. */
  hideLabel?: boolean;
  /** Optional leading placeholder option. */
  placeholder?: string;
  /** Optional class name applied to the outer FieldShell wrapper. */
  wrapperClassName?: string;
}

/** Native `<select>` for short fixed enum lists (status, role, GR status). */
export const SelectField: React.FC<SelectFieldProps> = ({
  label,
  value,
  onChange,
  options,
  required,
  helper,
  error,
  fullWidth,
  compact,
  inline,
  hideLabel,
  placeholder,
  className,
  wrapperClassName,
  ...rest
}) => (
  <FieldShell
    id={rest.id}
    label={label}
    required={required}
    helper={helper}
    error={error}
    fullWidth={fullWidth}
    hideLabel={hideLabel}
    className={wrapperClassName}
  >
    {(ctl) => (
      <div className="relative">
        <select
          {...rest}
          {...ctl}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            compact ? compactControlShell : formControlShell,
            compact && (inline ? 'w-auto' : 'w-full'),
            'appearance-none pr-11',
            error && formControlInvalid,
            className,
          )}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <Icon
          name="chev"
          className="pointer-events-none absolute right-3.5 top-1/2 size-[15px] -translate-y-1/2 rotate-90 text-muted-foreground"
        />
      </div>
    )}
  </FieldShell>
);

// ---- FormRow / FormGrid / FormSection -------------------------------------

export interface FormGridProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Responsive field grid: 1-col on phone, auto-fit 2-col (`minmax(210px,1fr)`)
 * from ~480px up (structural, not fluid). Children may opt into full width with
 * the field's `fullWidth` prop (`col-span-full`).
 */
export const FormGrid: React.FC<FormGridProps> = ({ children, className }) => (
  <div
    className={cn('grid grid-cols-1 gap-x-4 gap-y-3.5 sm:[grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]', className)}
  >
    {children}
  </div>
);

export interface FormSectionProps {
  legend?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** `fieldset`/`legend` group with a subheading title (`field-grouping`). */
export const FormSection: React.FC<FormSectionProps> = ({ legend, children, className }) => (
  <fieldset className={cn('m-0 mb-4 border-0 p-0 last:mb-0', className)}>
    {legend && (
      <legend className="mb-2 p-0 text-group font-semibold text-foreground">
        {legend}
      </legend>
    )}
    {children}
  </fieldset>
);

// ---- FormActions ----------------------------------------------------------

export interface FormActionsProps {
  submitLabel: string;
  cancelLabel?: string;
  /** Read-only dialogs: the submit is the one dismiss control, so no Cancel beside it. */
  hideCancel?: boolean;
  onCancel: () => void;
  /** When omitted, the submit button is type=submit (form submit path). */
  onSubmit?: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** When the submit is disabled, the id of an element (visible or sr-only) explaining why (G6). */
  submitDescribedBy?: string;
  /** Omit the primary submit (a dialog whose job is done and only offers Cancel/Done). */
  hideSubmit?: boolean;
  className?: string;
}

/**
 * Footer button cluster — trailing-right, Cancel (`outline`) then the single
 * primary submit last (LTR convention). The submit is `type="submit"` so a
 * wrapping <form> drives it (Enter-to-submit); pass `onSubmit` for a
 * non-form caller.
 */
export const FormActions: React.FC<FormActionsProps> = ({
  submitLabel,
  cancelLabel = 'Cancel',
  hideCancel,
  onCancel,
  onSubmit,
  disabled,
  loading,
  submitDescribedBy,
  hideSubmit,
  className,
}) => (
  <div
    className={cn(
      'flex items-center justify-end gap-2',
      '[@media(pointer:coarse)]:[&_button]:px-4 [@media(pointer:coarse)]:[&_button]:py-2.5',
      className,
    )}
  >
    {!hideCancel && (
      <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
        {cancelLabel}
      </Button>
    )}
    {!hideSubmit && (
      <Button
        type={onSubmit ? 'button' : 'submit'}
        variant="primary"
        disabled={disabled}
        loading={loading}
        onClick={onSubmit}
        aria-describedby={disabled ? submitDescribedBy : undefined}
      >
        {submitLabel}
      </Button>
    )}
  </div>
);
