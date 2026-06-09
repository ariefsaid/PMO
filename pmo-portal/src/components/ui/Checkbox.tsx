import React from 'react';
import { cn } from './cn';
import { Icon } from './icons';

export interface CheckboxProps {
  /** true | false | 'mixed' (indeterminate, e.g. a partial select-all). */
  checked: boolean | 'mixed';
  onChange: (next: boolean) => void;
  /** Accessible name (required — the box is icon-only). */
  label: string;
  disabled?: boolean;
  className?: string;
}

/**
 * The documented DESIGN.md custom checkbox (§Checkbox): 16px, 1.5px `input` border,
 * 4px radius; checked → `primary` fill + white check. Exposed with `role="checkbox"`
 * + `aria-checked` + `tabindex="0"`; Space/Enter toggles (a11y §Semantics/Keyboard).
 * The global `:focus-visible` ring applies — no per-component focus style.
 */
export const Checkbox: React.FC<CheckboxProps> = ({
  checked,
  onChange,
  label,
  disabled = false,
  className,
}) => {
  const ariaChecked: boolean | 'mixed' = checked;
  const isOn = checked === true;
  const isMixed = checked === 'mixed';

  const toggle = () => {
    if (disabled) return;
    // mixed/true → off, false → on (the conventional partial→all-off behavior).
    onChange(!(checked === true));
  };

  return (
    <span
      role="checkbox"
      aria-checked={ariaChecked}
      aria-label={label}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          toggle();
        }
      }}
      className={cn(
        'touch-target inline-grid size-4 shrink-0 cursor-pointer place-items-center rounded-[4px] border-[1.5px] transition-colors [&_svg]:size-3',
        isOn || isMixed
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-input bg-background',
        disabled && 'cursor-not-allowed opacity-45',
        className,
      )}
    >
      {isOn && <Icon name="check" aria-hidden />}
      {isMixed && <span aria-hidden className="h-[2px] w-2 rounded-full bg-primary-foreground" />}
    </span>
  );
};
