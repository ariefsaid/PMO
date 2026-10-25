import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, TaxBasisLabel } from '@/src/components/ui';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { useProjectFinances } from '@/src/hooks/useProjectFinances';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { attributedSplit, buildProjectMoneyPosition, deriveMargin, formatExactMoney, formatSignedExactMoney, moneyUnits } from '@/src/lib/projectFinances';
import { useProjectCommittedSpend } from '@/src/hooks/useProcurements';
import { OtherCurrencyCommitments } from './OtherCurrencyCommitments';
import { isTaxTreatment } from '@/src/lib/taxTreatment';
import { ON_HAND_STATUSES } from '@/src/lib/db/projectTransitions';
import { formatInstantDate } from '@/src/lib/format';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';

export interface ProjectFinancesSectionProps {
  project: ProjectWithRefs;
  /** Render the one shared read as sibling Cost and Billing groups on the Overview. */
  grouped?: boolean;
  /** Budget totals and disclosures belong in the Cost group next to Actual. */
  costSupplement?: React.ReactNode;
}

export function ProjectFinancesSection({ project, grouped = false, costSupplement }: ProjectFinancesSectionProps) {
  const { t, i18n } = useTranslation();
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const canInspectAccounting = realRole === 'Finance' || realRole === 'Admin';
  const canManageAccounting = may('manage', 'orgAccounting');
  const query = useProjectFinances(project.id);
  const commitments = useProjectCommittedSpend(project.id, true);
  const unknown = t('projectFinances.unavailable', 'Unavailable');
  const money = (value: string | null, currency: string | null) => currency
    ? formatExactMoney(value, currency, i18n.language) ?? unknown
    : unknown;
  const title = <h2 className="text-sm font-semibold">{t('projectFinances.title', 'Project finances')}</h2>;

  if (query.isPending) return grouped ? (
    <>
      <div role="group" aria-label={t('projectDetail.moneyPosition.cost', 'Cost')} className="min-w-0 space-y-4">
        {costSupplement}
        <p role="status">{t('projectFinances.loading', 'Loading project finances…')}</p>
      </div>
      <div role="group" data-testid="project-finances" aria-label={t('projectDetail.moneyPosition.billing', 'Billing')} className="min-w-0" />
    </>
  ) : (
    <section data-testid="project-finances" aria-label={t('projectFinances.title', 'Project finances')}>
      {title}<p role="status">{t('projectFinances.loading', 'Loading project finances…')}</p>
    </section>
  );
  if (query.isError || !query.data) return grouped ? (
    <>
      <div role="group" aria-label={t('projectDetail.moneyPosition.cost', 'Cost')} className="min-w-0 space-y-4">
        {costSupplement}
        <div role="alert" className="flex flex-wrap items-center gap-2">
          {t('projectFinances.error', "Couldn't load project finances.")}
          <Button variant="outline" onClick={() => void query.refetch()}>{t('projectFinances.retry', 'Retry')}</Button>
        </div>
      </div>
      <div role="group" data-testid="project-finances" aria-label={t('projectDetail.moneyPosition.billing', 'Billing')} className="min-w-0" />
    </>
  ) : (
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
  const contractAfterCost = moneyPosition.contractAfterCost === null
    ? null
    : formatSignedExactMoney(moneyPosition.contractAfterCost, project.currency, i18n.language);
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
  const cashUnavailable = t('uxs01.cashReceivedUnavailable', 'Unavailable — receipt-backed cash data is not available yet');
  const cashInvalid = t('uxs01.cashReceivedInvalid', 'Unavailable — receipt-backed cash data could not be verified');
  const cashReading = data.cash_received ?? { state: 'unavailable' as const, buckets: [], reason: 'not-reported' as const };
  const cashKnown = cashReading.state === 'known';
  const cashValue = cashReading.state === 'known'
    ? cashReading.buckets.length === 0
      ? money('0.00', project.currency)
      : (() => {
        const amounts = cashReading.buckets.map(({ amount, currency }) => formatExactMoney(amount, currency, i18n.language));
        return amounts.every((amount): amount is string => amount !== null) ? amounts.join(' · ') : cashInvalid;
      })()
    : cashReading.state === 'incomplete'
      ? t('uxs01.cashReceivedIncomplete', 'Incomplete — receipt allocation cannot establish cash')
      : cashReading.reason === 'invalid-reading' ? cashInvalid : cashUnavailable;
  const cashScope = t('uxs01.cashReceivedScope', "Receipt cash linked to this project's invoices");
  const settlementNote = t('projectFinances.settlementNote', 'Settled against invoices (cash, withholding and credits), not cash received.');
  const field = (label: string, value: string, basis?: React.ReactNode, labelTitle?: string) => (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground" title={labelTitle}>{label}</dt>
      <dd className="break-words text-sm font-semibold tabular-nums">{value}</dd>
      {basis && <dd>{basis}</dd>}
    </div>
  );
  // PD-C: an unknown cash reading is a dash; the reason sits in the title (and for screen readers).
  const cashField = (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{t('uxs01.cashReceived', 'Cash received')}</dt>
      <dd className="break-words text-sm font-semibold tabular-nums" title={cashKnown ? undefined : cashValue}>
        {cashKnown ? cashValue : <><span aria-hidden="true">—</span><span className="sr-only">{cashValue}</span></>}
      </dd>
      <dd><span className="text-xs text-muted-foreground">{cashScope}</span></dd>
    </div>
  );
  const hasInvoices = data.invoices.length > 0;

  const billingContent = (
    <>
      {title}
      {/* PD-C: with no invoices, one line replaces Cash received, Invoiced 0, Remaining = contract
          and the scope note. */}
      {!hasInvoices && <p className="text-sm text-muted-foreground" data-testid="project-no-invoices">
        {t('project:noLinkedInvoices', 'No invoices linked to this project yet')}
      </p>}
      {hasInvoices && <dl className="grid min-w-0 gap-4 sm:grid-cols-3">
        {cashField}
        {onHand && field(t('projectFinances.contractInvoiced', 'Invoiced against contract'), money(data.contract_invoiced, project.currency),
          isTaxTreatment(project.tax_treatment) && <TaxBasisLabel treatment={project.tax_treatment} showDetails={false} testId="project-invoiced-basis" />)}
        {onHand && field(t('projectFinances.remaining', 'Remaining to invoice'), money(data.remaining_to_invoice, project.currency),
          isTaxTreatment(project.tax_treatment) && <TaxBasisLabel treatment={project.tax_treatment} showDetails={false} testId="project-remaining-basis" />)}
      </dl>}
      {data.invoices.map((bucket) => {
        const margin = deriveMargin(bucket, actuals);
        const incomplete = t('project:invoiceBalanceUnavailable', 'Invoice balance is not available yet');
        const reasons = {
          'different-currencies': t('projectFinances.differentCurrencies', 'Unavailable — different currencies'),
          'work-unavailable': t('projectFinances.workUnavailable', 'Billed-work revenue unavailable'),
          'actuals-unavailable': t('projectFinances.actualsUnavailable', 'Not available yet'),
          'restricted-rows': t('projectFinances.restricted', 'Actuals exclude restricted rows'),
        };
        return (
          <div key={bucket.currency} className="min-w-0 space-y-2" data-testid={`project-finances-${bucket.currency}`}>
            <div>
              <h3 className="text-sm font-semibold">{bucket.currency}</h3>
              <p className="text-xs text-muted-foreground">{t('financeCopy.invoiceCount', '{{count}} invoices', { count: bucket.invoice_count })}</p>
            </div>
            <dl className="grid min-w-0 gap-4 sm:grid-cols-3">
              {field(t('projectFinances.invoiced', 'Invoiced'), money(bucket.invoiced, bucket.currency))}
              {field(t('projectFinances.settled', 'Settled'), bucket.missing_outstanding > 0 ? incomplete : money(bucket.settled, bucket.currency),
                undefined, hasSettlement ? settlementNote : undefined)}
              {field(t('projectFinances.outstanding', 'Outstanding'), bucket.missing_outstanding > 0 ? incomplete : money(bucket.outstanding, bucket.currency))}
              {field(t('project:billedWork', 'Billed-work revenue'), money(bucket.work_revenue, bucket.currency),
                undefined, t('project:billedWorkQualifier', 'Net of tax; advances excluded'))}
              {field(t('projectFinances.margin', 'Margin'), margin.reason ? reasons[margin.reason] : money(margin.amount, bucket.currency))}
            </dl>
            <div className="text-xs text-muted-foreground">
              {bucket.tax_basis === 'mixed'
                ? t('projectFinances.mixedTaxBases', 'Mixed tax bases')
                : <TaxBasisLabel treatment={bucket.tax_basis} showDetails={false} />}
            </div>
          </div>
        );
      })}
    </>
  );
  const spendingContent = (
    <div className="min-w-0 space-y-2">
        <h3 className="text-sm font-semibold">
          {t('uxs01.recordedSpending', 'Recorded spending')}{actualPosition.currency ? ` · ${actualPosition.currency}` : ''}
        </h3>
        {/* PD-C: Recorded spending is the ONE home for coverage — shown only when partial — and
            its freshness is one inline "Updated" beside the amount. */}
        <p className="break-words font-semibold tabular-nums">
          {money(actualPosition.amount, actualPosition.currency)}
          {actualPosition.basis === 'erp' && actualPosition.asOf && <span className="ml-2 text-xs font-normal text-muted-foreground">
            {t('uxs01.updated', 'Updated {{date}}', { date: formatInstantDate(actualPosition.asOf) })}
          </span>}
        </p>
        {contractAfterCost !== null && <p className="text-sm">
          <span className="text-xs text-muted-foreground">{t('uxs01.contractRemainingAfterCost', 'Contract remaining after cost')}</span>
          <span data-testid="contract-after-cost" className="ml-2 font-semibold tabular-nums">{contractAfterCost}</span>
        </p>}
        {actualPosition.basis === 'pmo'
          ? <p className="text-xs text-muted-foreground">
            {t('uxs01.pmoCoverage', 'Committed PMO purchase orders')}
            <OtherCurrencyCommitments positions={commitments.otherCurrencies} />
          </p>
          : hasCoverage && !completeCoverage && <p className="text-xs text-muted-foreground">
            {t('uxs01.partialCoverage', 'Partial coverage · {{mapped}} of {{total}} categories recorded', { mapped: mappedCategories, total: actuals.categories.length })}
          </p>}
        {split && (
          <p className="text-xs text-muted-foreground" data-testid="spending-attributed-note">
            {split.tagged
              ? t('costAttribution:split.note', 'Includes {{attributed}} attributed by cost rules · {{tagged}} tagged in the ERP', {
                attributed: money(split.attributed, actualPosition.currency), tagged: money(split.tagged, actualPosition.currency) })
              : t('costAttribution:split.noteAttributedOnly', 'Includes {{attributed}} attributed by cost rules', {
                attributed: money(split.attributed, actualPosition.currency) })}
          </p>
        )}
        {actualPosition.basis === 'erp' && !hasCoverage && <p className="text-xs text-muted-foreground">{t('uxs01.coverageUnavailable', 'Spending coverage unavailable')}</p>}
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
                          {t('costAttribution:split.inline', 'incl. {{attributed}} attributed', { attributed: money(part.attributed, actuals.currency) })}
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
                  ? t('project:noSpendingReading', "Spending hasn't been updated yet.")
                  : t('project:categoryNeedsSetup', 'Spending setup is not complete for this category.')}
              </li>)}
            </ul>
          </details>
        )}
      </div>
  );

  if (grouped) {
    return (
      <>
        <div role="group" aria-label={t('projectDetail.moneyPosition.cost', 'Cost')} className="min-w-0 space-y-4">
          {costSupplement}
          {spendingContent}
        </div>
        <div role="group" data-testid="project-finances" aria-label={t('projectDetail.moneyPosition.billing', 'Billing')} className="min-w-0 space-y-4">
          {billingContent}
          {hasInvoices && <p className="text-xs text-muted-foreground" data-testid="project-invoicing-scope">
            {t('project:invoiceScope', 'Only invoices linked to this project are included.')}
          </p>}
        </div>
      </>
    );
  }

  return (
    <section
      className="min-w-0 space-y-4 border-y border-border py-4"
      data-testid="project-finances"
      aria-label={t('projectFinances.title', 'Project finances')}
    >
      {billingContent}
      {spendingContent}
      {hasInvoices && <p className="text-xs text-muted-foreground" data-testid="project-invoicing-scope">
        {t('project:invoiceScope', 'Only invoices linked to this project are included.')}
      </p>}
    </section>
  );
}
