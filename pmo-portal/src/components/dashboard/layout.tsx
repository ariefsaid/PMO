import React from 'react';
import { cn } from '@/src/components/ui/cn';

export interface DashPageHeadProps {
  title: string;
  sub: string;
  actions?: React.ReactNode;
}

/** Page head — title + sub, on tokens (replaces the legacy gray/dark heading). */
export const DashPageHead: React.FC<DashPageHeadProps> = ({ title, sub, actions }) => (
  <div className="flex flex-wrap items-start justify-between gap-3">
    <div className="min-w-0">
      <h1 className="text-[24px] font-bold leading-tight tracking-[-0.02em]">{title}</h1>
      <p className="mt-0.5 max-w-[68ch] text-[13.5px] text-muted-foreground">{sub}</p>
    </div>
    {actions && <div className="flex items-center gap-2">{actions}</div>}
  </div>
);

/** Two-up chart row that stacks to a single column below ~900px. */
export const DashGrid: React.FC<{ className?: string; children: React.ReactNode }> = ({
  className,
  children,
}) => (
  <div className={cn('grid grid-cols-1 gap-4 min-[920px]:grid-cols-2', className)}>{children}</div>
);
