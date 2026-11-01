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
export const InvoicedTrendCard: React.FC<InvoicedTrendCardProps> = ({ trend, pending, error, onRetry }) => {
  const { t } = useTranslation('dashboard');
  if (error) return <ListState variant="error" title={t('trend.error', "Couldn't load the invoiced trend")} onRetry={onRetry} />;
  if (pending) return <ListState variant="loading" rows={1} />;
  return trend ? <InvoicedTrendTile trend={trend} /> : null;
};
