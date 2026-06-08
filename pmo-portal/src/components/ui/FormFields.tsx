import React, { useId } from 'react';
import { cn } from './cn';
import { Icon } from './icons';
import { Button } from './Button';

// ---------------------------------------------------------------------------
// Shared form field primitives (crud-components §2.1 / §2.2). Strictly
// DESIGN.md-tokened: the `input` shell (background bg, 1px `input` border,
// `rounded-md`, 32px tall, 0 10px padding), the global `:focus-visible` ring,
// 12px/600 labels in `muted-foreground`, the darkened-red AA error text, and
// the destructive-tinted error summary. None reinvents a native control.
//
// a11y (the single source of field accessibility): every field renders a
// visible <label htmlFor>, wires aria-required/aria-invalid/aria-describedby,
// and surfaces errors as role="alert" with a leading icon (state never by
// color alone). Read-only is rendered as a static value row by the caller, NOT
// as a greyed input — disabled here is a transient state only.
// ---------------------------------------------------------------------------

/** Darkened red that clears AA on white/tint (matches ErrBanner). */
const ERR_TEXT = 'hsl(0 72% 45%)';

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
      className={cn('flex items-center gap-1.5 text-[12px] font-medium', className)}
      style={{ color: ERR_TEXT }}
    >
      <Icon name="alert" className="size-[13px] shrink-0" />
      {children}
    </span>
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
    <div className={cn('flex flex-col gap-1.5', fullWidth && 'col-span-full', className)}>
      <label
        htmlFor={fieldId}
        className={cn(
          'text-[12px] font-semibold leading-[1.3] text-foreground',
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
        <span id={helpId} className="text-[12px] text-muted-foreground">
          {helper}
        </span>
      )}
      <FieldError id={errId}>{error}</FieldError>
    </div>
  );
};

/** The shared input visual shell (token-pure). */
const inputBase =
  'h-8 w-full rounded-md border border-input bg-background px-[10px] text-[13.5px] text-foreground ' +
  'placeholder:text-muted-foreground disabled:bg-secondary disabled:text-muted-foreground ' +
  'disabled:cursor-not-allowed';
const inputInvalid = 'border-destructive';

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
  mono,
  className,
  type = 'text',
  ...rest
}) => (
  <FieldShell
    id={rest.id}
    label={label}
    required={required}
    helper={helper}
    error={error}
    fullWidth={fullWidth}
  >
    {(ctl) => (
      <input
        {...rest}
        {...ctl}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputBase, error && inputInvalid, mono && 'font-mono', className)}
      />
    )}
  </FieldShell>
);

// ---- NumberField ----------------------------------------------------------

export interface NumberFieldProps extends Omit<TextFieldProps, 'mono' | 'type'> {
  /** Leading adornment (e.g. "$"). */
  prefix?: string;
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
  prefix,
  className,
  ...rest
}) => (
  <FieldShell
    id={rest.id}
    label={label}
    required={required}
    helper={helper}
    error={error}
    fullWidth={fullWidth}
  >
    {(ctl) => (
      <div className="relative">
        {prefix && (
          <span
            aria-hidden
            className="pointer-events-none absolute left-[10px] top-1/2 -translate-y-1/2 text-[13.5px] text-muted-foreground"
          >
            {prefix}
          </span>
        )}
        <input
          {...rest}
          {...ctl}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            inputBase,
            'tabular text-right',
            prefix && 'pl-[22px]',
            error && inputInvalid,
            className,
          )}
        />
      </div>
    )}
  </FieldShell>
);

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
}

export const TextArea: React.FC<TextAreaProps> = ({
  label,
  value,
  onChange,
  required,
  helper,
  error,
  fullWidth,
  className,
  rows = 3,
  ...rest
}) => (
  <FieldShell
    id={rest.id}
    label={label}
    required={required}
    helper={helper}
    error={error}
    fullWidth={fullWidth}
  >
    {(ctl) => (
      <textarea
        {...rest}
        {...ctl}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'min-h-16 w-full resize-y rounded-md border border-input bg-background px-[10px] py-2 text-[13.5px] leading-[1.5] text-foreground',
          'placeholder:text-muted-foreground disabled:bg-secondary disabled:text-muted-foreground disabled:cursor-not-allowed',
          error && inputInvalid,
          className,
        )}
      />
    )}
  </FieldShell>
);

// ---- SelectField (native) -------------------------------------------------

export interface SelectOption {
  value: string;
  label: string;
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
  /** Visually hide the label (kept as the accessible name) for an in-row control. */
  hideLabel?: boolean;
  /** Optional leading placeholder option. */
  placeholder?: string;
}

const CHEVRON_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23737380' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")";

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
  hideLabel,
  placeholder,
  className,
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
  >
    {(ctl) => (
      <select
        {...rest}
        {...ctl}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          inputBase,
          'appearance-none bg-[right_9px_center] bg-no-repeat pr-[30px] [background-size:15px]',
          error && inputInvalid,
          className,
        )}
        style={{ backgroundImage: CHEVRON_BG, ...rest.style }}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
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

/** A single horizontal row of controls (used outside the grid, e.g. inline edits). */
export const FormRow: React.FC<FormGridProps> = ({ children, className }) => (
  <div className={cn('flex flex-wrap items-end gap-3', className)}>{children}</div>
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
      <legend className="mb-2.5 p-0 text-[13px] font-semibold tracking-[-0.01em] text-foreground">
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
  onCancel: () => void;
  /** When omitted, the submit button is type=submit (form submit path). */
  onSubmit?: () => void;
  disabled?: boolean;
  loading?: boolean;
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
  onCancel,
  onSubmit,
  disabled,
  loading,
  className,
}) => (
  <div
    className={cn(
      'flex items-center justify-end gap-2',
      '[@media(pointer:coarse)]:[&_button]:px-4 [@media(pointer:coarse)]:[&_button]:py-2.5',
      className,
    )}
  >
    <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
      {cancelLabel}
    </Button>
    <Button
      type={onSubmit ? 'button' : 'submit'}
      variant="primary"
      disabled={disabled}
      loading={loading}
      onClick={onSubmit}
    >
      {submitLabel}
    </Button>
  </div>
);
