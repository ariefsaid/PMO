import ProjectSetupTask from './admin/ProjectSetupTask';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link, Navigate, useLocation } from 'react-router';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useOperatorMembership } from '@/src/auth/useIsOperator';
import { cn } from '@/src/components/ui/cn';
import { GateNotice, ListState } from '@/src/components/ui';
import AdminUsers from './AdminUsers';
import AdministrationCredits from './AdministrationCredits';
import { AdministrationUsage } from './AdministrationUsage';
import AdministrationFeatures from './AdministrationFeatures';
import AdministrationExchangeRates from './AdministrationExchangeRates';
import { IntegrationsView } from '@/src/components/integrations/IntegrationsView';
import SpendApprovers from './admin/SpendApprovers';
import TaxAdvancesTask from './admin/TaxAdvancesTask';
import OrgProcurementGates from './admin/OrgProcurementGates';
import CostAttribution from './admin/CostAttribution';
import PostingAccountsTask from './admin/PostingAccountsTask';
import AdministrationPageHeader from './admin/AdministrationPageHeader';
import { useUsage, useAgentRunStats } from '@/src/hooks/useUsage';

export type AdministrationSection =
  | 'users'
  | 'integrations'
  | 'accounting'
  | 'projects'
  | 'credits'
  | 'exchange-rates'
  | 'cost-attribution'
  | 'usage'
  | 'features';

/** Canonical section order (Task 4/6): the four organization destinations, then the Operator-only pair. */
const ORGANIZATION_SECTIONS: AdministrationSection[] = ['users', 'integrations', 'accounting', 'projects', 'credits', 'exchange-rates'];
const OPERATOR_SECTIONS: AdministrationSection[] = ['usage', 'features'];
/** #1271: Finance's second destination, beside Exchange rates. Admin/Executive reach cost attribution inside Accounting setup, so it is not in their nav. */
const FINANCE_SECTIONS: AdministrationSection[] = ['exchange-rates', 'cost-attribution'];
const ALL_SECTIONS: AdministrationSection[] = [...ORGANIZATION_SECTIONS, 'cost-attribution', ...OPERATOR_SECTIONS];

type AccountingTask = 'posting-accounts' | 'tax-advances' | 'purchase-rules' | 'spend-approvers';

const accountingTaskForHash = (hash: string): AccountingTask => {
  if (hash === '#org-tax-default' || hash === '#withholding-account-heading' || hash === '#vendor-tax-accounts-heading' || hash === '#down-payment-item-heading' || hash === '#tax-advances') return 'tax-advances';
  if (hash === '#procurement-gates-heading' || hash === '#purchase-rules') return 'purchase-rules';
  if (hash === '#spend-approvers') return 'spend-approvers';
  return 'posting-accounts';
};

const usePhoneLayout = (): boolean => {
  const [isPhone, setIsPhone] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);

  useEffect(() => {
    const updateViewport = () => setIsPhone(window.innerWidth < 768);
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  return isPhone;
};

/** English defaults for the shell's labels — the translatable source (i18next-parser convention). */
const SECTION_LABEL_DEFAULTS: Record<AdministrationSection, string> = {
  users: 'Users',
  integrations: 'Organization integrations',
  accounting: 'Accounting setup',
  projects: 'Project setup',
  credits: 'Credits',
  'exchange-rates': 'Exchange rates',
  'cost-attribution': 'Cost attribution',
  usage: 'Usage',
  features: 'Features',
};

/**
 * Section labels resolved through i18n. Reference every key STATICALLY: the completeness gate
 * (scripts/check-i18n-completeness.mjs) collects only literal `t('key')` references, so a computed
 * `t(\`admin.nav.${id}\`)` would make each key look orphaned (same documented rule as Rail.tsx).
 */
const buildSectionLabels = (t: TFunction): Record<AdministrationSection, string> => ({
  users: t('admin.nav.users', SECTION_LABEL_DEFAULTS.users),
  integrations: t('admin.nav.integrations', SECTION_LABEL_DEFAULTS.integrations),
  accounting: t('admin.nav.accounting', SECTION_LABEL_DEFAULTS.accounting),
  projects: t('admin.nav.projects', SECTION_LABEL_DEFAULTS.projects),
  credits: t('admin.nav.credits', SECTION_LABEL_DEFAULTS.credits),
  'exchange-rates': t('admin.nav.exchangeRates', SECTION_LABEL_DEFAULTS['exchange-rates']),
  'cost-attribution': t('costAttribution:title', SECTION_LABEL_DEFAULTS['cost-attribution']),
  usage: t('admin.nav.usage', SECTION_LABEL_DEFAULTS.usage),
  features: t('admin.nav.features', SECTION_LABEL_DEFAULTS.features),
});

function administrationSectionForPath(pathname: string): AdministrationSection | undefined {
  const prefix = '/administration/';
  if (!pathname.startsWith(prefix)) return undefined;
  const section = pathname.slice(prefix.length);
  if (section.includes('/')) return undefined;
  return ALL_SECTIONS.some((id) => id === section) ? (section as AdministrationSection) : undefined;
}

const isOperatorSection = (section: AdministrationSection): boolean =>
  section === 'usage' || section === 'features';

const AdministrationNavigation: React.FC<{
  section: AdministrationSection;
  sections: AdministrationSection[];
  isOperator: boolean;
  phone: boolean;
  label: (id: AdministrationSection) => string;
}> = ({ section, sections, isOperator, phone, label }) => {
  const { t } = useTranslation();
  const linkClass = (active: boolean) =>
    cn(
      'flex min-h-11 min-w-0 items-center rounded-md px-3 py-2 text-sm leading-tight transition-colors',
      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
      active
        ? 'bg-primary/10 font-semibold text-nav-active-text'
        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
    );

  const links = (items: ReadonlyArray<AdministrationSection>) =>
    items.map((id) => (
      <Link
        key={id}
        to={`/administration/${id}`}
        aria-current={section === id ? 'page' : undefined}
        className={linkClass(section === id)}
      >
        {label(id)}
      </Link>
    ));

  return (
    <>
      {phone ? (
        <details key={section} className="min-w-0 border-b border-border">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring">
            <span>{t('admin.nav.ariaLabel', 'Administration sections')}</span>
            <span aria-hidden="true" className="text-muted-foreground">⌄</span>
          </summary>
          <nav aria-label={t('admin.nav.ariaLabel', 'Administration sections')} className="grid min-w-0 gap-1 pb-2">
            {links([...ORGANIZATION_SECTIONS, 'cost-attribution' as const].filter((id) => sections.includes(id)))}
            {isOperator && (
              <>
                <span className="px-3 pt-2 text-left text-xs font-semibold text-muted-foreground">
                  {t('admin.nav.platform', 'Platform')}
                </span>
                {links(OPERATOR_SECTIONS)}
              </>
            )}
          </nav>
        </details>
      ) : (
        <nav aria-label={t('admin.nav.ariaLabel', 'Administration sections')} className="min-w-0">
          <div className="grid min-w-0 gap-1">
            {links([...ORGANIZATION_SECTIONS, 'cost-attribution' as const].filter((id) => sections.includes(id)))}
            {isOperator && (
              <>
                <span className="px-3 pt-3 text-left text-xs font-semibold text-muted-foreground">
                  {t('admin.nav.platform', 'Platform')}
                </span>
                {links(OPERATOR_SECTIONS)}
              </>
            )}
          </div>
        </nav>
      )}
    </>
  );
};

const OperatorMembershipPending: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-2.5 rounded-lg border border-border bg-secondary/35 px-3.5 py-3 text-[13px] text-muted-foreground"
    >
      <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground" />
      <span>{t('admin.access.checking', 'Checking your Administration access…')}</span>
    </div>
  );
};

const AccountingSectionNavigation: React.FC<{ selected: AccountingTask }> = ({ selected }) => {
  const { t } = useTranslation();
  const tasks: { id: AccountingTask; label: string }[] = [
    { id: 'posting-accounts', label: t('administration:admin.accounting.postingAccounts', 'Posting accounts') },
    { id: 'tax-advances', label: t('administration:admin.accounting.taxAdvances', 'Tax and advances') },
    { id: 'purchase-rules', label: t('administration:admin.accounting.purchaseRules', 'Purchase rules') },
    { id: 'spend-approvers', label: t('administration:admin.accounting.spendApprovers', 'Spend approvers') },
  ];
  return (
    <nav aria-label={t('administration:admin.accounting.sectionsLabel', 'Accounting tasks')} className="mb-4 min-w-0">
      <ul className="grid min-w-0 gap-1 sm:flex sm:flex-wrap">
        {tasks.map(({ id, label }) => (
          <li key={id}>
            <Link
              aria-current={selected === id ? 'page' : undefined}
              className={cn(
                'flex min-h-11 items-center rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
                selected === id ? 'bg-primary/10 font-semibold text-nav-active-text' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
              to={{ hash: `#${id}` }}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
};

const UsagePanel: React.FC = () => {
  const usageQuery = useUsage();
  const runStatsQuery = useAgentRunStats();

  return (
    <AdministrationUsage
      rows={usageQuery.data ?? []}
      runStatsRows={runStatsQuery.data ?? []}
      isPending={usageQuery.isPending}
      isError={usageQuery.isError}
      onRetry={() => void usageQuery.refetch()}
      isStatsPending={runStatsQuery.isPending}
      isStatsError={runStatsQuery.isError}
      onRetryStats={() => void runStatsQuery.refetch()}
    />
  );
};

const SelectedAdministrationPanel: React.FC<{
  section: AdministrationSection;
  accountingTask: AccountingTask;
  orgId: string;
  isOperator: boolean;
}> = ({ section, accountingTask, orgId, isOperator }) => {
  const { t } = useTranslation();
  switch (section) {
    case 'users':
      return (
        <div data-testid="administration-panel-users" className="min-w-0">
          <AdminUsers embedded />
        </div>
      );
    case 'integrations':
      return (
        <div data-testid="administration-panel-integrations" className="min-w-0">
          <IntegrationsView />
        </div>
      );
    case 'accounting':
      return (
        <div data-testid="administration-panel-accounting" className="min-w-0">
          <AccountingSectionNavigation selected={accountingTask} />
          <div id={accountingTask} tabIndex={-1} className="min-w-0 space-y-5 focus:outline-none">
            {accountingTask === 'posting-accounts' && <PostingAccountsTask />}
            {accountingTask === 'tax-advances' && <TaxAdvancesTask />}
            {accountingTask === 'purchase-rules' && <OrgProcurementGates />}
            {accountingTask === 'spend-approvers' && <SpendApprovers />}
          </div>
          <Link className="mt-5 inline-flex min-h-11 items-center rounded-md text-sm font-medium text-nav-active-text underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring" to="/administration/cost-attribution">
            {t('costAttribution:title', 'Cost attribution')} <span aria-hidden="true" className="ml-1">→</span>
          </Link>
        </div>
      );
    case 'cost-attribution':
      return (
        <div data-testid="administration-panel-cost-attribution" className="min-w-0">
          <CostAttribution />
        </div>
      );
    case 'projects':
      return (
        <div data-testid="administration-panel-projects" className="min-w-0">
          <ProjectSetupTask />
        </div>
      );
    case 'credits':
      return (
        <div data-testid="administration-panel-credits" className="min-w-0">
          <AdministrationCredits isOperator={isOperator} orgId={orgId} />
        </div>
      );
    case 'exchange-rates':
      return (
        <div data-testid="administration-panel-exchange-rates" className="min-w-0">
          <AdministrationExchangeRates />
        </div>
      );
    case 'usage':
      return (
        <div data-testid="administration-panel-usage" className="min-w-0">
          <UsagePanel />
        </div>
      );
    case 'features':
      return (
        <div data-testid="administration-panel-features" className="min-w-0">
          <AdministrationFeatures isOperator={isOperator} orgId={orgId} />
        </div>
      );
  }
};

const Administration: React.FC = () => {
  const { t } = useTranslation();
  const { pathname, hash, search } = useLocation();
  const may = usePermission();
  const { currentUser } = useAuth();
  const { realRole } = useEffectiveRole();
  const operatorMembership = useOperatorMembership();
  const section = administrationSectionForPath(pathname);
  const isAdminViewer = may('view', 'user');
  const canFx = may('view', 'fxRate');
  const canManageCostAttribution = may('manage', 'costAttribution');
  const isFinance = realRole === 'Finance';
  const isOperator = operatorMembership.isOperator;
  const operatorRoute = section !== undefined && isOperatorSection(section);
  const fxRoute = section === 'exchange-rates';
  const costAttributionRoute = section === 'cost-attribution';
  const canEnterAdministration = isAdminViewer || isOperator || (fxRoute && isFinance && canFx) || (costAttributionRoute && isFinance && canManageCostAttribution);
  const needsOperatorCheck = operatorRoute || (!isAdminViewer && !isFinance);
  const navigationSections: AdministrationSection[] = isFinance
    ? FINANCE_SECTIONS
    : ORGANIZATION_SECTIONS.filter((id) => id !== 'exchange-rates' || canFx);
  const sectionLabels = buildSectionLabels(t);
  const label = (id: AdministrationSection) => sectionLabels[id];
  const isPhone = usePhoneLayout();
  const accountingTask = accountingTaskForHash(hash);
  const scope = section === 'users'
    ? t('administration:admin.scope.users', 'Workspace members')
    : section === 'integrations'
      ? t('administration:admin.scope.integrations', 'Shared workspace setup')
      : section === 'accounting'
        ? t('administration:admin.scope.accounting', 'Workspace accounting')
        : section === 'projects'
          ? t('administration:admin.scope.projects', 'Future projects')
          : section === 'credits'
            ? t('administration:admin.scope.credits', 'Shared Assistant balance')
            : section === 'exchange-rates'
              ? t('administration:admin.scope.exchangeRates', 'USD → IDR · JISDOR · display equivalents only')
              : section === 'cost-attribution'
                ? t('administration:admin.scope.costAttribution', 'Assign untagged ledger cost to projects without changing ERP records')
                : section === 'usage'
                  ? t('administration:admin.scope.usage', 'Operator · aggregate consumption')
                  : t('administration:admin.scope.features', 'Operator · workspace capabilities');

  useEffect(() => {
    if (!hash) return;
    const targetId = decodeURIComponent(hash.slice(1));
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      if (!target) return;
      target.focus({ preventScroll: true });
      target.scrollIntoView?.({ block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hash, pathname]);

  if (hash === '#org-project-number-pattern' && pathname === '/administration/accounting') {
    return <Navigate to="/administration/projects#org-project-number-pattern" replace />;
  }

  if (hash === '#cost-attribution' && pathname === '/administration/accounting') {
    return <Navigate to={{ pathname: '/administration/cost-attribution', search }} replace />;
  }

  if (pathname === '/administration') {
    const target = hash === '#budget-account-map'
      ? '/administration/accounting#budget-account-map'
      : isFinance
        ? '/administration/exchange-rates'
        : '/administration/users';
    return <Navigate to={target} replace />;
  }

  if (!section) {
    return <Navigate to={isFinance ? '/administration/exchange-rates' : '/administration/users'} replace />;
  }

  return (
    <div className="min-w-0">
      <AdministrationPageHeader title={label(section)} scope={scope} />
      {(() => {
        const financeDestination = isFinance && (fxRoute || costAttributionRoute);
        const showNavigation = isAdminViewer || (isOperator && !operatorMembership.isPending) || financeDestination;
        const navigation = showNavigation ? (
          <AdministrationNavigation section={section} sections={navigationSections} isOperator={isOperator} phone={isPhone} label={label} />
        ) : null;
        const content = operatorMembership.isPending && needsOperatorCheck ? (
          <OperatorMembershipPending />
        ) : operatorMembership.isError && needsOperatorCheck ? (
          <ListState
            variant="error"
            title={t('admin.access.verifyError', 'Could not verify access')}
            sub={t('admin.access.verifyErrorSub', 'Try again to open Administration controls.')}
            onRetry={operatorMembership.retry}
          />
        ) : !canEnterAdministration ? (
          <GateNotice variant="blocked">
          {t(
            'admin.access.denied',
            "Administration is an Admin, Executive, or platform Operator area. You don't have access.",
          )}
          </GateNotice>
        ) : fxRoute && !canFx ? (
          <GateNotice variant="blocked">
            {t('fx.denied', 'Exchange rates are available to Finance and Admin.')}
          </GateNotice>
        ) : operatorRoute && !isOperator ? (
          <GateNotice variant="blocked">
            {t(
              'admin.access.operatorOnly',
              'Operator-only access: Usage and Features are available to platform Operators.',
            )}
          </GateNotice>
        ) : (
          <SelectedAdministrationPanel
            section={section}
            accountingTask={accountingTask}
            orgId={currentUser?.org_id ?? ''}
            isOperator={isOperator}
          />
        );

        return showNavigation && !isPhone ? (
          <div className="grid min-w-0 gap-6 md:grid-cols-[minmax(10rem,13rem)_minmax(0,1fr)]">
            {navigation}
            <div className="min-w-0">{content}</div>
          </div>
        ) : (
          <div className="min-w-0">
            {navigation}
            {content}
          </div>
        );
      })()}
    </div>
  );
};

export default Administration;
