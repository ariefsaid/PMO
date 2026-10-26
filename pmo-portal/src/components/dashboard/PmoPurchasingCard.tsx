import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHead } from '@/src/components/ui/Card';
import { ListState } from '@/src/components/ui/ListState';
import { StatusBarChart } from './StatusBarChart';
import { procurementStatusTone } from './procurementStatusTone';
import type { Tables } from '@/src/lib/supabase/database.types';

type ProcurementStatus = Tables<'procurements'>['status'];
type ProcurementDatum = { status: ProcurementStatus; count: number };

export function PmoPurchasingCard({
  data,
  isPending,
  isError,
  onRetry,
  labelFor,
  hrefFor,
}: {
  data: ProcurementDatum[];
  isPending: boolean;
  isError: boolean;
  onRetry?: () => void;
  labelFor?: (status: ProcurementStatus) => string;
  hrefFor?: (status: ProcurementStatus) => string;
}) {
  const { t } = useTranslation('dashboard');
  if (!isPending && !isError && data.length === 0) {
    return (
      <details data-testid="dashboard-proc-status" className="rounded-lg border border-border bg-card">
        <summary className="flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 font-medium">
          <span>{t('uxs03.pmoPurchasing', 'PMO purchasing requests')}</span>
          <span className="text-sm font-normal text-muted-foreground">{t('uxs19.dashboardEmpty', 'No PMO requests to show')}</span>
        </summary>
        <p className="px-4 pb-4 text-xs text-muted-foreground">
          {t('uxs03.pmoPurchasingScope', 'ERP-native purchases are outside this PMO request chart.')}
        </p>
      </details>
    );
  }

  return (
    <Card data-testid="dashboard-proc-status">
      <span className="sr-only">{`${data.reduce((sum, row) => sum + row.count, 0)} ${t('dashboard.chart.procStatus.noun', 'requests')}`}</span>
      <CardHead>{t('uxs03.pmoPurchasing', 'PMO purchasing requests')}</CardHead>
      <p className="px-4 text-xs text-muted-foreground">{t('uxs03.pmoPurchasingScope', 'ERP-native purchases are outside this PMO request chart.')}</p>
      <div className="px-4 pb-4 pt-2">
        {isError ? (
          <ListState variant="error" title={t('finance.procurementLoadError', "Couldn't load procurement")} onRetry={onRetry} />
        ) : isPending ? (
          <ListState variant="loading" rows={6} />
        ) : (
          <StatusBarChart
            data={data}
            toneFor={procurementStatusTone}
            label={t('dashboard.chart.procStatus.chartLabel', 'Procurement by status')}
            noun={t('dashboard.chart.procStatus.noun', 'requests')}
            hrefFor={hrefFor}
            labelFor={labelFor}
          />
        )}
      </div>
    </Card>
  );
}
