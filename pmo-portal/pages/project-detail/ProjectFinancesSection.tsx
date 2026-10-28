import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, TaxBasisLabel, type Column } from '@/src/components/ui';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { useProjectFinances } from '@/src/hooks/useProjectFinances';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { attributedSplit, buildProjectMoneyPosition, deriveMargin, moneyUnits } from '@/src/lib/projectFinances';
import { useProjectCommittedSpend } from '@/src/hooks/useProcurements';
import { OtherCurrencyCommitments } from './OtherCurrencyCommitments';
import { isTaxTreatment } from '@/src/lib/taxTreatment';
import { ON_HAND_STATUSES } from '@/src/lib/db/projectTransitions';
import { formatExactMoney, formatInstantDate, formatNumberMax2 } from '@/src/lib/format';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import FxEquivalent from '@/src/components/fx/FxEquivalent';

export function ProjectFinancesSection({ project }: { project: ProjectWithRefs }) {
  const { t, i18n } = useTranslation('project');
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const canInspectAccounting = realRole === 'Finance' || realRole === 'Admin';
  const canManageAccounting = may('manage', 'orgAccounting');
  const query = useProjectFinances(project.id);
  const commitments = useProjectCommittedSpend(project.id, true);
  // C5: no padded .00, and a real fraction (0.11 outstanding) is never rounded away to 0. C6: a figure in the section's own currency is bare (the Money position heading and each
  // currency heading name it once); only a figure in another currency carries its code. C4: an unknown figure is
  // null, and the caller leaves it out rather than printing a placeholder.
  const money = (value: string | null, currency: string | null, sectionCurrency: string | null = project.currency): string | null => {
    const units = moneyUnits(value);
    if (units === null || !currency) return null;
    const amount = formatNumberMax2(Number(units) / 100);
    return currency === sectionCurrency ? amount : `${currency} ${amount}`;
  };
  const title = <h2 className="text-sm font-semibold">{t('projectFinances.title', 'Project finances')}</h2>;

  if (query.isPending) return (
    <section data-testid="project-finances" aria-label={t('projectFinances.title', 'Project finances')}>
      {title}<p role="status">{t('projectFinances.loading', 'Loading project finances…')}</p>
    </section>
  );
  if (query.isError || !query.data) return (
    <section data-testid="project-finances" aria-label={t('projectFinances.title', 'Project finances')}>
      {title}
      <div role="alert">
        {t('projectFinances.error', "Couldn't load project finances.")}
        <Button variant="outline" onClick={() => void query.refetch()}>{t('projectFinances.retry', 'Retry')}</Button>
      </div>
    </section>
  );

  const data = query.data;
  const actuals = data.actuals;
  const moneyPosition = buildProjectMoneyPosition({ ledgerBasis: commitments.ledgerBasis,
    committedSpend: commitments.data, commitmentPending: commitments.isPending, commitmentError: commitments.isError,
    projectCurrency: project.currency, actuals, contractValue: project.contract_value, activeBudget: undefined });
  const actualPosition = moneyPosition.actual;
  const mappedCategories = moneyPosition.coverage.mapped;
  const hasCoverage = moneyPosition.coverage.total > 0;
  const completeCoverage = moneyPosition.coverage.kind === 'complete';
  const needsCategorySetup = actualPosition.basis === 'erp' && actuals.categories.some((row) => !row.mapped);
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
  const hasSettlement = data.invoices.some((bucket) => (moneyUnits(bucket.settled) ?? 0n) > 0n);
  const onHand = ON_HAND_STATUSES.includes(project.status as string);
  const cashReading = data.cash_received ?? { state: 'unavailable' as const, buckets: [], reason: 'not-reported' as const };
  // Project-currency cash is already Money position's "Cash received"; this drill-down adds only other currencies.
  const otherCurrencyCash = cashReading.state === 'known'
    ? cashReading.buckets.filter((bucket) => bucket.currency !== project.currency)
      .map(({ amount, currency }) => money(amount, currency)).filter((amount): amount is string => amount !== null)
    : [];
  const cashScope = t('uxs01.cashReceivedScope', "Receipt cash linked to this project's invoices");
  const settlementNote = t('projectFinances.settlementNote', 'Settled against invoices (cash, withholding and credits), not cash received.');
  const field = (label: string, value: string | null, basis?: React.ReactNode, labelTitle?: string) => value === null ? null : (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground" title={labelTitle}>{label}</dt>
      <dd className="break-words text-sm font-semibold tabular-nums">{value}</dd>
      {basis && <dd>{basis}</dd>}
    </div>
  );
  const marginOut = {
    'different-currencies': t('projectDetail.money.marginOutCurrency', 'Gross margin is left out because spending and billed work use different currencies.'),
    'work-unavailable': t('projectDetail.money.marginOutWork', 'Gross margin is left out until billed-work revenue is complete.'),
    'actuals-unavailable': t('projectDetail.money.marginOutActuals', 'Gross margin is left out until spending is linked for every budget category.'),
    'restricted-rows': t('projectDetail.money.marginOutRestricted', 'Gross margin is left out because spending excludes restricted rows.'),
  };
  const recordedSpending = money(actualPosition.amount, actualPosition.currency);
  const categoryColumns: Column<(typeof actuals.categories)[number]>[] = [
    { key: 'category', header: t('projectFinances.category', 'Category'), kind: 'primary', rowHeader: true,
      cell: (row) => budgetCategoryLabel(row.category as Parameters<typeof budgetCategoryLabel>[0], t) },
    { key: 'amount', header: t('uxs01.recordedSpending', 'Recorded spending'), kind: 'money', align: 'num',
      cell: (row) => {
        const part = attributedSplit({ attributed: row.attributed_amount });
        return <span className="tabular-nums">
          {money(row.amount, actuals.currency, actuals.currency)}
          {part && <span className="block text-xs font-normal text-muted-foreground">
            {t('costAttribution:split.inline', 'incl. {{attributed}} attributed', { attributed: money(part.attributed, actuals.currency, actuals.currency) })}
          </span>}
        </span>;
      } },
  ];
  const hasInvoices = data.invoices.length > 0;

  return (
    <section
      className="min-w-0 space-y-4 border-y border-border py-4"
      data-testid="project-finances"
      aria-label={t('projectFinances.title', 'Project finances')}
    >
      {title}
      <dl className="grid min-w-0 gap-4 border-b border-border/70 pb-4 sm:grid-cols-3" data-testid="project-finance-position-details">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t('uxs01.contractRemainingAfterCost', 'Contract remaining after cost')}</dt>
          <dd className="break-words text-sm font-semibold tabular-nums">
            {money(moneyPosition.contractAfterCost, project.currency) ?? <span className="text-xs font-normal text-muted-foreground">{t('projectFinances.contractAfterCostPending', 'Shown once recorded spending is complete.')}</span>}
          </dd>
          <dd className="text-xs text-muted-foreground">{t('projectFinances.contractAfterCostSource', 'Contract value minus comparable recorded Actual.')}</dd>
        </div>
        {/* L6: Actual is the Recorded spending figure below (with its basis and freshness), so it is not repeated here. */}
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t('projectDetail.money.contract', 'Contract')}</dt>
          <dd><FxEquivalent amount={project.contract_value} currency={project.currency} date={project.contract_date} compact /></dd>
          {isTaxTreatment(project.tax_treatment) && <dd><TaxBasisLabel treatment={project.tax_treatment} taxRate={project.tax_rate}
            taxBaseNumerator={project.tax_base_numerator} taxBaseDenominator={project.tax_base_denominator} showDetails testId="contract-detail-tax-basis" /></dd>}
        </div>
      </dl>
      {/* PD-C: with no invoices, one line replaces Cash received, Invoiced 0, Remaining = contract
          and the scope note. */}
      {!hasInvoices && <p className="text-sm text-muted-foreground" data-testid="project-no-invoices">
        {t('project:noLinkedInvoices', 'No invoices linked to this project yet')}
      </p>}
      {hasInvoices && <dl className="grid min-w-0 gap-4 sm:grid-cols-3">
        {otherCurrencyCash.length > 0 && field(t('uxs01.cashReceived', 'Cash received'), otherCurrencyCash.join(' · '), <span className="text-xs text-muted-foreground">{cashScope}</span>)}
        {onHand && field(t('projectFinances.contractInvoiced', 'Invoiced against contract'), money(data.contract_invoiced, project.currency),
          isTaxTreatment(project.tax_treatment) && <TaxBasisLabel treatment={project.tax_treatment} showDetails={false} testId="project-invoiced-basis" />)}
        {onHand && field(t('projectFinances.remaining', 'Remaining to invoice'), money(data.remaining_to_invoice, project.currency),
          isTaxTreatment(project.tax_treatment) && <TaxBasisLabel treatment={project.tax_treatment} showDetails={false} testId="project-remaining-basis" />)}
      </dl>}
      {data.invoices.map((bucket) => {
        const margin = deriveMargin(bucket, actuals);
        const balancesKnown = bucket.missing_outstanding === 0;
        const own = (value: string | null) => money(value, bucket.currency, bucket.currency);
        return (
          <div key={bucket.currency} className="min-w-0 space-y-2" data-testid={`project-finances-${bucket.currency}`}>
            <div>
              <h3 className="text-sm font-semibold">{bucket.currency}</h3>
              <p className="text-xs text-muted-foreground">{t('financeCopy.invoiceCount', '{{count}} invoices', { count: bucket.invoice_count })}</p>
            </div>
            <dl className="grid min-w-0 gap-4 sm:grid-cols-3">
              {field(t('projectFinances.invoiced', 'Invoiced'), own(bucket.invoiced))}
              {balancesKnown && field(t('projectFinances.settled', 'Settled'), own(bucket.settled), undefined, hasSettlement ? settlementNote : undefined)}
              {balancesKnown && field(t('projectFinances.outstanding', 'Outstanding'), own(bucket.outstanding))}
              {field(t('project:billedWork', 'Billed-work revenue'), own(bucket.work_revenue),
                undefined, t('project:billedWorkQualifier', 'Net of tax; advances excluded'))}
              {!margin.reason && field(t('projectFinances.margin', 'Margin'), own(margin.amount))}
            </dl>
            {/* C4: unknown figures are left out above; each reason is said once here. */}
            {!balancesKnown && <p className="text-xs text-muted-foreground">{t('project:invoiceBalanceUnavailable', 'Invoice balance is not available yet')}</p>}
            {margin.reason && <p className="text-xs text-muted-foreground">{marginOut[margin.reason]}</p>}
            <div className="text-xs text-muted-foreground">
              {bucket.tax_basis === 'mixed'
                ? t('projectFinances.mixedTaxBases', 'Mixed tax bases')
                : <TaxBasisLabel treatment={bucket.tax_basis} showDetails={false} />}
            </div>
          </div>
        );
      })}
      <div className="min-w-0 space-y-2">
        <h3 className="text-sm font-semibold">
          {t('uxs01.recordedSpending', 'Recorded spending')}{actualPosition.currency ? ` · ${actualPosition.currency}` : ''}
        </h3>
        {/* PD-C: Recorded spending is the ONE home for coverage — shown only when partial — and
            its freshness is one inline "Updated" beside the amount. */}
        {(recordedSpending !== null || (actualPosition.basis === 'erp' && actualPosition.asOf)) && <p className="break-words font-semibold tabular-nums">
          {money(actualPosition.amount, actualPosition.currency, actualPosition.currency)}
          {actualPosition.basis === 'erp' && actualPosition.asOf && <span className="ml-2 text-xs font-normal text-muted-foreground">
            {t('uxs01.updated', 'Updated {{date}}', { date: formatInstantDate(actualPosition.asOf) })}
          </span>}
        </p>}
        {recordedSpending === null && completeCoverage && actualPosition.basis !== 'pmo'
          && <p className="text-xs text-muted-foreground">{t('uxs01.coverageUnavailable', 'Spending coverage unavailable')}</p>}
        {actualPosition.basis === 'pmo'
          ? <p className="text-xs text-muted-foreground">
            {t('uxs01.pmoCoverage', 'Committed PMO purchase orders')}
          </p>
          : !completeCoverage && <p className="text-xs text-muted-foreground">
            {hasCoverage
              ? completeCoverage
                ? t('uxs01.completeCoverage', 'Complete category coverage')
                : t('uxs01.partialCoverage', 'Partial coverage · {{mapped}} of {{total}} categories recorded', { mapped: mappedCategories, total: actuals.categories.length })
              : t('uxs01.coverageUnavailable', 'Spending coverage unavailable')}
          </p>}
        <OtherCurrencyCommitments positions={commitments.otherCurrencies} />
        {split && (
          <p className="text-xs text-muted-foreground" data-testid="spending-attributed-note">
            {split.tagged
              ? t('costAttribution:split.note', 'Includes {{attributed}} attributed by cost rules · {{tagged}} tagged in the ERP', {
                attributed: money(split.attributed, actualPosition.currency, actualPosition.currency), tagged: money(split.tagged, actualPosition.currency, actualPosition.currency) })
              : t('costAttribution:split.noteAttributedOnly', 'Includes {{attributed}} attributed by cost rules', {
                attributed: money(split.attributed, actualPosition.currency, actualPosition.currency) })}
          </p>
        )}
        {actualPosition.basis === 'erp' && !actualPosition.asOf &&
          <p className="text-xs text-muted-foreground">{t('project:noSpendingReading', "Spending hasn't been updated yet.")}</p>}
        {needsCategorySetup && canInspectAccounting && (
          <p className="text-xs text-muted-foreground" data-testid="spending-setup-prompt">
            {canManageAccounting
              ? <Link className="font-medium text-primary-text underline-offset-4 hover:underline" to="/administration/accounting#budget-account-map">
                  {t('project:finishSpendingSetup', 'Finish spending setup')}
                </Link>
              : t('project:spendingAdminHandoff', 'Ask an administrator to finish spending setup.')}
          </p>
        )}
        {actualPosition.basis === 'erp' && actuals.excludes_restricted_rows && <p role="status">{t('projectFinances.restricted', 'Actuals exclude restricted rows')}</p>}
        {actualPosition.basis === 'erp' && knownCategories.length > 0 && <details className="min-w-0">
          <summary className="cursor-pointer text-sm font-medium">{t('uxs01.showCategoryDetails', 'Show category details')}</summary>
          {/* F10: the shared DataTable rather than a hand-rolled table. */}
          <div className="mt-2">
            <DataTable
              embedded
              rows={knownCategories}
              columns={categoryColumns}
              rowKey={(row) => row.category}
              accessibleName={t('uxs01.categoryDetails', 'Recorded spending by category')}
              tableId="project-finances-recorded-spending"
            />
          </div>
        </details>}
        {actualPosition.basis === 'erp' && canInspectAccounting && unavailableCategories.length > 0 && (
          <details className="min-w-0">
            <summary className="cursor-pointer text-sm font-medium">{t('project:spendingSetupDetails', 'Spending setup details')}</summary>
            <ul className="mt-2 list-disc pl-5 text-sm">
              {unavailableCategories.map((row) => <li key={row.category}>
                {budgetCategoryLabel(row.category as Parameters<typeof budgetCategoryLabel>[0], t)}
                {' — '}{row.mapped
                  ? t('project:noSpendingReading', "Spending hasn't been updated yet.")
                  : t('project:categoryNeedsSetup', 'Spending setup is not complete for this category.')}
              </li>)}
            </ul>
          </details>
        )}
      </div>
      {hasInvoices && <p className="text-xs text-muted-foreground" data-testid="project-invoicing-scope">
        {t('project:invoiceScope', 'Only invoices linked to this project are included.')}
      </p>}
    </section>
  );
}
