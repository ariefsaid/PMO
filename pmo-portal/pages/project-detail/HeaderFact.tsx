import React from 'react';
import { cn } from '@/src/components/ui/cn';

/** One labelled header fact: muted label, foreground value, kept together as one unit. A value too long for the line wraps inside the pair, so it always shows whole (a phone cannot hover a `title`). */
export const HeaderFact: React.FC<{ label: React.ReactNode; children: React.ReactNode } & Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'>> = ({ label, children, className, ...rest }) => (
  <span {...rest} className={cn('inline-flex min-w-0 max-w-full items-baseline gap-1', className)}>
    <span className="shrink-0 whitespace-nowrap text-muted-foreground">{label}</span>{' '}
    <span className="min-w-0 break-words text-foreground">{children}</span>
  </span>
);
