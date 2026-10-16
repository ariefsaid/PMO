import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, TaxBasisLabel } from '@/src/components/ui';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { useProjectFinances } from '@/src/hooks/useProjectFinances';
import { deriveMargin, formatExactMoney } from '@/src/lib/projectFinances';
import { isTaxTreatment } from '@/src/lib/taxTreatment';
import { ON_HAND_STATUSES } from '@/src/lib/db/projectTransitions';
import { formatInstantDate } from '@/src/lib/format';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';

export function ProjectFinancesSection({ project }: { project: ProjectWithRefs }) {
  const { t, i18n } = useTranslation();
  const query = useProjectFinances(project.id);
  const unknown = t('projectFinances.unavailable', 'Unavailable');
  const money = (value: string | null, currency: string | null) => currency
    ? formatExactMoney(value, currency, i18n.language) ?? unknown
    : unknown;
  const title = <>
    <h2 className="text-sm font-semibold">{t('projectFinances.title', 'Project finances')}</h2>
    <p className="text-xs text-muted-foreground">{t('projectFinances.lifetime', 'Lifetime to date')}</p>
  </>;

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
  const contract = project.contract_value === null || !isTaxTreatment(project.tax_treatment)
    ? unknown : money(String(project.contract_value), project.currency);
  const onHand = ON_HAND_STATUSES.includes(project.status as string);
  const field = (label: string, value: string, basis?: React.ReactNode) => (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm font-semibold tabular-nums">{value}</dd>
      {basis && <dd>{basis}</dd>}
    </div>
  );

  return (
    <section
      className="min-w-0 space-y-4 border-y border-border py-4"
      data-testid="project-finances"
      aria-label={t('projectFinances.title', 'Project finances')}
    >
      {title}
      <dl className="grid min-w-0 gap-4 sm:grid-cols-3">
        {field(t('projectFinances.contract', 'Contract value'), contract, isTaxTreatment(project.tax_treatment) && (
          <TaxBasisLabel treatment={project.tax_treatment} showDetails={false} testId="project-contract-basis" />
        ))}
        {onHand && field(t('projectFinances.contractInvoiced', 'Invoiced against contract'), money(data.contract_invoiced, project.currency),
          isTaxTreatment(project.tax_treatment) && <TaxBasisLabel treatment={project.tax_treatment} showDetails={false} testId="project-invoiced-basis" />)}
        {onHand && field(t('projectFinances.remaining', 'Remaining to invoice'), money(data.remaining_to_invoice, project.currency),
          isTaxTreatment(project.tax_treatment) && <TaxBasisLabel treatment={project.tax_treatment} showDetails={false} testId="project-remaining-basis" />)}
      </dl>
      {data.invoices.length === 0 && <p role="status">{t('projectFinances.noInvoices', 'No submitted invoices')}</p>}
      {data.invoices.map((bucket) => {
        const margin = deriveMargin(bucket, actuals);
        const incomplete = t('projectFinances.incomplete', 'Incomplete — ERP outstanding missing');
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
              {field(t('projectFinances.settled', 'Settled'), bucket.missing_outstanding > 0 ? incomplete : money(bucket.settled, bucket.currency))}
              {field(t('projectFinances.outstanding', 'Outstanding'), bucket.missing_outstanding > 0 ? incomplete : money(bucket.outstanding, bucket.currency))}
              {field(t('projectFinances.work', 'Billed-work revenue (net of tax, advances excluded)'), money(bucket.work_revenue, bucket.currency))}
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
      <p className="text-xs text-muted-foreground">
        {t('projectFinances.settlementNote', 'Settled against invoices (cash, withholding and credits), not cash received.')}
      </p>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">{t('projectFinances.budget', 'Budget')}</h3>
        {data.budget ? (
          <p className="break-words tabular-nums">
            {data.budget.status === 'Draft'
              ? t('projectFinances.draft', 'Draft — not active')
              : t('projectFinances.active', 'Active')}
            {` · ${data.budget.name} · v${data.budget.version} · ${data.budget.currency} · ${money(data.budget.amount, data.budget.currency)}`}
          </p>
        ) : <p>{t('projectFinances.noBudget', 'No budget')}</p>}
      </div>
      <div className="min-w-0 space-y-2">
        <h3 className="text-sm font-semibold">
          {t('projectFinances.mappedCosts', 'Costs')}{actuals.currency ? ` · ${actuals.currency}` : ''}
        </h3>
        <p className="break-words font-semibold tabular-nums">{money(actuals.total, actuals.currency)}</p>
        <p className="text-xs text-muted-foreground">
          {actuals.as_of ? formatInstantDate(actuals.as_of) : t('projectFinances.actualsUnavailable', 'Not available yet')}
        </p>
        {actuals.excludes_restricted_rows && <p role="status">{t('projectFinances.restricted', 'Actuals exclude restricted rows')}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{t('projectFinances.mappedCosts', 'Costs')}</caption>
            <thead>
              <tr>
                <th scope="col" className="text-left">{t('projectFinances.category', 'Category')}</th>
                <th scope="col" className="text-right">{t('projectFinances.actuals', 'Actual')}</th>
              </tr>
            </thead>
            <tbody>
              {actuals.categories.map((row) => (
                <tr key={row.category}>
                  <th scope="row" className="break-words text-left font-normal">
                    {budgetCategoryLabel(row.category as Parameters<typeof budgetCategoryLabel>[0], t)}
                  </th>
                  <td className="break-words text-right tabular-nums">
                    {row.mapped ? money(row.amount, actuals.currency) : t('projectFinances.mappingUnavailable', 'Not available yet')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="project-invoicing-scope">
        {t('projectDetail.overview.invoicing.scopeNote', 'Counts invoices linked to this project. Invoices raised in the ERP without a project are not included.')}
      </p>
    </section>
  );
}
