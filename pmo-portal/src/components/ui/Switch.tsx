import React from 'react';
import { cn } from './cn';

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name when no visible label is wired (`aria-label`). */
  label?: string;
  /** Id of the element that already renders the visible label — wins over `label`, so the name is announced once. */
  labelledBy?: string;
  /** Id of help text (what the setting does when on). */
  describedBy?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * On/off setting that takes effect immediately (`role="switch"`, Space/Enter toggle, the global focus ring).
 * Off = a `muted-foreground` outline and thumb on the page background (5.2:1 — the `input` border token measures
 * 1.5:1 on `background`, below the 3:1 a control boundary needs); on = `primary` track with a `primary-foreground`
 * thumb. 40x22 track, so the row it sits in (not the switch alone) carries the touch target.
 */
export const Switch: React.FC<SwitchProps> = ({ checked, onChange, label, labelledBy, describedBy, disabled = false, className }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={labelledBy ? undefined : label}
    aria-labelledby={labelledBy}
    aria-describedby={describedBy}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={cn(
      'relative inline-flex h-[22px] w-[40px] shrink-0 items-center rounded-full border-2 transition-colors',
      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
      checked ? 'border-primary bg-primary' : 'border-muted-foreground bg-background',
      disabled && 'cursor-not-allowed opacity-60',
      className,
    )}
  >
    <span
      aria-hidden
      className={cn(
        'pointer-events-none block size-[14px] rounded-full transition-transform',
        checked ? 'translate-x-[20px] bg-primary-foreground' : 'translate-x-[2px] bg-muted-foreground',
      )}
    />
  </button>
);
Switch.displayName = 'Switch';
