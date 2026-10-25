import React from 'react';
import { Button, Icon, ListPage, type ListPageProps } from '@/src/components/ui';

/** The one handoff point for money-out title, scope and primary action as shell lands. */
export interface MoneyOutPageHeaderProps {
  title: React.ReactNode;
  scope?: React.ReactNode;
  status?: React.ReactNode;
  primaryAction?: React.ReactNode;
  returnAction?: { label: string; onReturn: () => void; phoneOnly?: boolean };
}

export const MoneyOutPageHeader: React.FC<MoneyOutPageHeaderProps> = ({
  title, scope, status, primaryAction, returnAction,
}) => (
  <>
    {returnAction && (
      <div className={returnAction.phoneOnly ? 'mb-3 sm:hidden' : 'mb-3'}>
        <Button variant="outline" className="h-11 px-3" onClick={returnAction.onReturn}>
          <Icon name="back" />
          {returnAction.label}
        </Button>
      </div>
    )}
    <header className="mb-6 flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight">{title}</h1>
          {status}
        </div>
        {scope && <p className="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-sm text-muted-foreground">{scope}</p>}
      </div>
      {primaryAction && <div className="max-sm:w-full max-sm:[&>button]:min-h-11">{primaryAction}</div>}
    </header>
  </>
);

export type MoneyOutListPageProps = Omit<ListPageProps, 'description'> & {
  scope?: React.ReactNode;
  returnAction?: { label: string; onReturn: () => void };
};

/** Collection counterpart to MoneyOutPageHeader, kept as the list shell adapter. */
export const MoneyOutListPage: React.FC<MoneyOutListPageProps> = ({ scope, returnAction, ...props }) => (
  <>
    {returnAction && (
      <div className="mb-3">
        <Button variant="outline" className="min-h-11 px-3" onClick={returnAction.onReturn}>
          <Icon name="back" />
          {returnAction.label}
        </Button>
      </div>
    )}
    <ListPage {...props} description={scope} />
  </>
);
