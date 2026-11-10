import React from 'react';
import { Switch as BaseSwitch } from '@base-ui/react/switch';
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
 * On/off setting that takes effect immediately, on Base UI Switch (`role="switch"`, Space toggles).
 * Off = a `muted-foreground` outline and thumb on the page background (5.2:1 — the `input` border token measures
 * 1.5:1 on `background`, below the 3:1 a control boundary needs); on = `primary` track with a `primary-foreground`
 * thumb. 40x22 track, so the row it sits in (not the switch alone) carries the touch target.
 */
export const Switch: React.FC<SwitchProps> = ({ checked, onChange, label, labelledBy, describedBy, disabled = false, className }) => (
  <BaseSwitch.Root
    checked={checked}
    onCheckedChange={(next) => onChange(next)}
    nativeButton
    render={<button type="button" />}
    disabled={disabled}
    aria-label={labelledBy ? undefined : label}
    aria-labelledby={labelledBy}
    aria-describedby={describedBy}
    className={cn(
      'relative inline-flex h-[22px] w-[40px] shrink-0 items-center rounded-full border-2 transition-colors',
      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
      'border-muted-foreground bg-background data-[checked]:border-primary data-[checked]:bg-primary',
      'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60',
      className,
    )}
  >
    <BaseSwitch.Thumb
      className="pointer-events-none block size-[14px] translate-x-[2px] rounded-full bg-muted-foreground transition-transform data-[checked]:translate-x-[20px] data-[checked]:bg-primary-foreground"
    />
  </BaseSwitch.Root>
);
Switch.displayName = 'Switch';
