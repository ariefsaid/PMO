import React from 'react';
import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { cn } from './cn';
import { Icon } from './icons';

export interface CheckboxProps {
  /** true | false | 'mixed' (indeterminate, e.g. a partial select-all). */
  checked: boolean | 'mixed';
  onChange: (next: boolean) => void;
  /**
   * Accessible name (required — the box is icon-only) — used as a fallback `aria-label`
   * when `labelledBy` is not given.
   */
  label: string;
  /**
   * Id of an element that already renders the control's visible label text. When given,
   * this WINS over `label`: the box is named via `aria-labelledby` instead of a duplicate
   * `aria-label`, so a screen reader announces the visible text exactly once instead of the
   * name and then the same words again read as page content (the bug this option fixes —
   * see `AnalyticsOptOutToggle`). NOTE (DESIGN.md): this component ships NO visible-label
   * click target of its own — it is a 16px icon-only box. A consumer that renders adjacent
   * label text MUST wire its own click handler on that text (and pass `labelledBy` here) to
   * get conventional checkbox-label hit-target behavior; it does not come for free.
   */
  labelledBy?: string;
  /** Ids of help/error text associated with the control. */
  describedBy?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * The documented DESIGN.md custom checkbox (§Checkbox) on Base UI Checkbox: 16px, 1.5px `input` border,
 * 4px radius; checked/mixed → `primary` fill + white check or dash. Base UI supplies `role="checkbox"`,
 * `aria-checked` (incl. `mixed`) and Space toggling; the global `:focus-visible` ring applies.
 */
export const Checkbox: React.FC<CheckboxProps> = ({
  checked,
  onChange,
  label,
  labelledBy,
  describedBy,
  disabled = false,
  className,
}) => (
  <BaseCheckbox.Root
    checked={checked === true}
    indeterminate={checked === 'mixed'}
    // mixed/false → on, true → off (the conventional partial→all behavior).
    onCheckedChange={(next) => onChange(next)}
    nativeButton
    render={<button type="button" />}
    disabled={disabled}
    aria-disabled={disabled || undefined}
    aria-label={labelledBy ? undefined : label}
    aria-labelledby={labelledBy}
    aria-describedby={describedBy}
    className={cn(
      'touch-target inline-grid size-4 shrink-0 cursor-pointer place-items-center rounded-sm border-[1.5px] border-input bg-background p-0 transition-colors [&_svg]:size-3',
      'data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:text-primary-foreground',
      'data-[indeterminate]:border-primary data-[indeterminate]:bg-primary data-[indeterminate]:text-primary-foreground',
      'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45',
      className,
    )}
  >
    <BaseCheckbox.Indicator className="grid place-items-center" keepMounted={false}>
      {checked === 'mixed'
        ? <span aria-hidden className="h-[2px] w-2 rounded-full bg-primary-foreground" />
        : <Icon name="check" aria-hidden />}
    </BaseCheckbox.Indicator>
  </BaseCheckbox.Root>
);
