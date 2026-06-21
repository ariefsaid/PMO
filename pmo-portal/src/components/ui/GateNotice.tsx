import React from 'react';
import { cn } from './cn';
import { Icon } from './icons';

export interface GateNoticeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant: 'blocked' | 'ready';
  children: React.ReactNode;
}

/** Separation-of-duties / readiness gate banner. AA darkened text variants.
 *  a11y: a `blocked` gate is the reason an action is withheld, so it is
 *  announced (`role="alert"`); a `ready` gate is static advisory text read in
 *  normal reading order (no live-region role — that's reserved for toasts).
 *  A caller-supplied `role` overrides the default (spread last). */
export const GateNotice: React.FC<GateNoticeProps> = ({
  variant,
  children,
  className,
  ...rest
}) => (
  <div
    role={variant === 'blocked' ? 'alert' : undefined}
    className={cn(
      'flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-[13px] [&_svg]:mt-px [&_svg]:size-[17px] [&_svg]:shrink-0',
      variant === 'blocked'
        ? 'border-warning/40 bg-warning/12 text-warning-foreground [&_svg]:text-[hsl(var(--warning-icon))]'
        : 'border-success/35 bg-success/10 text-[hsl(var(--success-text))] [&_svg]:text-success',
      className
    )}
    {...rest}
  >
    <Icon name={variant === 'blocked' ? 'lock' : 'check'} />
    <div>{children}</div>
  </div>
);
