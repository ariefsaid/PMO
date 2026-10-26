import React from 'react';
import { cn } from './cn';

export type PageHeadingKind = 'collection' | 'record' | 'review' | 'dashboard';

export interface PageHeadingProps {
  title: React.ReactNode;
  scope?: React.ReactNode;
  status?: React.ReactNode;
  leading?: React.ReactNode;
  actions?: React.ReactNode;
  kind?: PageHeadingKind;
  className?: string;
}

/** Shared page identity: one title, one scope line, and a page-type action slot. */
export const PageHeading: React.FC<PageHeadingProps> = ({
  title,
  scope,
  status,
  leading,
  actions,
  kind = 'collection',
  className,
}) => (
  <header
    data-page-heading
    data-page-type={kind}
    className={cn('flex min-w-0 flex-wrap items-start gap-3', className)}
  >
    {leading}
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
        <h1 className={cn(
          'min-w-0 break-words font-bold tracking-[-0.02em]',
          kind === 'record' ? 'text-[19px] sm:truncate' : 'text-[24px] leading-tight',
        )}>
          {title}
        </h1>
        {status}
      </div>
      {scope && <div data-page-scope className="mt-0.5 max-w-[72ch] text-[13.5px] text-muted-foreground">{scope}</div>}
    </div>
    {actions && (
      <div
        data-page-primary-action-slot={kind}
        className={cn(
          'flex shrink-0 flex-wrap items-center gap-2 [&_button]:min-h-11 [&_a]:min-h-11',
          kind === 'record' ? 'ml-auto w-full sm:w-auto' : 'w-full sm:w-auto',
        )}
      >
        {actions}
      </div>
    )}
  </header>
);

PageHeading.displayName = 'PageHeading';
