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
      'touch-target group relative inline-flex h-[22px] w-[40px] shrink-0 items-center justify-center rounded-full border-0 bg-transparent transition-colors max-[640px]:h-11 max-[640px]:w-11',
      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
      'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60',
      className,
    )}
  >
    <span className="pointer-events-none inline-flex h-[22px] w-[40px] items-center rounded-full border-2 border-muted-foreground bg-background group-data-[checked]:border-primary group-data-[checked]:bg-primary">
      <BaseSwitch.Thumb
        className="pointer-events-none block size-[14px] translate-x-[2px] rounded-full bg-muted-foreground transition-transform group-data-[checked]:translate-x-[20px] group-data-[checked]:bg-primary-foreground"
      />
    </span>
  </BaseSwitch.Root>
);
Switch.displayName = 'Switch';
