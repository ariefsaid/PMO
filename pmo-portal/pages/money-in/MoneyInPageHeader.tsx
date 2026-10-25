import type { ReactNode } from 'react';

/** Local adapter for the money-in pages until the shared shell exposes its content slots. */
export function MoneyInPageHeader({
  title,
  scope,
  primaryAction,
}: {
  title: ReactNode;
  scope?: ReactNode;
  primaryAction?: ReactNode;
}) {
  return (
    <header data-testid="money-in-page-header" className="mb-4 min-w-0">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-page-title">{title}</h1>
          {scope && <p className="mt-1 max-w-[80ch] break-words text-sm text-muted-foreground">{scope}</p>}
        </div>
        {primaryAction && (
          <div data-slot="primary" className="flex min-h-11 shrink-0 items-center [&_button]:min-h-11">
            {primaryAction}
          </div>
        )}
      </div>
    </header>
  );
}
