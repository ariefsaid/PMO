import type { ReactNode } from 'react';
import { PageHeading, type PageHeadingKind } from '@/src/components/ui/PageHeading';

/** Maps money-in page identity props to the shared content-track heading. */
export function MoneyInPageHeader({
  title,
  scope,
  status,
  kind = 'collection',
  returnAction,
  primaryAction,
}: {
  title: ReactNode;
  scope?: ReactNode;
  status?: ReactNode;
  kind?: PageHeadingKind;
  returnAction?: ReactNode;
  primaryAction?: ReactNode;
}) {
  return (
    <div data-testid="money-in-page-header" className="mb-4 min-w-0">
      {returnAction}
      <PageHeading
        kind={kind}
        title={<span className="type-page-title">{title}</span>}
        scope={scope ? <span className="type-value">{scope}</span> : undefined}
        status={status}
        actions={primaryAction}
      />
    </div>
  );
}
