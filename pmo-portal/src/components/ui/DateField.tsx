import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar } from '@/src/components/shadcn/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/src/components/shadcn/popover';
import { formatIsoDay } from '@/src/lib/format';
import { getDateFnsLocale, getDateLocale } from '@/src/lib/locale/activeLocale';
import { ISO_DAY, parseDayInput, toIsoDay } from '@/src/lib/parseDayInput';
import { cn } from './cn';
import { FieldShell, compactControlShell, formControlInvalid, formControlShell } from './FormFields';
import { Icon } from './icons';

// The one date field. Value contract: an ISO `yyyy-mm-dd` string in and out ('' = no date).
// Desktop: a typed field ("16 Nov 2026") with a calendar popover. Phone (coarse pointer): the operating
// system's own date picker, because that is the control people already know on a phone.

const COARSE_POINTER = '(pointer: coarse)';
const subscribeCoarse = (onChange: () => void) => {
  const mql = window.matchMedia?.(COARSE_POINTER);
  mql?.addEventListener('change', onChange);
  return () => mql?.removeEventListener('change', onChange);
};
const isCoarsePointer = () => window.matchMedia?.(COARSE_POINTER).matches ?? false;

const localDay = (iso: string): Date | undefined => {
  if (!ISO_DAY.test(iso)) return undefined;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export interface DateFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type' | 'min' | 'max'> {
  label: React.ReactNode;
  /** ISO `yyyy-mm-dd`, or '' for no date. */
  value: string;
  onChange: (value: string) => void;
  /** ISO bounds: days outside are disabled in the calendar (a typed date is still the caller's to validate). */
  min?: string;
  max?: string;
  required?: boolean;
  helper?: React.ReactNode;
  error?: React.ReactNode;
  fullWidth?: boolean;
  /** Visually hide the label (kept as the accessible name) for an in-row or in-filter control. */
  hideLabel?: boolean;
  /** The dense control height used by table rows and filter bars. */
  compact?: boolean;
  /** Sizes the control box (e.g. `w-48`): on the input wrapper, so the calendar button sits at its edge. */
  className?: string;
  wrapperClassName?: string;
}

export const DateField: React.FC<DateFieldProps> = ({
  label,
  value,
  onChange,
  min,
  max,
  required,
  helper,
  error,
  fullWidth,
  hideLabel,
  compact,
  wrapperClassName,
  className,
  onBlur,
  onFocus,
  onKeyDown,
  ...rest
}) => {
  const { t } = useTranslation();
  const coarse = useSyncExternalStore(subscribeCoarse, isCoarsePointer, () => false);
  const [draft, setDraft] = useState<string | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  const [open, setOpen] = useState(false);
  const focused = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const shell = compact ? compactControlShell : formControlShell;

  // A value changed from outside (form reset, calendar pick) replaces whatever was being typed.
  useEffect(() => {
    if (!focused.current) {
      setDraft(null);
      setUnreadable(false);
    }
  }, [value]);

  // A value that is not a real day (a stale draft) stays visible as it is, never as a dash.
  const shown = parseDayInput(value) === value ? formatIsoDay(value) : (value ?? '');
  const invalidMessage = unreadable
    ? t('dateField.invalid', { defaultValue: 'Enter a date like 16 Nov 2026' })
    : undefined;

  // The rule a caller gave with min/max also holds for a typed date: say so when the caller has no message of its own.
  const rangeMessage = ISO_DAY.test(value ?? '')
    ? min && value < min
      ? t('dateField.beforeMin', { defaultValue: 'Choose a date on or after {{date}}', date: formatIsoDay(min) })
      : max && value > max
        ? t('dateField.afterMax', { defaultValue: 'Choose a date on or before {{date}}', date: formatIsoDay(max) })
        : undefined
    : undefined;

  const commit = (text: string): boolean => {
    const trimmed = text.trim();
    const iso = trimmed ? parseDayInput(trimmed) : '';
    if (iso === null) {
      setUnreadable(true);
      return false;
    }
    setUnreadable(false);
    setDraft(null);
    if (iso !== value) onChange(iso);
    return true;
  };

  if (coarse) {
    return (
      <FieldShell id={rest.id} label={label} required={required} helper={helper} error={error ?? rangeMessage} fullWidth={fullWidth} hideLabel={hideLabel} className={wrapperClassName}>
        {(ctl) => (
          <input
            {...rest}
            {...ctl}
            aria-required={ctl['aria-required'] ?? rest['aria-required']}
            aria-invalid={ctl['aria-invalid'] ?? rest['aria-invalid']}
            name={rest.name ?? ctl.id}
            // The browser names the day, month and year segments in the language of the control: say the app's, not the device's.
            lang={rest.lang ?? getDateLocale()}
            type="date"
            min={min}
            max={max}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            onFocus={onFocus}
            onKeyDown={onKeyDown}
            className={cn(shell, (error || rangeMessage) && formControlInvalid, className)}
          />
        )}
      </FieldShell>
    );
  }

  const minDay = min ? localDay(min) : undefined;
  const maxDay = max ? localDay(max) : undefined;
  const selected = localDay(value);
  const today = new Date();
  const defaultMonth = selected ?? (maxDay && maxDay < today ? maxDay : minDay && minDay > today ? minDay : undefined);
  const disabled = [minDay && { before: minDay }, maxDay && { after: maxDay }].filter((m): m is { before: Date } | { after: Date } => !!m);

  return (
    <FieldShell id={rest.id} label={label} required={required} helper={helper} error={error ?? invalidMessage ?? rangeMessage} fullWidth={fullWidth} hideLabel={hideLabel} className={wrapperClassName}>
      {(ctl) => (
        <div ref={wrapRef} className={cn('relative', fullWidth && 'w-full', className)}>
          <input
            {...rest}
            {...ctl}
            ref={inputRef}
            aria-required={ctl['aria-required'] ?? rest['aria-required']}
            aria-invalid={ctl['aria-invalid'] ?? (unreadable || rangeMessage ? true : rest['aria-invalid'])}
            name={rest.name ?? ctl.id}
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={draft ?? shown}
            onChange={(e) => {
              const text = e.target.value;
              setDraft(text);
              setUnreadable(false);
              // An ISO day (a paste, or a script filling the field) is unambiguous, so it commits at once;
              // anything else waits for blur or Enter so a half-typed date never lands in the form.
              if (!text.trim() || ISO_DAY.test(text.trim())) {
                const iso = text.trim() ? parseDayInput(text) : '';
                if (iso !== null && iso !== value) onChange(iso);
              }
            }}
            onFocus={(e) => {
              focused.current = true;
              onFocus?.(e);
            }}
            onBlur={(e) => {
              focused.current = false;
              if (draft !== null) commit(draft);
              onBlur?.(e);
            }}
            onKeyDown={(e) => {
              onKeyDown?.(e);
              if (e.key === 'Enter' && draft !== null && !commit(draft)) e.preventDefault();
            }}
            className={cn(shell, 'w-full pr-9', (error || unreadable || rangeMessage) && formControlInvalid)}
          />
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
              disabled={rest.disabled}
              aria-label={t('dateField.open', { defaultValue: 'Open calendar' })}
              className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="cal" className="size-[15px]" />
            </PopoverTrigger>
            <PopoverContent
              anchor={wrapRef}
              align="start"
              positionerClassName="z-[820]"
              className="w-auto p-0!"
              aria-label={t('dateField.calendar', { defaultValue: 'Calendar' })}
              // Open on the selected day (or today): the calendar's own roving tab stop.
              initialFocus={() => calendarRef.current?.querySelector<HTMLElement>('button[data-day][tabindex="0"]') ?? true}
              finalFocus={inputRef}
            >
              <div ref={calendarRef}>
                <Calendar
                  mode="single"
                  autoFocus
                  selected={selected}
                  defaultMonth={defaultMonth}
                  locale={getDateFnsLocale()}
                  weekStartsOn={1}
                  disabled={disabled.length ? disabled : undefined}
                  onSelect={(day) => {
                    if (!day) return;
                    const iso = toIsoDay(day.getFullYear(), day.getMonth() + 1, day.getDate());
                    if (iso && iso !== value) onChange(iso);
                    setDraft(null);
                    setUnreadable(false);
                    setOpen(false);
                  }}
                />
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )}
    </FieldShell>
  );
};
