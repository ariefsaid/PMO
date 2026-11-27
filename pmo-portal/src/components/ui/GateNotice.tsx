import React from 'react';
import { cn } from './cn';
import { Icon } from './icons';

export interface GateNoticeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant: 'blocked' | 'ready';
  children: React.ReactNode;
  inline?: boolean;
}

/** Separation-of-duties / readiness gate banner. AA darkened text variants.
 *  a11y: a `blocked` gate is the reason an action is withheld, so it is
 *  announced (`role="alert"`); a `ready` gate is static advisory text read in
 *  normal reading order (no live-region role — that's reserved for toasts).
 *  A caller-supplied `role` overrides the default (spread last). */
export const GateNotice: React.FC<GateNoticeProps> = ({
  variant,
  inline = false,
  children,
  className,
  ...rest
}) => (
  <div
    role={variant === 'blocked' ? 'alert' : undefined}
    className={cn(
      'flex items-start gap-2.5 text-control [&_svg]:mt-px [&_svg]:size-[17px] [&_svg]:shrink-0',
      !inline && 'rounded-lg border px-3.5 py-3',
      variant === 'blocked'
        ? cn('text-warning-foreground [&_svg]:text-[hsl(var(--warning-icon))]', !inline && 'border-warning/40 bg-warning/12')
        : cn('text-[hsl(var(--success-text))] [&_svg]:text-success', !inline && 'border-success/35 bg-success/10'),

      className
    )}
    {...rest}
  >
    {!inline && <Icon name={variant === 'blocked' ? 'lock' : 'check'} />}
    <div>{children}</div>
  </div>
);
