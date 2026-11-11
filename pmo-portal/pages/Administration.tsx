import OrgProjectClassificationOptions from './admin/OrgProjectClassificationOptions';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useOperatorMembership } from '@/src/auth/useIsOperator';
import { cn } from '@/src/components/ui/cn';
import { GateNotice, ListState, PageHeader } from '@/src/components/ui';
import { useIsNarrow } from '@/src/components/ui/useIsNarrow';
import AdminUsers from './AdminUsers';
import AdministrationCredits from './AdministrationCredits';
import { AdministrationUsage } from './AdministrationUsage';
import AdministrationFeatures from './AdministrationFeatures';
import YourPlan from './YourPlan';
import { FeedbackSurveysSetting } from '@/src/components/feedback/FeedbackSurveysSetting';
import AdministrationExchangeRates from './AdministrationExchangeRates';
import { AgentCostMetrics } from '@/src/components/admin/AgentCostMetrics';
import { IntegrationsView } from '@/src/components/integrations/IntegrationsView';
import { AccountingHelp } from './admin/AccountingHelp';
import OrgTaxDefault from './admin/OrgTaxDefault';
import SpendApprovers from './admin/SpendApprovers';
import OrgWithholdingAccount from './admin/OrgWithholdingAccount';
import OrgVendorTaxAccounts from './admin/OrgVendorTaxAccounts';
import OrgDownPaymentItem from './admin/OrgDownPaymentItem';
import OrgProcurementGates from './admin/OrgProcurementGates';
import OrgProjectNumberPattern from './admin/OrgProjectNumberPattern';
import BudgetAccountMap from './admin/BudgetAccountMap';
import CostAttribution from './admin/CostAttribution';
import ExpenseAccountMap from './admin/ExpenseAccountMap';
import { useUsage, useAgentRunStats } from '@/src/hooks/useUsage';

export type AdministrationSection =
  | 'users'
  | 'integrations'
  | 'accounting'
  | 'projects'
  | 'plan'
  | 'credits'
  | 'exchange-rates'
  | 'cost-attribution'
  | 'usage'
  | 'features';

/** Canonical section order (Task 4/6): the four organization destinations, then the Operator-only pair. */
const ORGANIZATION_SECTIONS: AdministrationSection[] = ['users', 'integrations', 'accounting', 'projects', 'plan', 'credits', 'exchange-rates'];
const OPERATOR_SECTIONS: AdministrationSection[] = ['usage', 'features'];
/** #1271: Finance's second destination, beside Exchange rates. Admin/Executive reach cost attribution inside Accounting setup, so it is not in their nav. */
const FINANCE_SECTIONS: AdministrationSection[] = ['exchange-rates', 'cost-attribution'];
const ALL_SECTIONS: AdministrationSection[] = [...ORGANIZATION_SECTIONS, 'cost-attribution', ...OPERATOR_SECTIONS];

/** English defaults for the shell's labels — the translatable source (i18next-parser convention). */
const SECTION_LABEL_DEFAULTS: Record<AdministrationSection, string> = {
  users: 'Users',
  integrations: 'Organization integrations',
  accounting: 'Accounting setup',
  projects: 'Project setup',
  plan: 'Your plan',
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
  plan: t('plans:yourPlan.navLabel', SECTION_LABEL_DEFAULTS.plan),
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

const AdministrationHeader: React.FC<{ section?: AdministrationSection }> = ({ section }) => {
  const { t } = useTranslation();
  return (
    <PageHeader
      title={t('admin.nav.title', 'Administration')}
      help={section === 'accounting' ? <AccountingHelp /> : undefined}
      helpSubject={t('admin.nav.accounting', 'Accounting setup')}
    />
  );
};

/** The selected section's name for assistive tech: the tab already shows it, so no second visible heading. */
const SectionName: React.FC<{ name: string }> = ({ name }) => <h2 className="sr-only">{name}</h2>;

const AdministrationNavigation: React.FC<{
  section: AdministrationSection;
  sections: AdministrationSection[];
  isOperator: boolean;
  label: (id: AdministrationSection) => string;
}> = ({ section, sections, isOperator, label }) => {
  const { t } = useTranslation();
  const linkClass = (active: boolean) =>
    cn(
      'touch-target flex min-h-11 min-w-0 shrink-0 items-center justify-center rounded-md px-3 py-1.5 text-center text-control leading-tight transition-colors md:min-h-0 md:shrink',
      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
      active
        ? 'bg-background font-semibold text-nav-active-text shadow-sm'
        : 'text-foreground hover:bg-accent hover:text-accent-foreground',
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

  const narrow = useIsNarrow();
  const navigate = useNavigate();
  const listed = [...ORGANIZATION_SECTIONS, 'cost-attribution' as const].filter((id) => sections.includes(id));
  const operatorListed = isOperator ? OPERATOR_SECTIONS : [];

  if (narrow) {
    // A phone shows every section in one control instead of a strip that scrolls out of sight.
    const ariaLabel = t('admin.nav.ariaLabel', 'Administration sections');
    return (
      <nav aria-label={ariaLabel} className="mb-4 min-w-0">
        <select
          aria-label={ariaLabel}
          value={section}
          onChange={(event) => navigate(`/administration/${event.target.value}`)}
          className="h-11 w-full rounded-md border border-input bg-card px-3 text-[16px] font-semibold"
        >
          {[...listed, ...operatorListed].map((id) => (
            <option key={id} value={id}>{label(id)}</option>
          ))}
        </select>
      </nav>
    );
  }

  return (
    <nav aria-label={t('admin.nav.ariaLabel', 'Administration sections')} className="mb-4 min-w-0 md:mb-6">
      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1 rounded-lg bg-secondary p-1">
        {links(listed)}
        {operatorListed.length > 0 && (
          <>
            <span className="shrink-0 px-1 text-control font-semibold text-muted-foreground md:ml-1 md:self-center">
              {t('admin.nav.platform', 'Platform')}
            </span>
            {links(operatorListed)}
          </>
        )}
      </div>
    </nav>
  );
};

const OperatorMembershipPending: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-2.5 rounded-lg border border-border bg-secondary/35 px-3.5 py-3 text-control text-muted-foreground"
    >
      <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground" />
      <span>{t('admin.access.checking', 'Checking your Administration access…')}</span>
    </div>
  );
};

const UsagePanel: React.FC = () => {
  const usageQuery = useUsage();
  const runStatsQuery = useAgentRunStats();

  return (
    <>
      <div className="mb-4">
        <AgentCostMetrics
          summaryRows={usageQuery.data ?? []}
          runStatsRows={runStatsQuery.data ?? []}
          isPending={usageQuery.isPending || runStatsQuery.isPending}
          isError={usageQuery.isError || runStatsQuery.isError}
          onRetry={() => {
            void usageQuery.refetch();
            void runStatsQuery.refetch();
          }}
        />
      </div>
      <AdministrationUsage
        rows={usageQuery.data ?? []}
        isPending={usageQuery.isPending}
        isError={usageQuery.isError}
        onRetry={() => void usageQuery.refetch()}
      />
    </>
  );
};

const SelectedAdministrationPanel: React.FC<{
  section: AdministrationSection;
  orgId: string;
  isOperator: boolean;
  label: (id: AdministrationSection) => string;
}> = ({ section, orgId, isOperator, label }) => {
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
          <SectionName name={label('integrations')} />
          <IntegrationsView />
          <FeedbackSurveysSetting />
        </div>
      );
    case 'accounting':
      return (
        <div data-testid="administration-panel-accounting" className="min-w-0">
          <SectionName name={label('accounting')} />
          <div className="space-y-6 [&>section+section]:border-t [&>section+section]:border-border [&>section+section]:pt-6">
            <OrgTaxDefault />
            <SpendApprovers />
            <OrgWithholdingAccount />
            <OrgVendorTaxAccounts />
            <OrgDownPaymentItem />
            <OrgProcurementGates />
            <BudgetAccountMap />
            <ExpenseAccountMap />
          </div>
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
          <SectionName name={label('projects')} />
          <div className="space-y-6 [&>section+section]:border-t [&>section+section]:border-border [&>section+section]:pt-6">
            <OrgProjectNumberPattern />
            <OrgProjectClassificationOptions />
          </div>
        </div>
      );
    case 'plan':
      return (
        <div data-testid="administration-panel-plan" className="min-w-0">
          <SectionName name={label('plan')} />
          <YourPlan />
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
          <SectionName name={label('usage')} />
          <UsagePanel />
        </div>
      );
    case 'features':
      return (
        <div data-testid="administration-panel-features" className="min-w-0">
          <SectionName name={label('features')} />
          <AdministrationFeatures isOperator={isOperator} orgId={orgId} />
        </div>
      );
  }
};

const Administration: React.FC = () => {
  const { t } = useTranslation();
  const { pathname, hash } = useLocation();
  const may = usePermission();
  const { currentUser } = useAuth();
  const { realRole } = useEffectiveRole();
  const operatorMembership = useOperatorMembership();
  const section = administrationSectionForPath(pathname);
  const isAdminViewer = may('view', 'user');
  const canFx = may('view', 'fxRate');
  const canManageCostAttribution = may('manage', 'costAttribution');
  const canViewCostAttribution = isAdminViewer || canManageCostAttribution;
  const isFinance = realRole === 'Finance';
  const isOperator = operatorMembership.isOperator;
  const operatorRoute = section !== undefined && isOperatorSection(section);
  const fxRoute = section === 'exchange-rates';
  const costAttributionRoute = section === 'cost-attribution';
  const canEnterAdministration = isAdminViewer || isOperator || (fxRoute && isFinance && canFx) || (costAttributionRoute && isFinance && canManageCostAttribution);
  const needsOperatorCheck = operatorRoute || (!isAdminViewer && !isFinance);
  const navigationSections: AdministrationSection[] = isFinance
    ? FINANCE_SECTIONS.filter((id) => id !== 'cost-attribution' || canManageCostAttribution)
    : [
      ...ORGANIZATION_SECTIONS.filter((id) => id !== 'exchange-rates' || canFx)
        // "Your plan" is the org Admin's read-only page (FR-PLN-014); an Operator reaches it too.
        .filter((id) => id !== 'plan' || isAdminViewer || isOperator),
      ...(canViewCostAttribution ? ['cost-attribution' as const] : []),
    ];
  const sectionLabels = buildSectionLabels(t);
  const label = (id: AdministrationSection) => sectionLabels[id];

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

  // The bare `/administration` entry redirect lives ONLY in the route table (App's
  // AdministrationEntryRedirect) — a section-less render here is otherwise unreachable, so it
  // falls through to the same destination logic below without a competing redirect copy.
  if (!section) {
    return <Navigate to={isFinance ? '/administration/exchange-rates' : '/administration/users'} replace />;
  }

  return (
    <div className="min-w-0">
      <AdministrationHeader section={section} />

      {operatorMembership.isPending && needsOperatorCheck ? (
        <OperatorMembershipPending />
      ) : operatorMembership.isError && needsOperatorCheck ? (
        <>
          {isAdminViewer && <AdministrationNavigation section={section} sections={navigationSections} isOperator={false} label={label} />}
          <ListState
            variant="error"
            title={t('admin.access.verifyError', 'Could not verify access')}
            sub={t('admin.access.verifyErrorSub', 'Try again to open Administration controls.')}
            onRetry={operatorMembership.retry}
          />
        </>
      ) : !canEnterAdministration ? (
        <GateNotice variant="blocked">
          {t(
            'admin.access.denied',
            "Administration is an Admin, Executive, or platform Operator area. You don't have access.",
          )}
        </GateNotice>
      ) : fxRoute && !canFx ? (
        <>
          {isAdminViewer && <AdministrationNavigation section={section} sections={navigationSections} isOperator={isOperator} label={label} />}
          <GateNotice variant="blocked">
            {t('fx.denied', 'Exchange rates are available to Finance and Admin.')}
          </GateNotice>
        </>
      ) : operatorRoute && !isOperator ? (
        <>
          <AdministrationNavigation section={section} sections={navigationSections} isOperator={false} label={label} />
          <GateNotice variant="blocked">
            {t(
              'admin.access.operatorOnly',
              'Operator-only access: Usage and Features are available to platform Operators.',
            )}
          </GateNotice>
        </>
      ) : (
        <>
          <AdministrationNavigation section={section} sections={navigationSections} isOperator={isOperator} label={label} />
          <SelectedAdministrationPanel
            section={section}
            orgId={currentUser?.org_id ?? ''}
            isOperator={isOperator}
            label={label}
          />
        </>
      )}
    </div>
  );
};

export default Administration;
