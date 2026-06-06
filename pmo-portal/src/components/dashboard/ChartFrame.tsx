import React from 'react';
import { ListState } from '@/src/components/ui/ListState';

export type ChartState = 'ready' | 'loading' | 'empty' | 'error';

export interface ChartFrameProps {
  state: ChartState;
  /** Skeleton row count for the loading variant (sized to the card body). */
  loadingRows?: number;
  emptyTitle?: string;
  emptySub?: string;
  emptyIcon?: import('@/src/components/ui/icons').IconName;
  errorTitle?: string;
  errorSub?: string;
  onRetry?: () => void;
  children: React.ReactNode;
}

/**
 * The single async wrapper for every chart/visual card. No card ever shows a
 * bare recharts axis frame or a blank chart: loading → skeleton, empty →
 * composed empty state, error → message + retry (ui-ux-pro-max §10
 * loading-chart / empty-data-state / error-state-chart). When ready it renders
 * the chart body unchanged.
 */
export const ChartFrame: React.FC<ChartFrameProps> = ({
  state,
  loadingRows = 6,
  emptyTitle = 'No data yet',
  emptySub,
  emptyIcon,
  errorTitle = 'Could not load this chart',
  errorSub,
  onRetry,
  children,
}) => {
  if (state === 'loading') {
    return <ListState variant="loading" rows={loadingRows} />;
  }
  if (state === 'empty') {
    return <ListState variant="empty" title={emptyTitle} sub={emptySub} icon={emptyIcon} />;
  }
  if (state === 'error') {
    return <ListState variant="error" title={errorTitle} sub={errorSub} onRetry={onRetry} />;
  }
  return <>{children}</>;
};
