import { useId, type ReactNode } from 'react';
import { AccountingSnapshotProvenance } from '@/src/components/AccountingSnapshotProvenance';
import { Button } from '@/src/components/ui/Button';
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
  headingClassName?: string;
  onChooseScope?: () => void;
  chooseScopeLabel?: string;
  children?: ReactNode;
}

export function FinancialStatementsSection({
  title,
  context,
  state,
  labels,
  onRetry,
  headingClassName,
  onChooseScope,
  chooseScopeLabel,
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
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-2">
        <div className="min-w-0">
          <h3 className="type-section-head text-heading">{labels.unavailable}</h3>
          <p className="mt-1 break-words text-sm text-muted-foreground">{labels.unavailableDescription}</p>
        </div>
        {onChooseScope && (
          <Button variant="outline" className="min-h-11" onClick={onChooseScope}>
            {chooseScopeLabel}
          </Button>
        )}
      </div>
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
          <AccountingSnapshotProvenance showTime asOf={state.asOf} updatedLabel={labels.updated} />
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
          <p role="status" className="py-4 type-value text-muted-foreground">{labels.noActivity}</p>
        )}
      </>
    );
  }

  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <div className="mb-4 flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 id={headingId} className={`type-section-head break-words text-heading ${headingClassName ?? ''}`}>{title}</h2>
        {context !== undefined && context !== '' && (
          <p className="min-w-0 break-words text-sm text-muted-foreground">{context}</p>
        )}
      </div>
      <div className="min-w-0">{content}</div>
    </section>
  );
}
