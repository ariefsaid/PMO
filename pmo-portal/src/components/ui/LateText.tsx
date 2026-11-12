import React from 'react';
import { cn } from './cn';

export interface LateTextProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Use the exception tone only for the one most urgent late row in its group. */
  emphasis?: boolean;
}

/** Lateness is ordinary foreground text unless the caller marks the urgent row. */
export const LateText: React.FC<LateTextProps> = ({ emphasis = false, className, children, ...rest }) => (
  <span
    className={cn(
      'text-control font-normal text-foreground',
      emphasis && 'font-semibold text-destructive-text',
      className,
    )}
    {...rest}
  >
    {children}
  </span>
);
