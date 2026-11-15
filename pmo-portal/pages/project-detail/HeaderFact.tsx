import React from 'react';
import { cn } from '@/src/components/ui/cn';

/** One labelled header fact: muted label, foreground value, one unit that never splits across lines (a value too long for the line truncates; `title` keeps it whole). */
export const HeaderFact: React.FC<{ label: React.ReactNode; children: React.ReactNode } & Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'>> = ({ label, children, className, ...rest }) => (
  <span {...rest} className={cn('inline-flex min-w-0 max-w-full items-baseline gap-1 whitespace-nowrap', className)}>
    <span className="shrink-0 text-muted-foreground">{label}</span>{' '}
    <span className="min-w-0 truncate text-foreground">{children}</span>
  </span>
);
