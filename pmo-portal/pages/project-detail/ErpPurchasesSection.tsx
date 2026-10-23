import React, { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useErpPurchases } from '@/src/hooks/useErpPurchases';
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
export const ErpPurchasesSection: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { t } = useTranslation('finance');
  const may = usePermission();
  const canView = may('view', 'procurement');
  const canLink = may('create', 'erpPurchaseLink');
  const { data } = useErpPurchases(projectId, { enabled: canView });
  const today = localToday();
  const rows = useMemo(() => data ?? [], [data]);
  const orphans = useMemo(() => rows.filter((r) => r.procurementId === null), [rows]);
  const { aging, sharedOpen } = useMemo(() => projectAging(rows, today), [rows, today]);
  if (!canView || (orphans.length === 0 && aging.length === 0)) return null;

  const bucketLabel: Record<AgingBucket, string> = {
    notDue: t('erpPurchases.aging.notDue', 'Not due'),
    d1_30: t('erpPurchases.aging.d1_30', '1–30 days'),
    d31_60: t('erpPurchases.aging.d31_60', '31–60 days'),
    d61_90: t('erpPurchases.aging.d61_90', '61–90 days'),
    d90Plus: t('erpPurchases.aging.d90Plus', 'Over 90 days'),
  };

  return (
    <section className="mt-8" aria-labelledby="erp-purchases-heading">
      <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 id="erp-purchases-heading" className="text-[16px] font-bold tracking-[-0.01em]">
            {t('erpLinks.orphansTitle', 'ERPNext documents not in a purchase')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('erpPurchases.countedInActuals', 'Already counted in Actuals. Shown for reference, not added again.')}
          </p>
        </div>
        <Link to="/erp-purchases" className="text-sm font-medium text-primary hover:underline">
          {t('erpLinks.allOrphans', 'All unlinked ERPNext documents')}
        </Link>
      </div>

      {aging.map((a) => (
        <dl key={a.currency} aria-label={`${t('erpPurchases.aging.title', 'Unpaid by age')} · ${a.currency}`}
          className="mb-3 grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-border bg-card p-3 sm:grid-cols-6">
          {AGING_BUCKETS.map((b) => (
            <div key={b}>
              <dt className="text-xs text-muted-foreground">{bucketLabel[b]}</dt>
              <dd className="tabular-nums">{formatCurrency(a.buckets[b], a.currency)}</dd>
            </div>
          ))}
          <div>
            <dt className="text-xs text-muted-foreground">{t('erpPurchases.aging.total', 'Unpaid total')}</dt>
            <dd className="font-semibold tabular-nums">{formatCurrency(a.total, a.currency)}</dd>
          </div>
        </dl>
      ))}
      {sharedOpen > 0 && (
        <p className="mb-3 text-sm text-muted-foreground">
          {t('erpPurchases.aging.sharedExcluded', '{{count}} unpaid invoices shared with other projects are not in these figures.', { count: sharedOpen })}
        </p>
      )}

      {orphans.length > 0 && (
        <ErpOrphansSection rows={orphans} projectId={projectId} canLink={canLink} tableId="project-erp-orphans-table" />
      )}
    </section>
  );
};
