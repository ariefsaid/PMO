import { useId, type ReactNode } from 'react';
import { AccountingSnapshotProvenance } from '@/src/components/AccountingSnapshotProvenance';
import { Button } from '@/src/components/ui/Button';
import { Card, CardHead, CardPad } from '@/src/components/ui/Card';
import { ListState } from '@/src/components/ui/ListState';
import { formatInstantDate } from '@/src/lib/format';

export type FinancialStatementsSectionState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'unavailable' }
  | {
      kind: 'complete';
      asOf: string;
      hasActivity: boolean;
      delayed: boolean;
      background: 'idle' | 'pending' | 'failed';
    };

export interface FinancialStatementsSectionProps {
  title: string;
  context?: string;
  state: FinancialStatementsSectionState;
  labels: {
    unavailable: string;
    unavailableDescription: string;
    noActivity: string;
    noActivityDescription: string;
    error: string;
    errorDescription: string;
    retry: string;
    updated: string;
    delayed: string;
    refreshing: string;
  };
  onRetry: () => void;
  children?: ReactNode;
}

export function FinancialStatementsSection({
  title,
  context,
  state,
  labels,
  onRetry,
  children,
}: FinancialStatementsSectionProps) {
  const headingId = useId();
  const errorState = (
    <ListState
      variant="error"
      title={labels.error}
      sub={labels.errorDescription}
      retryLabel={labels.retry}
      onRetry={onRetry}
    />
  );

  let content: ReactNode;
  if (state.kind === 'loading') {
    content = <ListState variant="loading" />;
  } else if (state.kind === 'error') {
    content = errorState;
  } else if (state.kind === 'unavailable') {
    content = (
      <ListState
        variant="empty"
        title={labels.unavailable}
        sub={labels.unavailableDescription}
      />
    );
  } else if (formatInstantDate(state.asOf) === '—') {
    // AccountingSnapshotProvenance deliberately displays malformed timestamps as their raw input.
    // Statements require a safe display value, so reject them here without changing that shared
    // component's backwards-compatible behavior.
    content = errorState;
  } else {
    const isDelayed = state.delayed || state.background === 'failed';
    const isRefreshing = state.background === 'pending';
    const canRetry = isDelayed;

    content = (
      <>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <AccountingSnapshotProvenance asOf={state.asOf} updatedLabel={labels.updated} />
          {(isDelayed || isRefreshing) && (
            <div role="status" className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-warning-foreground">
              {isDelayed && <span>{labels.delayed}</span>}
              {isRefreshing && <span>{labels.refreshing}</span>}
            </div>
          )}
          {canRetry && (
            <Button variant="outline" size="sm" loading={isRefreshing} onClick={onRetry}>
              {labels.retry}
            </Button>
          )}
        </div>
        {state.hasActivity ? (
          <div className="min-w-0">{children}</div>
        ) : (
          <ListState
            variant="empty"
            title={labels.noActivity}
            sub={labels.noActivityDescription}
          />
        )}
      </>
    );
  }

  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <Card className="min-w-0">
        <CardHead level={2} id={headingId} className="min-w-0 flex-wrap break-words">
          {title}
        </CardHead>
        <CardPad className="flex min-w-0 flex-col gap-3">
          {context !== undefined && context !== '' && (
            <p className="min-w-0 break-words text-xs text-muted-foreground">{context}</p>
          )}
          {content}
        </CardPad>
      </Card>
    </section>
  );
}
