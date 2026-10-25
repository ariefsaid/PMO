import React from 'react';

/** Local seam for the shared shell's title, scope, and primary-action slots. */
export interface SalesPageHeaderAdapterProps {
  title: string;
  scopeLine: string;
  primaryAction?: React.ReactNode;
}

export const SalesPageHeaderAdapter: React.FC<SalesPageHeaderAdapterProps> = ({ title, scopeLine, primaryAction }) => (
  <header data-testid="sales-page-header-adapter" className="mb-4 flex min-w-0 flex-wrap items-start justify-between gap-3">
    <div className="min-w-0">
      <h1 className="break-words text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mt-1 break-words text-sm text-muted-foreground">{scopeLine}</p>
    </div>
    {primaryAction}
  </header>
);
