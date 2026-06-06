import React from 'react';
import { cn } from './cn';
import { Icon } from './icons';

export interface GateNoticeProps {
  variant: 'blocked' | 'ready';
  children: React.ReactNode;
  className?: string;
}

/** Separation-of-duties / readiness gate banner. AA darkened text variants. */
export const GateNotice: React.FC<GateNoticeProps> = ({ variant, children, className }) => (
  <div
    className={cn(
      'flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-[13px] [&_svg]:mt-px [&_svg]:size-[17px] [&_svg]:shrink-0',
      variant === 'blocked'
        ? 'border-warning/40 bg-warning/12 text-warning-foreground [&_svg]:text-[hsl(38_92%_45%)]'
        : 'border-success/35 bg-success/10 text-[hsl(142_64%_28%)] [&_svg]:text-success',
      className
    )}
  >
    <Icon name={variant === 'blocked' ? 'lock' : 'check'} />
    <div>{children}</div>
  </div>
);
