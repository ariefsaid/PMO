import React from 'react';
import { useTranslation } from 'react-i18next';
import { ListState } from '@/src/components/ui/ListState';
import type { InvoicedTrend } from '@/src/lib/dashboardTrend';
import { InvoicedTrendTile } from './InvoicedTrendTile';

export interface InvoicedTrendCardProps {
  trend: InvoicedTrend | null | undefined;
  pending?: boolean;
  error?: boolean;
  onRetry: () => void;
  /** Drawn inside another card: the tile drops its own frame. */
  bare?: boolean;
  /** Small line only, no second headline figure. */
  compact?: boolean;
}

/** #2055: a trend with fewer than three months reads as a crash, so it is hidden until it has them. The trend's loading / error / nothing-invoiced states around the tile; the figures hook owns the data. */
export const InvoicedTrendCard: React.FC<InvoicedTrendCardProps> = ({ trend, pending, error, onRetry, bare, compact }) => {
  const { t } = useTranslation('dashboard');
  if (error) return <ListState variant="error" title={t('trend.error', "Couldn't load the invoiced trend")} onRetry={onRetry} />;
  if (pending) return <ListState variant="loading" rows={1} className={compact ? 'min-h-[88px]' : 'min-h-[168px]'} />;
  return trend?.hasLine ? <InvoicedTrendTile trend={trend} bare={bare} compact={compact} /> : null;
};
