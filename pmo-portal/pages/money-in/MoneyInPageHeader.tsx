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
      <PageHeading kind={kind} title={title} scope={scope} status={status} actions={primaryAction} />
    </div>
  );
}
