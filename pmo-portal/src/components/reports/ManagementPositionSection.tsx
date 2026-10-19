import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { usePermission } from '@/src/auth/usePermission';
import { AccountingSnapshotsSection } from '@/src/components/dashboard/AccountingSnapshotsSection';
import { Button, Card } from '@/src/components/ui';
import { useManagementPosition } from '@/src/hooks/useManagementPack';
import { formatDateTime, formatExactMoney } from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import type { Margin } from '@/src/lib/projectFinances';
import type { ManagementPack } from '@/src/lib/reports/managementPack';
import type { PositionSourceState } from '@/src/lib/repositories/managementPosition';

const moneyText = (value: string | null, currency: string | null, unavailable: string) => {
  if (!value || !currency) return unavailable;
  return formatExactMoney(value, currency, getNumberLocale()) ?? unavailable;
};

const sourceTime = (value: string | null, unavailable: string) => {
  if (!value) return unavailable;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? unavailable : formatDateTime(parsed);
};

const marginReasonFallback: Record<Exclude<Margin['reason'], null>, string> = {
  'different-currencies': 'Invoice work and Actual use different currencies.',
  'work-unavailable': 'Complete billed-work revenue is unavailable.',
  'actuals-unavailable': 'Canonical Actual coverage is incomplete or unavailable.',
  'restricted-rows': 'Restricted rows are excluded from this Actual.',
};

const stateLabel = (state: PositionSourceState, t: (key: string, fallback: string) => string) => {
  if (state === 'loading') return t('uxs35.loading', 'Loading…');
  if (state === 'error') return t('uxs35.error', 'Could not load this source.');
  if (state === 'partial') return t('uxs35.partial', 'Partial coverage');
  if (state === 'not-requested') return t('uxs35.notRequested', 'Expand a project to load details.');
  return t('uxs35.unavailable', 'Unavailable');
};

const basisLabel = (basis: 'pmo' | 'erp' | 'unavailable', t: (key: string, fallback: string) => string) => {
  if (basis === 'pmo') return t('uxs35.basis.pmo', 'PMO ledger');
  if (basis === 'erp') return t('uxs35.basis.erp', 'ERP ledger');
  return t('uxs35.basis.unavailable', 'Unavailable');
};

const taxBasisLabel = (basis: 'inclusive' | 'exclusive' | 'mixed', t: (key: string, fallback: string) => string) => {
  if (basis === 'inclusive') return t('uxs35.taxBasis.inclusive', 'incl. tax');
  if (basis === 'exclusive') return t('uxs35.taxBasis.exclusive', 'excl. tax');
  return t('uxs35.taxBasis.mixed', 'mixed tax basis');
};

const marginReasonLabel = (reason: Exclude<Margin['reason'], null>, t: (key: string, fallback: string) => string) => {
  if (reason === 'different-currencies') return t('uxs35.marginReason.different-currencies', marginReasonFallback[reason]);
  if (reason === 'work-unavailable') return t('uxs35.marginReason.work-unavailable', marginReasonFallback[reason]);
  if (reason === 'actuals-unavailable') return t('uxs35.marginReason.actuals-unavailable', marginReasonFallback[reason]);
  return t('uxs35.marginReason.restricted-rows', marginReasonFallback[reason]);
};

export interface ManagementPositionSectionProps {
  pack: ManagementPack;
}

/** A read-only, latest-source position summary kept separate from the selected-month pack. */
export const ManagementPositionSection: React.FC<ManagementPositionSectionProps> = ({ pack }) => {
  const { t } = useTranslation();
  const may = usePermission();
  const [page, setPage] = useState(0);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const position = useManagementPosition(pack, page, expandedProjectId);
  const unavailable = t('uxs35.unavailable', 'Unavailable');
  const canViewStatements = may('view', 'financialStatements');
  const canViewProjectStatements = may('view', 'projectProfitLoss');
  const canViewSalesInvoices = may('view', 'salesInvoice');
  const visibleRows = position.rows;

  const openDetails = (projectId: string) => {
    setExpandedProjectId((current) => current === projectId ? null : projectId);
  };
  const movePage = (nextPage: number) => {
    setExpandedProjectId(null);
    setPage(nextPage);
  };

  const renderDetail = () => {
    const detail = position.detail;
    const row = visibleRows.find((candidate) => candidate.projectId === position.expandedProjectId);
    if (!position.expandedProjectId || !row) return null;
    if (!detail) {
      return (
        <div className="mt-3 border-t border-border pt-3" aria-live="polite">
          {position.projectState === 'error' ? (
            <p className="text-sm text-destructive">{stateLabel(position.projectState, t)} <Button variant="outline" size="default" className="min-h-11 sm:min-h-8" onClick={() => void position.retryProject()}>{t('uxs35.retry', 'Retry source')}</Button></p>
          ) : position.projectState === 'loading' ? (
            <p className="text-sm text-muted-foreground">{stateLabel(position.projectState, t)}</p>
          ) : position.financeState === 'error' ? (
            <p className="text-sm text-destructive">{stateLabel(position.financeState, t)} <Button variant="outline" size="default" className="min-h-11 sm:min-h-8" onClick={() => void position.retryFinances()}>{t('uxs35.retry', 'Retry source')}</Button></p>
          ) : position.financeState === 'loading' ? (
            <p className="text-sm text-muted-foreground">{stateLabel(position.financeState, t)}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{t('uxs35.detailUnavailable', 'Project detail is unavailable.')}</p>
          )}
        </div>
      );
    }

    const knownCash = detail.cash.state === 'known';
    const knownCollections = detail.collections?.state === 'known';
    const agingRows = knownCollections ? detail.collections!.positions : [];
    const customerLinks = new Map<string, string>();
    if (knownCollections && detail.customerId) {
      for (const agingRow of agingRows) {
        if (agingRow.party) customerLinks.set(agingRow.party, detail.customerId);
      }
    }

    return (
      <div className="mt-3 space-y-4 border-t border-border pt-3">
        {canViewProjectStatements && detail.projectId === row.projectId && (
          <Link className="touch-target inline-flex min-h-11 items-center rounded-lg border border-input px-3 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8" to={`/projects/${encodeURIComponent(detail.projectId)}/overview`}>
            {t('uxs35.openProject', 'Open project overview')}
          </Link>
        )}
        {detail.limitation === 'actuals-changed' && (
          <p className="text-sm text-muted-foreground" role="status">
            {t('uxs35.actualsChanged', 'ERP Actual readings changed between sources, so margin is unavailable.')}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <section aria-label={t('uxs35.cashReceived', 'Cash received')} className="min-w-0">
            <h4 className="text-sm font-semibold">{t('uxs35.cashReceived', 'Cash received')}</h4>
            <p className="mt-1 text-xs text-muted-foreground">{t('uxs35.cashScope', 'Receipt-backed cash, separate from invoice settlement.')}</p>
            <p className="mt-2 text-xs text-muted-foreground">{t('uxs35.sourceTimeUnavailable', 'Source update time not supplied')}</p>
            {knownCash ? (
              <ul className="mt-2 space-y-1 text-sm tabular-nums">
                {detail.cash.buckets.map((bucket) => (
                  <li key={bucket.currency} className="flex flex-wrap justify-between gap-x-3">
                    <span>{bucket.currency}</span><span>{moneyText(bucket.amount, bucket.currency, unavailable)}</span>
                  </li>
                ))}
                {detail.cash.buckets.length === 0 && (
                  <li className="flex flex-wrap justify-between gap-x-3">
                    <span>{detail.projectCurrency}</span><span>{moneyText('0.00', detail.projectCurrency, unavailable)}</span>
                  </li>
                )}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">{detail.cash.state === 'incomplete'
                ? t('uxs35.cashIncomplete', 'Cash amount is incomplete in the saved receipt data.')
                : unavailable}</p>
            )}
          </section>

          <section aria-label={t('uxs35.billedWork', 'Billed work to date')} className="min-w-0">
            <h4 className="text-sm font-semibold">{t('uxs35.billedWork', 'Billed work to date')}</h4>
            <p className="mt-1 text-xs text-muted-foreground">{t('uxs35.billedWorkScope', 'Billed work to date · net of tax')}</p>
            {position.financeState === 'error' ? (
              <p className="mt-2 text-sm text-destructive">{stateLabel(position.financeState, t)} <Button variant="outline" size="default" className="min-h-11 sm:min-h-8" onClick={() => void position.retryFinances()}>{t('uxs35.retry', 'Retry source')}</Button></p>
            ) : detail.billedWork.length > 0 ? (
              <ul className="mt-2 space-y-1 text-sm tabular-nums">
                {detail.billedWork.map((bucket) => (
                  <li key={bucket.currency} className="flex flex-wrap justify-between gap-x-3">
                    <span>{bucket.currency}</span>
                    <span>{bucket.missing_work > 0
                      ? t('uxs35.billedWorkIncomplete', 'Incomplete — invoice work amount missing')
                      : moneyText(bucket.work_revenue, bucket.currency, unavailable)}</span>
                    {bucket.missing_work > 0 && <span className="w-full text-xs text-muted-foreground">{t('uxs35.missingWork', {
                      count: bucket.missing_work,
                      defaultValue_one: '{{count}} invoice row lacks a work amount.',
                      defaultValue_other: '{{count}} invoice rows lack a work amount.',
                    })}</span>}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-sm text-muted-foreground">{unavailable}</p>}
            <div className="mt-3 border-t border-border pt-3">
              <h5 className="text-xs font-semibold">{t('uxs35.marginToDate', 'Billed-work margin to date')}</h5>
              {detail.margins.length > 0 ? (
                <ul className="mt-2 space-y-1 text-sm tabular-nums">
                  {detail.margins.map((margin, index) => (
                    <li key={`${margin.currency}-${index}`} className="flex flex-wrap justify-between gap-x-3">
                      <span>{margin.currency}</span>
                      <span>{margin.value.amount === null ? unavailable : moneyText(margin.value.amount, margin.currency, unavailable)}</span>
                      {margin.value.reason && (
                        <span className="w-full text-xs text-muted-foreground">
                          {marginReasonLabel(margin.value.reason, t)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-sm text-muted-foreground">{unavailable}</p>}
            </div>
          </section>

          <section aria-label={t('uxs35.projectOutstanding', 'Project invoice outstanding')} className="min-w-0">
            <h4 className="text-sm font-semibold">{t('uxs35.projectOutstanding', 'Project invoice outstanding')}</h4>
            <p className="mt-1 text-xs text-muted-foreground">{t('uxs35.projectOutstandingScope', 'Open invoices for this project only')}</p>
            {position.financeState === 'error' ? (
              <p className="mt-2 text-sm text-destructive">{stateLabel(position.financeState, t)} <Button variant="outline" size="default" className="min-h-11 sm:min-h-8" onClick={() => void position.retryFinances()}>{t('uxs35.retry', 'Retry source')}</Button></p>
            ) : detail.projectOutstanding.length > 0 ? (
              <ul className="mt-2 space-y-1 text-sm tabular-nums">
                {detail.projectOutstanding.map((bucket, index) => (
                  <li key={`${bucket.currency}-${index}`} className="flex flex-wrap justify-between gap-x-3">
                    <span>{bucket.currency} · {taxBasisLabel(bucket.tax_basis, t)}</span>
                    <span>{bucket.missing_outstanding > 0
                      ? t('projectFinances.incomplete', 'Incomplete — ERP outstanding missing')
                      : moneyText(bucket.outstanding, bucket.currency, unavailable)}</span>
                    {bucket.missing_outstanding > 0 && <span className="w-full text-xs text-muted-foreground">{t('uxs35.missingOutstanding', {
                      count: bucket.missing_outstanding,
                      defaultValue_one: '{{count}} invoice row lacks a known outstanding amount.',
                      defaultValue_other: '{{count}} invoice rows lack a known outstanding amount.',
                    })}</span>}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-sm text-muted-foreground">{unavailable}</p>}
          </section>
        </div>

        <section aria-label={t('uxs35.customerBalance', 'Customer balance — includes other projects')}>
          <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold">{t('uxs35.customerBalance', 'Customer balance — includes other projects')}</h4>
              <p className="mt-1 text-xs text-muted-foreground">{t('uxs35.customerScope', 'Customer-level ERP aging may include invoices from other projects.')}</p>
            </div>
            {detail.customerId && canViewSalesInvoices && (
              <div className="flex flex-wrap gap-2">
                <Link className="touch-target inline-flex min-h-11 items-center rounded-lg border border-input px-3 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8" to={`/companies/${encodeURIComponent(detail.customerId)}#collections`}>
                  {t('uxs35.openCollections', 'Open customer collections')}
                </Link>
                <Link className="touch-target inline-flex min-h-11 items-center rounded-lg border border-input px-3 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8" to={`/sales-invoices?customer=${encodeURIComponent(detail.customerId)}`}>
                  {t('uxs35.openCustomerInvoices', 'Open customer invoices')}
                </Link>
                <Link className="touch-target inline-flex min-h-11 items-center rounded-lg border border-input px-3 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8" to={`/sales-invoices?customer=${encodeURIComponent(detail.customerId)}&overdue=true&sort=oldest-overdue`}>
                  {t('uxs35.overdueInvoices', 'Overdue invoices first')}
                </Link>
              </div>
            )}
          </div>
          {position.collectionsState === 'error' ? (
            <p className="text-sm text-destructive">{stateLabel(position.collectionsState, t)} <Button variant="outline" size="default" className="min-h-11 sm:min-h-8" onClick={() => void position.retryCollections()}>{t('uxs35.retry', 'Retry source')}</Button></p>
          ) : position.collectionsState === 'loading' ? (
            <p className="text-sm text-muted-foreground">{stateLabel(position.collectionsState, t)}</p>
          ) : detail.collections?.state === 'ambiguous' ? (
            <p className="text-sm text-muted-foreground">{t('uxs35.customerAmbiguous', 'Customer aging is mapped to multiple companies, so its amounts are hidden.')}</p>
          ) : detail.collections?.state === 'known' ? (
            <AccountingSnapshotsSection
              showActuals={false}
              showApAging={false}
              actuals={[]}
              apAging={[]}
              arAging={agingRows}
              customerLinks={customerLinks}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{stateLabel(position.collectionsState, t)}</p>
          )}
        </section>
      </div>
    );
  };

  return (
    <section aria-labelledby="management-position-heading" className="mb-6 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="management-position-heading" className="text-lg font-semibold">{t('uxs35.heading', 'Current project position')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('uxs35.scope', 'Latest recorded position; separate from selected-period revenue.')}</p>
        </div>
        {canViewStatements && position.identityReady && (
          <Link className="touch-target inline-flex min-h-11 items-center rounded-lg border border-input px-3 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8" to="/financial-statements">
            {t('uxs35.companyStatements', 'Company statements')}
          </Link>
        )}
      </div>

      {position.actualState === 'loading' && visibleRows.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground" aria-live="polite">{stateLabel(position.actualState, t)}</Card>
      ) : visibleRows.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">{position.identityReady
          ? t('uxs35.noProjects', 'No assigned projects have a current position.')
          : t('uxs35.unavailable', 'Unavailable')}</Card>
      ) : (
        <>
        {position.actualState === 'error' && <Card className="flex flex-wrap items-center justify-between gap-3 p-4" role="status">
          <p className="text-sm text-destructive">{stateLabel(position.actualState, t)}</p>
          <Button variant="outline" size="default" className="min-h-11 sm:min-h-8" onClick={() => void position.retryActual()}>{t('uxs35.retry', 'Retry source')}</Button>
        </Card>}
        <ul className="space-y-2">
          {visibleRows.map((row) => {
            const expanded = row.projectId === position.expandedProjectId;
            const actual = row.actual;
            const amount = actual.state === 'known' || actual.state === 'partial'
              ? moneyText(actual.amount, actual.currency, unavailable)
              : stateLabel(actual.state, t);
            return (
              <li key={row.projectId}>
                <Card className="p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h3 className="break-words text-sm font-semibold">{row.projectName} · {t('uxs35.currentPositionLabel', 'current position')}</h3>
                      {row.projectNumber && <p className="mt-0.5 font-mono text-xs text-muted-foreground">{row.projectNumber}</p>}
                      <p className="mt-2 text-xs text-muted-foreground">{t('uxs35.recordedCostToDate', 'Recorded cost to date')}</p>
                      <p className="mt-0.5 tabular-nums text-base font-semibold">{amount}{actual.currency ? ` ${actual.currency}` : ''}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {actual.state === 'known' || actual.state === 'partial'
                          ? <>{actual.state === 'partial' && <>{t('uxs35.partial', 'Partial coverage')} · </>}{basisLabel(actual.basis, t)} · {t('uxs35.updated', 'Updated')} {sourceTime(actual.asOf, unavailable)}</>
                          : stateLabel(actual.state, t)}
                      </p>
                      {actual.excludesRestrictedRows && <p className="mt-1 text-xs text-muted-foreground">{t('uxs35.restrictedRowsExcluded', 'Restricted rows are excluded from this reading.')}</p>}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button variant="outline" size="default" className="min-h-11 sm:min-h-8" aria-expanded={expanded} aria-controls={`position-detail-${encodeURIComponent(row.projectId)}`} onClick={() => openDetails(row.projectId)}>
                        {expanded ? t('uxs35.hideDetails', 'Hide details') : t('uxs35.positionDetails', 'Position details')}
                      </Button>
                    </div>
                  </div>
                  {expanded && <div id={`position-detail-${encodeURIComponent(row.projectId)}`}>{renderDetail()}</div>}
                </Card>
              </li>
            );
          })}
        </ul>
        </>
      )}

      {position.pageCount > 1 && (
        <nav aria-label={t('uxs35.positionPages', 'Current position pages')} className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" size="default" className="min-h-11 sm:min-h-8" disabled={position.pageIndex === 0} onClick={() => movePage(position.pageIndex - 1)}>{t('uxs35.previous', 'Previous projects')}</Button>
          <span className="text-sm text-muted-foreground">{t('uxs35.pageOf', 'Page {{page}} of {{count}}', { page: position.pageIndex + 1, count: position.pageCount })}</span>
          <Button variant="outline" size="default" className="min-h-11 sm:min-h-8" disabled={position.pageIndex + 1 >= position.pageCount} onClick={() => movePage(position.pageIndex + 1)}>{t('uxs35.next', 'Next projects')}</Button>
        </nav>
      )}
    </section>
  );
};

ManagementPositionSection.displayName = 'ManagementPositionSection';
