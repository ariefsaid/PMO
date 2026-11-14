import React from 'react';
import { cn } from './cn';

export interface LateTextProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Use the exception tone only for the one most urgent late row in its group. */
  emphasis?: boolean;
  /** Set the overdue colour without adding the emphasis weight. */
  tone?: 'foreground' | 'destructive';
}

/** Late text defaults to the foreground tone; callers can mark the overdue state independently. */
export const LateText: React.FC<LateTextProps> = ({ emphasis = false, tone = 'foreground', className, children, ...rest }) => (
  <span
    className={cn(
      'text-control',
      emphasis ? 'font-semibold' : 'font-normal',
      tone === 'destructive' || emphasis ? 'text-destructive-text' : 'text-foreground',
      className,
    )}
    {...rest}
  >
    {children}
  </span>
);
