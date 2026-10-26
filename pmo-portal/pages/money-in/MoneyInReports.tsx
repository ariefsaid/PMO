import { useEffect } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { useFeature } from '@/src/auth/useFeature';
import { Button } from '@/src/components/ui';
import { MoneyInPageHeader } from './MoneyInPageHeader';
import FinancialStatements from '../FinancialStatements';
import RevenueByProject from '../RevenueByProject';
import ManagementPack from '../ManagementPack';

type ReportSection = 'statements' | 'project-revenue';
type RevenueView = 'earned' | 'billing';

const validSection = (value: string | null): value is ReportSection => value === 'statements' || value === 'project-revenue';
const validView = (value: string | null): value is RevenueView => value === 'earned' || value === 'billing';

function queryPath(params: URLSearchParams): string {
  const query = params.toString();
  return `/financial-statements${query ? `?${query}` : ''}`;
}

export default function MoneyInReports() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const may = usePermission();
  const revenueFeature = useFeature('revenue');
  const [params, setParams] = useSearchParams();
  const statementsAllowed = may('view', 'financialStatements');
  const billingAllowed = may('view', 'salesInvoice');
  const earnedAllowed = revenueFeature && may('view', 'managementPack');
  const preferredSection: ReportSection = statementsAllowed ? 'statements' : billingAllowed ? 'project-revenue' : 'statements';
  const requestedSection = params.get('section');
  const section = validSection(requestedSection) ? requestedSection : preferredSection;
  const sectionRecovery = section === 'statements' && !statementsAllowed && billingAllowed
    ? 'project-revenue'
    : section === 'project-revenue' && !billingAllowed && statementsAllowed
      ? 'statements'
      : section;
  const recoveryFrom = section !== sectionRecovery ? section : null;
  const effectiveSection = sectionRecovery;
  const defaultView: RevenueView = earnedAllowed ? 'earned' : 'billing';
  const requestedView = params.get('view');
  const parsedView = validView(requestedView) ? requestedView : defaultView;
  const view: RevenueView = parsedView === 'earned' && !earnedAllowed ? 'billing' : parsedView;
  const viewRecovery = parsedView !== view || (requestedView !== null && !validView(requestedView));

  useEffect(() => {
    const next = new URLSearchParams(params);
    let changed = false;
    if (!validSection(requestedSection)) {
      next.set('section', preferredSection);
      changed = true;
    }
    if (effectiveSection === 'project-revenue' && requestedView === null) {
      next.set('view', defaultView);
      changed = true;
    } else if (requestedView !== null && (!validView(requestedView) || (requestedView === 'earned' && !earnedAllowed))) {
      next.set('view', defaultView === 'earned' && earnedAllowed ? 'earned' : 'billing');
      changed = true;
    }
    if (changed) setParams(next, { replace: true });
  }, [defaultView, effectiveSection, earnedAllowed, params, preferredSection, requestedSection, requestedView, section, sectionRecovery, setParams]);

  const sectionUrl = (nextSection: ReportSection) => {
    const next = new URLSearchParams(params);
    next.set('section', nextSection);
    if (nextSection === 'project-revenue' && !next.has('view')) next.set('view', defaultView);
    return queryPath(next);
  };
  const viewUrl = (nextView: RevenueView) => {
    const next = new URLSearchParams(params);
    next.set('section', 'project-revenue');
    next.set('view', nextView);
    return queryPath(next);
  };

  const title = effectiveSection === 'statements'
    ? t('shell.nav.financialStatements', 'Financial statements')
    : t('moneyIn:uxs42.projectRevenue', 'Project revenue');
  const scope = effectiveSection === 'statements'
    ? t('moneyIn:uxs42.statementsScope', 'Company and admitted project statements by supplied period.')
    : view === 'earned'
      ? t('moneyIn:uxs42.earnedScope', 'Cumulative project revenue · net of tax · through the selected as-at month.')
      : t('moneyIn:uxs42.billingScope', 'All invoice dates · billed amounts exclude tax; open receivables include tax.');

  if (!statementsAllowed && !billingAllowed) {
    return (
      <div className="min-w-0">
        <MoneyInPageHeader title={t('moneyIn:uxs42.reports', 'Financial reports')} />
        <section className="max-w-2xl rounded-md border border-border bg-card p-4" aria-labelledby="reports-access-title">
          <h2 id="reports-access-title" className="type-section-head text-heading">{t('financialStatements.accessDenied', "You don't have access to financial statements")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('moneyIn:uxs42.reportsUnavailable', 'Reports are not available to this role.')}</p>
          <Button variant="outline" className="mt-3 min-h-11" onClick={() => navigate('/')}>{t('financeCopy.backToDashboard', 'Back to dashboard')}</Button>
        </section>
      </div>
    );
  }

  const sectionLinks = (
    <nav aria-label={t('moneyIn:uxs42.reportSections', 'Report sections')} className="mb-4 flex flex-wrap gap-x-5 gap-y-2 border-b border-border">
      {statementsAllowed && (
        <Link to={sectionUrl('statements')} aria-current={effectiveSection === 'statements' ? 'page' : undefined}
          className="inline-flex min-h-11 items-center border-b-2 px-1 py-2 text-sm font-medium text-muted-foreground aria-[current=page]:border-primary aria-[current=page]:text-foreground">
          {t('moneyIn:uxs42.statements', 'Statements')}
        </Link>
      )}
      {billingAllowed && (
        <Link to={sectionUrl('project-revenue')} aria-current={effectiveSection === 'project-revenue' ? 'page' : undefined}
          className="inline-flex min-h-11 items-center border-b-2 px-1 py-2 text-sm font-medium text-muted-foreground aria-[current=page]:border-primary aria-[current=page]:text-foreground">
          {t('moneyIn:uxs42.projectRevenue', 'Project revenue')}
        </Link>
      )}
    </nav>
  );

  return (
    <div className="min-w-0">
      <MoneyInPageHeader title={title} scope={scope} />
      {sectionLinks}
      {recoveryFrom && (
        <div role="status" className="mb-4 rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
          {recoveryFrom === 'statements'
            ? t('moneyIn:uxs42.statementsUnavailableRecovery', 'Company statements are available to Finance, Admin, and Executive roles. Project revenue is available to your role.')
            : t('moneyIn:uxs42.projectRevenueUnavailableRecovery', 'Project revenue is not available to your role. Statements are available instead.')}
        </div>
      )}
      {effectiveSection === 'statements' && <FinancialStatements />}
      {effectiveSection === 'project-revenue' && (
        <>
          <nav aria-label={t('moneyIn:uxs42.projectRevenueViews', 'Project revenue views')} className="mb-4 flex flex-wrap gap-2">
            {earnedAllowed && (
              <Link to={viewUrl('earned')} aria-current={view === 'earned' ? 'page' : undefined}
                className="inline-flex min-h-11 items-center rounded-md border border-border px-3 py-2 text-sm font-medium aria-[current=page]:border-primary aria-[current=page]:bg-secondary">
                {t('moneyIn:uxs42.earned', 'Earned vs billed')}
              </Link>
            )}
            {billingAllowed && (
              <Link to={viewUrl('billing')} aria-current={view === 'billing' ? 'page' : undefined}
                className="inline-flex min-h-11 items-center rounded-md border border-border px-3 py-2 text-sm font-medium aria-[current=page]:border-primary aria-[current=page]:bg-secondary">
                {t('moneyIn:uxs42.billingToDate', 'Billing to date')}
              </Link>
            )}
          </nav>
          {viewRecovery && (
            <div role="status" className="mb-4 rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
              {t('moneyIn:uxs42.earnedUnavailableRecovery', 'Earned revenue is unavailable; Billing to date remains available.')}
            </div>
          )}
          {view === 'earned' && earnedAllowed ? <ManagementPack embedded /> : <RevenueByProject />}
        </>
      )}
    </div>
  );
}
