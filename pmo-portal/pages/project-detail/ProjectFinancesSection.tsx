import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ListState, TaxBasisLabel } from '@/src/components/ui';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { useProjectFinances } from '@/src/hooks/useProjectFinances';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { attributedSplit, buildProjectMoneyPosition, deriveMargin, formatExactMoney } from '@/src/lib/projectFinances';
import { useProjectCommittedSpend } from '@/src/hooks/useProcurements';
import { OtherCurrencyCommitments } from './OtherCurrencyCommitments';
import { formatInstantDate, formatShortMoney } from '@/src/lib/format';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { UnknownFigure } from './UnknownFigure';
import { formatProjectDetailAmount } from './formatProjectDetailMoney';
import { projectSectionHeading } from './typography';

export interface ProjectFinancesSectionProps {
  project: ProjectWithRefs;
  /** Budget totals and disclosures belong in the Cost group next to Actual. */
  costSupplement?: React.ReactNode;
  /** Authorized, dated org-currency conversion of the saved contract ceiling. */
  contractContext?: React.ReactNode;
  deliveryAttention?: React.ReactNode;
}

export function ProjectFinancesSection({ project, costSupplement, contractContext, deliveryAttention }: ProjectFinancesSectionProps) {
  const { t, i18n } = useTranslation();
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const canInspectAccounting = realRole === 'Finance' || realRole === 'Admin';
  const canManageAccounting = may('manage', 'orgAccounting');
  const query = useProjectFinances(project.id);
  const commitments = useProjectCommittedSpend(project.id, true);
  const unknown = t('projectFinances.unavailable', 'Unavailable');
  const moneyText = (value: string | null, currency: string | null, reason = unknown) =>
    (currency ? formatProjectDetailAmount(value, currency, i18n.language) : null) ?? reason;
  const money = (value: string | null, currency: string | null, reason = unknown): React.ReactNode => {
    const formatted = currency ? formatProjectDetailAmount(value, currency, i18n.language) : null;
    return formatted ?? <UnknownFigure reason={reason} />;
  };

  if (query.isPending) return (
    <>
      {contractContext}
      {deliveryAttention}
      <div role="group" aria-label={t('project:projectDetail.moneyPosition.spending', 'Spending')} className="min-w-0 space-y-4">
        <h3 className={projectSectionHeading}>{t('project:projectDetail.moneyPosition.spending', 'Spending')}</h3>
        {costSupplement}
        <ListState variant="loading" rows={2} loadingLabel={t('projectFinances.loading', 'Loading project finances…')} className="min-h-24" />
      </div>
      <div role="group" data-testid="project-finances" aria-label={t('project:projectDetail.moneyPosition.billing', 'Billing')} className="min-w-0">
        <h3 className={projectSectionHeading}>{t('project:projectDetail.moneyPosition.billing', 'Billing')}</h3>
      </div>
    </>
  );
  if (query.isError || !query.data) return (
    <>
      {contractContext}
      {deliveryAttention}
      <div role="group" aria-label={t('project:projectDetail.moneyPosition.spending', 'Spending')} className="min-w-0 space-y-4">
        <h3 className={projectSectionHeading}>{t('project:projectDetail.moneyPosition.spending', 'Spending')}</h3>
        {costSupplement}
        <div role="alert" className="flex flex-wrap items-center gap-2">
          {t('projectFinances.error', "Couldn't load project finances.")}
          <Button variant="outline" onClick={() => void query.refetch()}>{t('projectFinances.retry', 'Retry')}</Button>
        </div>
      </div>
      <div role="group" data-testid="project-finances" aria-label={t('project:projectDetail.moneyPosition.billing', 'Billing')} className="min-w-0">
        <h3 className={projectSectionHeading}>{t('project:projectDetail.moneyPosition.billing', 'Billing')}</h3>
      </div>
    </>
  );

  const data = query.data;
  const actuals = data.actuals;
  const moneyPosition = buildProjectMoneyPosition({ ledgerBasis: commitments.ledgerBasis,
    committedSpend: commitments.data, commitmentPending: commitments.isPending, commitmentError: commitments.isError,
    projectCurrency: project.currency, actuals, contractValue: project.contract_value, activeBudget: undefined });
  const actualPosition = moneyPosition.actual;
  const contractAfterCost = formatProjectDetailAmount(moneyPosition.contractAfterCost, project.currency, i18n.language);
  const mappedCategories = moneyPosition.coverage.mapped;
  const hasCoverage = moneyPosition.coverage.total > 0;
  const partialCategoryCoverage = hasCoverage && mappedCategories < actuals.categories.length;
  const needsCategorySetup = actualPosition.basis === 'erp' && actuals.categories.some((row) => !row.mapped);
  const noSpendingReading = !actualPosition.asOf && actualPosition.amount === null;
  const missingSpendingDate = !actualPosition.asOf && actualPosition.amount !== null;
  const needsSpendingExplanation = actualPosition.basis === 'erp' &&
    (noSpendingReading || missingSpendingDate || !hasCoverage || partialCategoryCoverage);
  const spendingExplanation = actualPosition.basis === 'erp' ? (() => {
    if (noSpendingReading) {
      if (!hasCoverage) return t(
        'project:spendingNoUpdateNoCategories',
        'No ERP spending update is available for this project yet, and no spending categories are mapped.',
      );
      if (partialCategoryCoverage) return t(
        'project:spendingNoUpdatePartial',
        'No ERP spending update is available for this project yet. Coverage is partial: {{mapped}} of {{total}} categories are mapped.',
        { mapped: mappedCategories, total: actuals.categories.length },
      );
      return t('project:noSpendingReading', 'No ERP spending update is available for this project yet.');
    }
    if (missingSpendingDate) {
      if (partialCategoryCoverage) return t(
        'project:spendingDateUnavailablePartial',
        'ERP spending is available, but its update date is not reported. Coverage is partial: {{mapped}} of {{total}} categories are mapped.',
        { mapped: mappedCategories, total: actuals.categories.length },
      );
      return t('project:spendingDateUnavailable', 'ERP spending is available, but its update date is not reported.');
    }
    if (!hasCoverage) return t('uxs01.coverageUnavailable', 'No ERP spending categories are mapped for this project.');
    if (partialCategoryCoverage) return t(
      'uxs01.partialCoverage',
      'Partial coverage · {{mapped}} of {{total}} spending categories mapped',
      { mapped: mappedCategories, total: actuals.categories.length },
    );
    return null;
  })() : null;
  const knownCategories: typeof actuals.categories = [];
  const unavailableCategories: typeof actuals.categories = [];
  for (const row of actuals.categories) {
    const known = row.mapped && actuals.currency !== null &&
      formatExactMoney(row.amount, actuals.currency, i18n.language) !== null;
    (known ? knownCategories : unavailableCategories).push(row);
  }
  // #1271 AC-3: tagged vs rule-attributed cost, named only when some of the (complete, ERP-ledger) total is attributed.
  const split = actualPosition.basis === 'erp' && actualPosition.complete
    ? attributedSplit({ tagged: actuals.tagged_total, attributed: actuals.attributed_total })
    : null;
  const cashUnavailable = t('uxs01.cashReceivedUnavailable', 'Unavailable — receipt-backed cash data is not available yet');
  const cashInvalid = t('uxs01.cashReceivedInvalid', 'Unavailable — receipt-backed cash data could not be verified');
  const cashReading = data.cash_received ?? { state: 'unavailable' as const, buckets: [], reason: 'not-reported' as const };
  const cashKnown = cashReading.state === 'known';
  const cashValue = cashReading.state === 'known'
    ? cashReading.buckets.length === 0
      ? formatProjectDetailAmount('0.00', project.currency, i18n.language) ?? cashInvalid
      : (() => {
        const amounts = cashReading.buckets.map(({ amount, currency }) => {
          const formatted = formatProjectDetailAmount(amount, currency, i18n.language);
          if (formatted === null) return null;
          return cashReading.buckets.length === 1 && currency === project.currency
            ? formatted
            : `${currency} ${formatted}`;
        });
        return amounts.every((amount): amount is string => amount !== null) ? amounts.join(' · ') : cashInvalid;
      })()
    : cashReading.state === 'incomplete'
      ? t('uxs01.cashReceivedIncomplete', 'Incomplete — receipt allocation cannot establish cash')
      : cashReading.reason === 'invalid-reading' ? cashInvalid : cashUnavailable;
  const cashScope = t('uxs01.cashReceivedScope', "Receipt cash linked to this project's invoices");
  const invoiceBalanceNote = t(
    'project:projectDetail.moneyPosition.invoiceBalanceClearedNote',
    'ERP-cleared value is invoiced less ERP outstanding; it may include non-cash settlement. Receipt-backed cash is shown separately above.',
  );
  const field = (label: string, value: React.ReactNode, basis?: React.ReactNode, labelTitle?: string) => (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-muted-foreground" title={labelTitle}>{label}</dt>
      <dd className="break-words text-sm font-normal tabular-nums">{value}</dd>
      {basis && <dd>{basis}</dd>}
    </div>
  );
  // PD-C: an unknown cash reading is a dash; the reason sits in the title (and for screen readers).
  const cashField = (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-muted-foreground">{t('uxs01.cashReceived', 'Cash received')}</dt>
      <dd className="break-words text-sm font-normal tabular-nums">
        {cashKnown && cashValue !== cashInvalid ? cashValue : <UnknownFigure reason={cashValue} />}
      </dd>
      <dd className="sr-only">{cashScope}</dd>
    </div>
  );
  const hasInvoices = data.invoices.length > 0;
  const remainingExact = formatProjectDetailAmount(data.remaining_to_invoice, project.currency, i18n.language);
  const remainingCompact = remainingExact === null
    ? null
    : formatShortMoney(Number(data.remaining_to_invoice), project.currency, { code: true });
  const primaryContent = (
    <section className="min-w-0 space-y-4" aria-label={t('project:projectDetail.moneyPosition.stillToInvoice', 'Still to invoice')}>
      <h2 data-primary-figure="true" aria-label={`${t('project:projectDetail.moneyPosition.stillToInvoice', 'Still to invoice')} · ${remainingCompact ?? project.currency}`}>
        <span className="project-primary-label">{t('project:projectDetail.moneyPosition.stillToInvoice', 'Still to invoice')}</span>
        <span className="project-primary-value">{remainingCompact ?? project.currency}</span>
      </h2>
      <dl className="project-facts min-w-0 space-y-2">
        {field(t('project:projectDetail.moneyPosition.exactRemaining', 'Exact remaining'), remainingExact ?? <UnknownFigure reason={unknown} />)}
        {cashField}
      </dl>
    </section>
  );

  const billingContent = (
    <>
      {/* PD-C: with no invoices, one line replaces Cash received, Invoiced 0, Remaining = contract
          and the scope note. */}
      {!hasInvoices && <p className="text-sm text-muted-foreground" data-testid="project-no-invoices">
        {t('project:noLinkedInvoices', 'No invoices linked to this project yet')}
      </p>}
      {hasInvoices && <>
        {data.invoices.map((bucket, index) => {
        const incomplete = t('project:invoiceBalanceUnavailable', 'Invoice balance is not available yet');
        return (
          <section key={bucket.currency} className="min-w-0 space-y-4" data-testid={`project-finances-${bucket.currency}`}>
            <h3 className={projectSectionHeading}>
              {t('project:projectDetail.moneyPosition.billing', 'Billing')} · {bucket.currency} · {bucket.tax_basis === 'mixed'
                ? t('projectFinances.mixedTaxBases', 'Mixed tax bases')
                : <TaxBasisLabel treatment={bucket.tax_basis} showDetails={false} />}
            </h3>
            {index === 0 && <details><summary className="min-h-11 cursor-pointer text-xs font-semibold">{t('project:projectDetail.moneyPosition.settlementDetails', 'Cash and non-cash settlement details')}</summary><p className="text-sm text-muted-foreground">{invoiceBalanceNote}</p></details>}
            <dl className="project-facts min-w-0 space-y-2">
              {field(t('projectFinances.invoiced', 'Invoiced'), money(bucket.invoiced, bucket.currency))}
              {field(t('project:projectDetail.moneyPosition.clearedAgainstInvoices', 'Cleared against invoices'), bucket.missing_outstanding > 0
                ? <UnknownFigure reason={incomplete} />
                : money(bucket.settled, bucket.currency))}
              {field(t('project:projectDetail.moneyPosition.erpOutstanding', 'ERP invoice balance outstanding'), bucket.missing_outstanding > 0
                ? <UnknownFigure reason={incomplete} />
                : money(bucket.outstanding, bucket.currency))}
            </dl>
            <details className="min-w-0">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                {t('project:projectDetail.moneyPosition.viewInvoices', 'View invoices')} · {bucket.invoice_count}
              </summary>
              <p className="text-sm text-muted-foreground">
                {t('project:projectDetail.moneyPosition.invoiceRecordsInBilling', 'Invoice records are in the Billing section.')}
              </p>
            </details>
          </section>
        );
        })}
      </>}
    </>
  );
  const spendingContent = (
    <div className="min-w-0 space-y-2">
        {/* PD-C: Recorded spending is the ONE home for coverage — shown only when partial — and
            its freshness is one inline "Updated" beside the amount. */}
        <dl className="project-facts min-w-0 space-y-2">
          <div className="min-w-0">
            <dt className="text-xs font-semibold text-muted-foreground">{t('uxs01.recordedSpending', 'Recorded spending')}</dt>
            <dd className="break-words text-sm font-normal tabular-nums">{money(actualPosition.amount, actualPosition.currency, unknown)}</dd>
          </div>
        </dl>
        {contractAfterCost !== null && <p className="text-sm">
          <span className="text-xs text-muted-foreground">{t('uxs01.contractRemainingAfterCost', 'Contract remaining after cost')}</span>
          <span data-testid="contract-after-cost" className="ml-2 font-semibold tabular-nums">{contractAfterCost}</span>
        </p>}
        {actualPosition.basis === 'pmo' && <OtherCurrencyCommitments positions={commitments.otherCurrencies} />}
        {split && (
          <p className="text-xs text-muted-foreground" data-testid="spending-attributed-note">
            {split.tagged
              ? t('costAttribution:split.note', 'Includes {{attributed}} attributed by cost rules · {{tagged}} tagged in the ERP', {
                attributed: moneyText(split.attributed, actualPosition.currency), tagged: moneyText(split.tagged, actualPosition.currency) })
              : t('costAttribution:split.noteAttributedOnly', 'Includes {{attributed}} attributed by cost rules', {
                attributed: moneyText(split.attributed, actualPosition.currency) })}
          </p>
        )}
        {needsSpendingExplanation && (
          <div className="space-y-1 text-xs text-muted-foreground" data-testid="spending-data-explanation">
            <p>
              {spendingExplanation}
            </p>
            {needsCategorySetup ? (
              <p data-testid="spending-setup-prompt">
                {canManageAccounting
                  ? <Link className="touch-target inline-flex min-h-11 items-center font-medium text-primary-text underline-offset-4 hover:underline" to="/administration/accounting#budget-account-map">
                      {t('project:finishSpendingSetup', 'Finish spending setup')}
                    </Link>
                  : t('project:spendingAdminHandoff', 'Ask Finance or an administrator to finish this project’s spending setup.')}
              </p>
            ) : (
              <p data-testid="spending-sync-next-step">
                {canManageAccounting
                  ? <Link className="touch-target inline-flex min-h-11 items-center font-medium text-primary-text underline-offset-4 hover:underline" to="/administration/integrations">
                      {t('project:reviewErpSync', 'Check ERP project sync')}
                    </Link>
                  : t('project:spendingSyncHandoff', 'Ask Finance or an administrator to check this project’s ERP link and latest sync.')}
              </p>
            )}
          </div>
        )}
        {actualPosition.basis === 'erp' && actuals.excludes_restricted_rows && (
          <p className="text-xs text-muted-foreground">{t('projectFinances.restricted', 'Actuals exclude restricted rows')}</p>
        )}
        {actualPosition.basis === 'erp' && knownCategories.length > 0 && <details className="min-w-0">
          <summary className="cursor-pointer text-sm font-medium">{t('uxs01.showCategoryDetails', 'Show category details')}</summary>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{t('uxs01.categoryDetails', 'Recorded spending by category')}</caption>
            <thead>
              <tr>
                <th scope="col" className="text-left">{t('projectFinances.category', 'Category')}</th>
                <th scope="col" className="text-right">{t('uxs01.recordedSpending', 'Recorded spending')}</th>
              </tr>
            </thead>
            <tbody>
              {knownCategories.map((row) => (
                <tr key={row.category}>
                  <th scope="row" className="break-words text-left font-normal">
                    {budgetCategoryLabel(row.category as Parameters<typeof budgetCategoryLabel>[0], t)}
                  </th>
                  <td className="break-words text-right tabular-nums">
                    {money(row.amount, actuals.currency)}
                    {(() => {
                      const part = attributedSplit({ attributed: row.attributed_amount });
                      return part && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {t('costAttribution:split.inline', 'incl. {{attributed}} attributed', { attributed: moneyText(part.attributed, actuals.currency) })}
                        </span>
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </details>}
        {actualPosition.basis === 'erp' && canInspectAccounting && unavailableCategories.length > 0 && (
          <details className="min-w-0">
            <summary className="cursor-pointer text-sm font-medium">{t('project:spendingSetupDetails', 'Spending setup details')}</summary>
            <ul className="mt-2 list-disc pl-5 text-sm">
              {unavailableCategories.map((row) => <li key={row.category}>
                {budgetCategoryLabel(row.category as Parameters<typeof budgetCategoryLabel>[0], t)}
                {' — '}{row.mapped
                  ? t('project:noSpendingReading', 'No ERP spending update is available for this project yet.')
                  : t('project:categoryNeedsSetup', 'Spending setup is not complete for this category.')}
              </li>)}
            </ul>
          </details>
        )}
      </div>
  );

  const marginContent = data.invoices.map((bucket) => {
    const margin = deriveMargin(bucket, actuals);
    const reasons = {
      'different-currencies': t('projectFinances.differentCurrencies', 'Unavailable — different currencies'),
      'work-unavailable': t('projectFinances.workUnavailable', 'Billed-work revenue unavailable'),
      'actuals-unavailable': t('projectFinances.actualsUnavailable', 'Not available yet'),
      'restricted-rows': t('projectFinances.restricted', 'Actuals exclude restricted rows'),
    };
    return (
      <section key={bucket.currency} className="min-w-0 space-y-4">
        <h3 className={projectSectionHeading}>
          {t('projectFinances.margin', 'Margin')} · {bucket.currency} · {t('project:billedWorkQualifier', 'Net of tax; advances excluded')}
        </h3>
        <dl className="project-facts min-w-0 space-y-2">
          {field(t('project:billedWork', 'Billed-work revenue'), money(bucket.work_revenue, bucket.currency, reasons['work-unavailable']))}
          {field(t('projectFinances.margin', 'Margin'), margin.reason
            ? <UnknownFigure reason={reasons[margin.reason]} />
            : money(margin.amount, bucket.currency))}
        </dl>
      </section>
    );
  });

  return (
    <div className="min-w-0 space-y-8" data-testid="money-position-groups">
      {primaryContent}
      {deliveryAttention}
      <section role="group" aria-label={t('project:projectDetail.moneyPosition.billing', 'Billing')} className="min-w-0 space-y-4">
        {!hasInvoices && <h3 className={projectSectionHeading}>{t('project:projectDetail.moneyPosition.billing', 'Billing')}</h3>}
        {contractContext}
        {billingContent}
        {hasInvoices && <p className="text-xs text-muted-foreground" data-testid="project-invoicing-scope">
          {t('project:invoiceScope', 'Only invoices linked to this project are included.')}
        </p>}
      </section>
      <section role="group" aria-label={t('project:projectDetail.moneyPosition.spending', 'Spending')} className="min-w-0 space-y-4">
        <h3 className={projectSectionHeading}>
          {t('project:projectDetail.moneyPosition.spending', 'Spending')}{actualPosition.currency ? ` · ${actualPosition.currency}` : ''}
          {actualPosition.basis === 'erp' && ` · ${t('project:projectDetail.moneyPosition.erpActuals', 'ERP actuals')}`}
          {actualPosition.basis === 'erp' && actualPosition.asOf
            ? ` · ${t('uxs01.updated', 'Updated {{date}}', { date: formatInstantDate(actualPosition.asOf) })}`
            : actualPosition.basis === 'pmo' ? ` · ${t('uxs01.pmoCoverage', 'Committed PMO purchase orders')}` : ''}
          {actualPosition.basis === 'unavailable' && ` · ${t('project:projectDetail.moneyPosition.basisUnavailable', 'Basis unavailable')}`}
        </h3>
        {spendingContent}
        {costSupplement}
      </section>
      <section role="group" data-testid="project-finances" aria-label={t('projectFinances.margin', 'Margin')} className="min-w-0 space-y-4">
        {!hasInvoices && <h3 className={projectSectionHeading}>{t('projectFinances.margin', 'Margin')}</h3>}
        {marginContent}
      </section>
    </div>
  );
}
