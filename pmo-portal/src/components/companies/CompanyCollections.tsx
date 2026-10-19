import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AccountingSnapshotsSection } from '@/src/components/dashboard/AccountingSnapshotsSection';
import { ListState } from '@/src/components/ui/ListState';
import { useCompanyCollections } from '@/src/hooks/useCompanyCollections';

export interface CompanyCollectionsProps {
  companyId: string;
}

/** Read-only exact-company doorway to ERP aging and the PMO invoice list. */
export const CompanyCollections: React.FC<CompanyCollectionsProps> = ({ companyId }) => {
  const { t } = useTranslation();
  const collections = useCompanyCollections([companyId]);
  if (!collections.isEnabled) return null;

  const position = collections.byCompany.get(companyId) ?? { state: 'unavailable' as const, positions: [] };
  const invoiceUrl = `/sales-invoices?customer=${encodeURIComponent(companyId)}`;
  const overdueUrl = `${invoiceUrl}&overdue=true&sort=oldest-overdue`;

  return (
    <section id="collections" aria-labelledby="company-collections-heading" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="company-collections-heading" tabIndex={-1} className="text-[18px] font-semibold tracking-[-0.01em]">
          {t('dashboard.uxs36CollectionsHeading', 'Customer collections')}
        </h2>
        <div className="flex flex-wrap gap-2">
          <Link
            className="inline-flex min-h-8 items-center rounded-lg border border-input px-3 text-sm font-medium text-foreground underline-offset-2 hover:bg-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            to={invoiceUrl}
          >{t('dashboard.uxs36OpenInvoices', 'Open invoices')}</Link>
          <Link
            className="inline-flex min-h-8 items-center rounded-lg border border-input px-3 text-sm font-medium text-foreground underline-offset-2 hover:bg-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            to={overdueUrl}
          >{t('dashboard.uxs36OverdueInvoicesFirst', 'Overdue invoices first')}</Link>
        </div>
      </div>

      {collections.isError ? (
        <ListState
          variant="error"
          title={t('dashboard.uxs36CollectionsReadError', 'Customer collections could not be loaded.')}
          onRetry={() => { void collections.refetch(); }}
        />
      ) : collections.isPending ? (
        <ListState variant="loading" rows={3} />
      ) : position.state === 'ambiguous' ? (
        <p role="status" className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          {t('dashboard.uxs36CollectionsAmbiguous', 'This ERP customer is mapped to multiple companies. The aging amount is not assigned to this company.')}
        </p>
      ) : position.state === 'unavailable' ? (
        <ListState
          variant="empty"
          icon="doc"
          title={t('dashboard.uxs36CollectionsUnavailableTitle', 'Customer aging position unavailable')}
          sub={t('dashboard.uxs36CollectionsUnavailableDescription', 'No matching ERP customer aging position is available. This does not indicate a zero balance.')}
        />
      ) : (
        <AccountingSnapshotsSection
          showActuals={false}
          showApAging={false}
          actuals={[]}
          apAging={[]}
          arAging={position.positions}
        />
      )}
    </section>
  );
};

CompanyCollections.displayName = 'CompanyCollections';
