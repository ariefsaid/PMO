import React, { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useErpOrphans, useErpPurchases } from '@/src/hooks/useErpPurchases';
import { Badge, ListState, Tooltip } from '@/src/components/ui';
import { cn } from '@/src/components/ui/cn';
import { usePermission } from '@/src/auth/usePermission';
import { formatCurrency } from '@/src/lib/format';
import { localToday } from '@/src/lib/efaktur';
import { AGING_BUCKETS, projectAging, type AgingBucket } from '@/src/lib/erpPurchaseAging';
import { ErpOrphansSection } from '../procurement/ErpOrphansSection';

/**
 * FR-EPR-008 / FR-PFE-041/042 — the project's ERPNext purchase documents that are not in a purchase yet, below its PMO
 * purchases, each linkable into one. Renders nothing until there is something to show, so a project without ERP history
 * keeps today's screen. Already counted in Actuals (GL mirror), so it shows no totals that could be read as extra spend
 * — only the AP aging of what is still unpaid, which keeps counting linked invoices too (FR-PFE-042).
 */
export const ErpPurchasesSection: React.FC<{
  projectId: string;
  title?: string;
  subtitle?: React.ReactNode;
  className?: string;
}> = ({ projectId, title, subtitle, className }) => {
  const { t } = useTranslation('finance');
  const may = usePermission();
  const canView = may('view', 'procurement');
  const canLink = may('create', 'erpPurchaseLink');
  const { data, isError: agingError, refetch: refetchAging } = useErpPurchases(projectId, { enabled: canView });
  const orphanQuery = useErpOrphans(projectId, { enabled: canView });
  const isError = agingError || orphanQuery.isError;
  const refetch = () => Promise.all([refetchAging(), orphanQuery.refetch()]);
  const today = localToday();
  const rows = useMemo(() => data ?? [], [data]);
  const orphans = orphanQuery.data ?? [];
  const { aging, sharedOpen } = useMemo(() => projectAging(rows, today), [rows, today]);
  if (!canView || (!isError && orphans.length === 0 && aging.length === 0)) return null;

  const bucketLabel: Record<AgingBucket, string> = {
    notDue: t('erpPurchases.aging.notDue', 'Not due'),
    d1_30: t('erpPurchases.aging.d1_30', '1–30 days'),
    d31_60: t('erpPurchases.aging.d31_60', '31–60 days'),
    d61_90: t('erpPurchases.aging.d61_90', '61–90 days'),
    d90Plus: t('erpPurchases.aging.d90Plus', 'Over 90 days'),
  };

  return (
    <section className={cn('mt-8', className)} aria-labelledby="erp-purchases-heading">
      <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 id="erp-purchases-heading" className="text-[16px] font-bold tracking-[-0.01em]">
            {title ?? t('erpLinks.orphansTitle', 'ERPNext documents not in a purchase')}
            {orphans.length > 0 && (
              <Tooltip content={t('erpLinks.orphansCountTooltip', 'Count of accounting-system documents not linked to a procurement. Source: ERP purchase documents.')}>
                <span tabIndex={0} className="ml-2 inline-flex rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                  <Badge>{orphans.length}</Badge>
                </span>
              </Tooltip>
            )}
          </h2>
          <p className="text-sm text-muted-foreground">
            {subtitle ?? t('erpPurchases.countedInActuals', 'Already counted in Actuals.')}
          </p>
        </div>
        <Link to="/erp-purchases" className="text-sm font-medium text-primary-text hover:underline">
          {t('erpLinks.allOrphans', 'All unlinked ERPNext documents')}
        </Link>
      </div>

      {isError && (
        <ListState variant="error" title={t('erpLinks.loadError', "Couldn't load the ERPNext documents not in a purchase")}
          onRetry={() => void refetch()} />
      )}

      {aging.length > 0 && (
        // Review 4: the aging counts every unpaid ERPNext invoice of the project, linked or not (FR-PFE-042), so it
        // carries its own title rather than reading as a total of the list below it.
        <section aria-labelledby="erp-aging-heading" className="mb-4">
          <h3 id="erp-aging-heading" className="mb-2 text-[14px] font-semibold text-foreground">
            {t('erpLinks.agingTitle', 'Unpaid ERPNext invoices (incl. linked)')}
          </h3>
          {aging.map((a) => (
            <dl key={a.currency} aria-label={`${t('erpPurchases.aging.title', 'Unpaid by age')} · ${a.currency}`}
              className="mb-3 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-border py-3 first-of-type:border-t-0 sm:grid-cols-6">
              {AGING_BUCKETS.map((b) => (
                <div key={b}>
                  <dt className="text-xs text-muted-foreground">{bucketLabel[b]}</dt>
              <dd className="tabular-nums">
                <Tooltip content={t('erpPurchases.aging.amountTooltip', 'Outstanding supplier invoice balances in {{currency}} grouped by due date. Includes linked and unlinked invoices; shared-project invoices are excluded.', { currency: a.currency })}>
                  <span tabIndex={0} className="rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{formatCurrency(a.buckets[b], a.currency)}</span>
                </Tooltip>
              </dd>
                </div>
              ))}
              <div>
                <dt className="text-xs text-muted-foreground">{t('erpPurchases.aging.total', 'Unpaid total')}</dt>
                <dd className="font-semibold tabular-nums">
                  <Tooltip content={t('erpPurchases.aging.amountTooltip', 'Outstanding supplier invoice balances in {{currency}} grouped by due date. Includes linked and unlinked invoices; shared-project invoices are excluded.', { currency: a.currency })}>
                    <span tabIndex={0} className="rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{formatCurrency(a.total, a.currency)}</span>
                  </Tooltip>
                </dd>
              </div>
            </dl>
          ))}
          {sharedOpen > 0 && (
            <Tooltip content={t('erpPurchases.aging.sharedCountTooltip', '{{count}} unpaid supplier invoices are assigned to more than one project. Their full balances are excluded from project aging.', { count: sharedOpen })}>
              <p tabIndex={0} className="w-fit rounded-sm text-sm text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                {t('erpPurchases.aging.sharedExcluded', '{{count}} unpaid invoices shared with other projects are not in these figures.', { count: sharedOpen })}
              </p>
            </Tooltip>
          )}
        </section>
      )}

      {orphans.length > 0 && (
        <ErpOrphansSection rows={orphans} projectId={projectId} canLink={canLink} tableId="project-erp-orphans-table" />
      )}
    </section>
  );
};
