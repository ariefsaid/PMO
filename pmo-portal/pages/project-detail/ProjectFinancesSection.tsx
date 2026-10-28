import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, TaxBasisLabel } from '@/src/components/ui';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { useProjectFinances } from '@/src/hooks/useProjectFinances';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { attributedSplit, buildProjectMoneyPosition, deriveMargin, formatExactMoney, moneyUnits } from '@/src/lib/projectFinances';
import { useProjectCommittedSpend } from '@/src/hooks/useProcurements';
import { OtherCurrencyCommitments } from './OtherCurrencyCommitments';
import { isTaxTreatment } from '@/src/lib/taxTreatment';
import { ON_HAND_STATUSES } from '@/src/lib/db/projectTransitions';
import { formatInstantDate } from '@/src/lib/format';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';

export function ProjectFinancesSection({ project }: { project: ProjectWithRefs }) {
  const { t, i18n } = useTranslation();
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const canInspectAccounting = realRole === 'Finance' || realRole === 'Admin';
  const canManageAccounting = may('manage', 'orgAccounting');
  const query = useProjectFinances(project.id);
  const commitments = useProjectCommittedSpend(project.id, true);
  const money = (value: string | null, currency: string | null, includeCurrency = true) => currency
    ? formatExactMoney(value, currency, i18n.language, { wholeUnits: true, omitCurrency: !includeCurrency }) ?? ''
    : '';
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
  if (actualPosition.basis === 'erp') {
    for (const row of actuals.categories) {
      const known = row.mapped && actuals.currency !== null &&
        formatExactMoney(row.amount, actuals.currency, i18n.language, { wholeUnits: true }) !== null;
      if (known) knownCategories.push(row);
    }
  }
  const spendingHasData = actualPosition.amount !== null || knownCategories.length > 0;
  // #1271 AC-3: tagged vs rule-attributed cost, named only when some of the (complete, ERP-ledger) total is attributed.
  const split = actualPosition.basis === 'erp' && actualPosition.complete
    ? attributedSplit({ tagged: actuals.tagged_total, attributed: actuals.attributed_total })
    : null;
  const hasSettlement = data.invoices.some((bucket) => (moneyUnits(bucket.settled) ?? 0n) > 0n);
  const onHand = ON_HAND_STATUSES.includes(project.status as string);
  const cashUnavailable = t('uxs01.cashReceivedUnavailable', "Receipt-linked cash hasn't been reported yet.");
  const cashInvalid = t('uxs01.cashReceivedInvalid', 'Receipt-linked cash could not be verified.');
  const cashReading = data.cash_received ?? { state: 'unavailable' as const, buckets: [], reason: 'not-reported' as const };
  const cashKnown = cashReading.state === 'known';
  const cashValue = cashReading.state === 'known'
    ? cashReading.buckets.length === 0
      ? money('0.00', project.currency)
      : (() => {
        const amounts = cashReading.buckets.map(({ amount, currency }) => formatExactMoney(amount, currency, i18n.language, { wholeUnits: true }));
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
      <dd className="break-words text-sm font-semibold tabular-nums">
        {cashKnown ? cashValue : <span role="status" className="text-sm font-normal text-muted-foreground">{cashValue}</span>}
      </dd>
      <dd><span className="text-xs text-muted-foreground">{cashScope}</span></dd>
    </div>
  );
  const hasInvoices = data.invoices.length > 0;

  return (
    <section
      className="min-w-0 space-y-4 border-y border-border py-4"
      data-testid="project-finances"
      aria-label={t('projectFinances.title', 'Project finances')}
    >
      {title}
      {/* PD-C: with no invoices, one line replaces Cash received, Invoiced 0, Remaining = contract
          and the scope note. */}
      {!hasInvoices && <p className="text-sm text-muted-foreground" data-testid="project-no-invoices">
        {t('project:noLinkedInvoices', 'No invoices linked to this project yet')}
      </p>}
      {hasInvoices && <dl className="grid min-w-0 gap-4 sm:grid-cols-3">{cashField}</dl>}
      {hasInvoices && onHand && <div className="min-w-0 space-y-2">
        <div>
          <h3 className="text-sm font-semibold">{t('project:moneyDisplay.contractPosition', 'Contract invoice position')} · {project.currency}</h3>
          {isTaxTreatment(project.tax_treatment) && <TaxBasisLabel treatment={project.tax_treatment} showDetails={false} testId="project-finances-contract-basis" />}
        </div>
        <dl className="grid min-w-0 gap-4 sm:grid-cols-2">
          {field(t('projectFinances.contractInvoiced', 'Invoiced against contract'), money(data.contract_invoiced, project.currency, false))}
          {field(t('projectFinances.remaining', 'Remaining to invoice'), money(data.remaining_to_invoice, project.currency, false))}
        </dl>
      </div>}
      {data.invoices.map((bucket) => {
        const margin = deriveMargin(bucket, actuals);
        const incomplete = t('project:invoiceBalanceUnavailable', 'Invoice balance is not available yet');
        const reasons = {
          'different-currencies': t('projectFinances.differentCurrencies', 'Amounts are in different currencies.'),
          'work-unavailable': t('projectFinances.workUnavailable', 'Billed-work revenue could not be determined.'),
          'actuals-unavailable': t('projectFinances.actualsUnavailable', 'Actual spending is still being confirmed.'),
          'restricted-rows': t('projectFinances.restricted', 'Actuals exclude restricted rows'),
        };
        return (
          <div key={bucket.currency} className="min-w-0 space-y-2" data-testid={`project-finances-${bucket.currency}`}>
            <div>
              <h3 className="text-sm font-semibold">{bucket.currency}</h3>
              <p className="text-xs text-muted-foreground">{t('financeCopy.invoiceCount', '{{count}} invoices', { count: bucket.invoice_count })}</p>
            </div>
            <dl className="grid min-w-0 gap-4 sm:grid-cols-3">
              {field(t('projectFinances.invoiced', 'Invoiced'), money(bucket.invoiced, bucket.currency, false))}
              {field(t('projectFinances.settled', 'Settled'), bucket.missing_outstanding > 0 ? incomplete : money(bucket.settled, bucket.currency, false),
                undefined, hasSettlement ? settlementNote : undefined)}
              {field(t('projectFinances.outstanding', 'Outstanding'), bucket.missing_outstanding > 0 ? incomplete : money(bucket.outstanding, bucket.currency, false))}
              {field(t('project:billedWork', 'Billed-work revenue'), money(bucket.work_revenue, bucket.currency, false),
                undefined, t('project:billedWorkQualifier', 'Net of tax; advances excluded'))}
              {field(t('projectFinances.margin', 'Margin'), margin.reason ? reasons[margin.reason] : money(margin.amount, bucket.currency, false))}
            </dl>
            <div className="text-xs text-muted-foreground">
              {bucket.tax_basis === 'mixed'
                ? t('projectFinances.mixedTaxBases', 'Mixed tax bases')
                : <TaxBasisLabel treatment={bucket.tax_basis} showDetails={false} />}
            </div>
          </div>
        );
      })}
      {spendingHasData && <div className="min-w-0 space-y-2">
        <h3 className="text-sm font-semibold">
          {t('uxs01.recordedSpending', 'Recorded spending')}{actualPosition.currency ? ` · ${actualPosition.currency}` : ''}
        </h3>
        {/* PD-C: Recorded spending is the ONE home for coverage — shown only when partial — and
            its freshness is one inline "Updated" beside the amount. */}
        <p className="break-words font-semibold tabular-nums">
          {money(actualPosition.amount, actualPosition.currency, false)}
          {actualPosition.basis === 'erp' && actualPosition.asOf && <span className="ml-2 text-xs font-normal text-muted-foreground">
            {t('uxs01.updated', 'Updated {{date}}', { date: formatInstantDate(actualPosition.asOf) })}
          </span>}
        </p>
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
                attributed: money(split.attributed, actualPosition.currency, false), tagged: money(split.tagged, actualPosition.currency, false) })
              : t('costAttribution:split.noteAttributedOnly', 'Includes {{attributed}} attributed by cost rules', {
                attributed: money(split.attributed, actualPosition.currency, false) })}
          </p>
        )}
        {actualPosition.basis === 'erp' && !hasCoverage && <p className="text-xs text-muted-foreground">{t('uxs01.coverageUnavailable', 'Spending coverage unavailable')}</p>}
        {actualPosition.basis === 'erp' && !actualPosition.asOf &&
          <p className="text-xs text-muted-foreground">{t('project:noSpendingReading', "Spending hasn't been updated yet.")}</p>}
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
                    {money(row.amount, actuals.currency, false)}
                    {(() => {
                      const part = attributedSplit({ attributed: row.attributed_amount });
                      return part && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {t('costAttribution:split.inline', 'incl. {{attributed}} attributed', { attributed: money(part.attributed, actuals.currency, false) })}
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
      </div>}
      {needsCategorySetup && canInspectAccounting && (
        <p className="text-sm text-muted-foreground" data-testid="spending-setup-prompt">
          {canManageAccounting
            ? <>{t('project:spendingSetupPrompt', 'Recorded spending will appear after account setup is complete.')}{' '}
              <Link className="font-medium text-primary-text underline-offset-4 hover:underline" to="/administration/accounting#budget-account-map">
                {t('project:spendingSetupLink', 'Open spending setup')}
              </Link></>
            : t('project:spendingAdminHandoff', 'Ask an administrator to complete spending setup.')}
        </p>
      )}
      {hasInvoices && <p className="text-xs text-muted-foreground" data-testid="project-invoicing-scope">
        {t('project:invoiceScope', 'Only invoices linked to this project are included.')}
      </p>}
    </section>
  );
}
