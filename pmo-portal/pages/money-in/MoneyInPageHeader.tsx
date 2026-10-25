import type { ReactNode } from 'react';

/** Local adapter for the money-in pages until the shared shell exposes its content slots. */
export function MoneyInPageHeader({
  title,
  scope,
  status,
  returnAction,
  primaryAction,
}: {
  title: ReactNode;
  scope?: ReactNode;
  status?: ReactNode;
  returnAction?: ReactNode;
  primaryAction?: ReactNode;
}) {
  return (
    <header data-testid="money-in-page-header" className="mb-4 min-w-0">
      {returnAction && <div className="mb-2 min-h-11">{returnAction}</div>}
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="min-w-0 break-words text-page-title">{title}</h1>
            {status}
          </div>
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
