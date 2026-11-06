import React from 'react';
import { useTranslation } from 'react-i18next';
import { ListState } from '@/src/components/ui/ListState';
import type { InvoicedTrend } from '@/src/lib/dashboardTrend';
import { InvoicedTrendTile } from './InvoicedTrendTile';

export interface InvoicedTrendCardProps {
  trend: InvoicedTrend | null | undefined;
  pending?: boolean;
  error?: boolean;
  onRetry?: () => void;
}

/** The trend's loading / error / nothing-invoiced states around the tile; the figures hook owns the data. */
// Perf (dashboard render work): memoised so a commit that only settled another dashboard query does
// not re-render the trend tile; `trend` is a value-memoised slice and `onRetry` a stable callback.
export const InvoicedTrendCard = React.memo(function InvoicedTrendCard({ trend, pending, error, onRetry }: InvoicedTrendCardProps) {
  const { t } = useTranslation('dashboard');
  if (error) return <ListState variant="error" title={t('trend.error', "Couldn't load the invoiced trend")} onRetry={onRetry} />;
  if (pending) return <ListState variant="loading" rows={1} className="min-h-[168px]" />;
  return trend ? <InvoicedTrendTile trend={trend} /> : null;
});
