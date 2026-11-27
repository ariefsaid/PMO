import React from 'react';
import { ListState, type SkeletonSpec } from './ListState';
import { resolveReadState, type ReadQueryLike } from './readStateModel';

export interface ReadStateLoadingOptions extends Partial<SkeletonSpec> {
  label?: string;
  role?: 'status';
  ariaLabel?: string;
  testId?: string;
  className?: string;
}

export interface ReadStateProps<T> {
  query: ReadQueryLike<T>;
  /** Override how a loaded value is classified as empty (default: empty array or null). */
  isEmpty?: (data: T) => boolean;
  /** Error heading shown on a failed read (and as the retry banner above kept data on refresh error). */
  errorTitle: string;
  /** Optional supporting copy for the error state. */
  errorSub?: React.ReactNode;
  /** Optional retry button label override (defaults to ListState's localized Retry). */
  retryLabel?: string;
  /** Loading silhouette options forwarded to `ListState variant="loading"`. */
  loading?: ReadStateLoadingOptions;
  /** Custom loading renderer when the caller needs a specific layout wrapper. */
  renderLoading?: () => React.ReactNode;
  /** Empty state rendered ONLY on a successful empty read. Omit to render nothing when empty. */
  empty?: React.ReactNode;
  /** Render the error quietly (inline panel style). */
  quiet?: boolean;
  /** Render the error title as the page's level-one heading. */
  titleAsPageHeading?: boolean;
  /** Optional wrapper around the error alert (for example `CardPad` inside a `Card`). */
  wrapError?: (node: React.ReactNode) => React.ReactNode;
  /** Render function receiving guaranteed-defined loaded data. */
  children: (data: T) => React.ReactNode;
}

/**
 * Enforces the loading → retryable error (keeping loaded data) → genuine empty read rule
 * on top of `ListState` so screens never collapse a failed read into "nothing here".
 */
export function ReadState<T>({
  query,
  isEmpty,
  errorTitle,
  errorSub,
  retryLabel,
  loading,
  renderLoading,
  empty = null,
  quiet = false,
  titleAsPageHeading = false,
  wrapError,
  children,
}: ReadStateProps<T>): React.ReactNode {
  const phase = resolveReadState(query, { isEmpty });

  if (phase.status === 'loading') {
    if (renderLoading) return renderLoading();
    return (
      <ListState
        variant="loading"
        shape={loading?.shape}
        rows={loading?.rows}
        columns={loading?.columns}
        minHeight={loading?.minHeight}
        loadingLabel={loading?.label}
        loadingRole={loading?.role}
        loadingAriaLabel={loading?.ariaLabel}
        testId={loading?.testId}
        className={loading?.className}
      />
    );
  }

  const renderError = (onRetry: () => void, isRefresh: boolean) => {
    const node = (
      <ListState
        variant="error"
        title={errorTitle}
        sub={errorSub}
        retryLabel={retryLabel}
        quiet={quiet}
        titleAsPageHeading={!isRefresh && titleAsPageHeading}
        onRetry={onRetry}
      />
    );
    return wrapError ? wrapError(node) : node;
  };

  if (phase.status === 'error') {
    return renderError(phase.onRetry, false);
  }

  if (phase.status === 'empty') {
    return empty;
  }

  if (phase.refreshError) {
    return (
      <>
        {renderError(phase.refreshError.onRetry, true)}
        {children(phase.data)}
      </>
    );
  }

  return children(phase.data);
}
