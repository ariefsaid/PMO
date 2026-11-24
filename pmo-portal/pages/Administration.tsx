import OrgProjectClassificationOptions from './admin/OrgProjectClassificationOptions';
import CostDisciplines from './admin/CostDisciplines';
import WorkOrderLists from './admin/WorkOrderLists';
import React, { useContext, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useIsNarrow } from '@/src/components/ui/useIsNarrow';
import { AuthContext } from '@/src/auth/AuthContext';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useOperatorMembership } from '@/src/auth/useIsOperator';
import { cn } from '@/src/components/ui/cn';
import { GateNotice, ListState, PageHeader } from '@/src/components/ui';
import AdminUsers from './AdminUsers';
import People from './admin/People';
import Clearance from './admin/Clearance';
import { useOrgSwitch } from '@/src/hooks/useOrgSwitch';
import DocumentTypes from './admin/DocumentTypes';
import AdministrationCredits from './AdministrationCredits';
import { AdministrationUsage } from './AdministrationUsage';
import AdministrationFeatures from './AdministrationFeatures';
import YourPlan from './YourPlan';
import { FeedbackSurveysSetting } from '@/src/components/feedback/FeedbackSurveysSetting';
import AdministrationExchangeRates from './AdministrationExchangeRates';
import { EmailNotificationsSetting } from '@/src/components/emailNotifications/EmailNotificationsSetting';
import { ScheduledReportsSetting } from '@/src/components/emailNotifications/ScheduledReportsSetting';
import AdministrationTerminology from './AdministrationTerminology';
import AdministrationDocumentCategories from './AdministrationDocumentCategories';
import { AgentCostMetrics } from '@/src/components/admin/AgentCostMetrics';
import { IntegrationsView } from '@/src/components/integrations/IntegrationsView';
import { AccountingHelp } from './admin/AccountingHelp';
import OrgTaxDefault from './admin/OrgTaxDefault';
import OrgFiscalYearStart from './admin/OrgFiscalYearStart';
import OrgBuiltInRoles from './admin/OrgBuiltInRoles';
import OrgHidePrices from './admin/OrgHidePrices';
import { HIDE_PRICES_SETTING_AVAILABLE } from '@/src/lib/db/hidePrices';
import SpendApprovers from './admin/SpendApprovers';
import OrgWithholdingAccount from './admin/OrgWithholdingAccount';
import OrgVendorTaxAccounts from './admin/OrgVendorTaxAccounts';
import OrgDownPaymentItem from './admin/OrgDownPaymentItem';
import OrgClaimOverCap from './admin/OrgClaimOverCap';
import WorkOrderCloseoutTemplate from './admin/WorkOrderCloseoutTemplate';
import OrgProcurementGates from './admin/OrgProcurementGates';
import PurchaseOrderSettingsSection from './admin/PurchaseOrderSettingsSection';
import OrderJobRolesSection from './admin/OrderJobRolesSection';
import OrgThreeWayMatch from './admin/OrgThreeWayMatch';
import OrgPaymentChannels from './admin/OrgPaymentChannels';
import OrgPurchaseLines from './admin/OrgPurchaseLines';
import OrgOrderNeededBy from './admin/OrgOrderNeededBy';
import SiteReportLists from './admin/SiteReportLists';
import DailyReportValidateRoles from './admin/DailyReportValidateRoles';
import OrgIssueTypes from './admin/OrgIssueTypes';
import IssueClosingReportSettings from './admin/IssueClosingReportSettings';
import StockIssueCostSettings from './admin/StockIssueCostSettings';
import RevenuePlanSettings from './admin/RevenuePlanSettings';
import NonWorkingDatesCard from './admin/NonWorkingDatesCard';
import OrgAttendanceTimeRoles from './admin/OrgAttendanceTimeRoles';
import OrgModules from './admin/OrgModules';
import { ModuleGate } from '@/src/components/admin/ModuleGate';
import { OrgSwitchSetting } from '@/src/components/admin/OrgSwitchSetting';
import SiteCheckpointTemplate from './admin/SiteCheckpointTemplate';
import WorkOrderCandidateTemplate from './admin/WorkOrderCandidateTemplate';
import SafetyLists from './admin/SafetyLists';
import OrgProjectNumberPattern from './admin/OrgProjectNumberPattern';
import OrgPerformanceIndices from './admin/OrgPerformanceIndices';
import OrgAttendanceTarget from './admin/OrgAttendanceTarget';
import BudgetAccountMap from './admin/BudgetAccountMap';
import CostAttribution from './admin/CostAttribution';
import LabourCostSettings from './admin/LabourCostSettings';
import ExpenseAccountMap from './admin/ExpenseAccountMap';
import { useUsage, useAgentRunStats } from '@/src/hooks/useUsage';

export type AdministrationSection =
  | 'users'
  | 'people'
  | 'document-types'
  | 'clearance'
  | 'integrations'
  | 'modules'
  | 'accounting'
  | 'projects'
  | 'plan'
  | 'credits'
  | 'exchange-rates'
  | 'terminology'
  | 'document-categories'
  | 'cost-attribution'
  | 'scheduled-reports'
  | 'usage'
  | 'features';

/** Canonical section order (Task 4/6): the four organization destinations, then the Operator-only pair. */
const ORGANIZATION_SECTIONS: AdministrationSection[] = ['users', 'people', 'document-types', 'integrations', 'modules', 'accounting', 'projects', 'plan', 'credits', 'terminology', 'document-categories', 'exchange-rates'];
const OPERATOR_SECTIONS: AdministrationSection[] = ['usage', 'features'];
/** #1271: Finance's second destination, beside Exchange rates. Admin/Executive reach cost attribution inside Accounting setup, so it is not in their nav. */
const FINANCE_SECTIONS: AdministrationSection[] = ['people', 'document-types', 'exchange-rates', 'cost-attribution'];
const ALL_SECTIONS: AdministrationSection[] = [...ORGANIZATION_SECTIONS, 'clearance', 'cost-attribution', 'scheduled-reports', ...OPERATOR_SECTIONS];

/** English defaults for the shell's labels — the translatable source (i18next-parser convention). */
const SECTION_LABEL_DEFAULTS: Record<AdministrationSection, string> = {
  users: 'Users',
  people: 'People',
  'document-types': 'Document types',
  clearance: 'Clearance',
  integrations: 'Organization integrations',
  modules: 'Modules',
  accounting: 'Accounting setup',
  projects: 'Project setup',
  plan: 'Your plan',
  credits: 'Credits',
  'exchange-rates': 'Exchange rates',
  terminology: 'Terminology',
  'document-categories': 'Document categories',
  'cost-attribution': 'Cost attribution',
  'scheduled-reports': 'Scheduled reports',
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
  people: t('administration:people.navLabel', SECTION_LABEL_DEFAULTS.people),
  'document-types': t('administration:documentTypesNav', SECTION_LABEL_DEFAULTS['document-types']),
  clearance: t('administration:clearance.navLabel', SECTION_LABEL_DEFAULTS.clearance),
  integrations: t('admin.nav.integrations', SECTION_LABEL_DEFAULTS.integrations),
  modules: t('administration:admin.modulesNav', SECTION_LABEL_DEFAULTS.modules),
  accounting: t('admin.nav.accounting', SECTION_LABEL_DEFAULTS.accounting),
  projects: t('admin.nav.projects', SECTION_LABEL_DEFAULTS.projects),
  plan: t('plans:yourPlan.navLabel', SECTION_LABEL_DEFAULTS.plan),
  credits: t('admin.nav.credits', SECTION_LABEL_DEFAULTS.credits),
  'exchange-rates': t('admin.nav.exchangeRates', SECTION_LABEL_DEFAULTS['exchange-rates']),
  terminology: t('administration:terminology.nav', SECTION_LABEL_DEFAULTS.terminology),
  'document-categories': t('administration:documentCategories.nav', SECTION_LABEL_DEFAULTS['document-categories']),
  'cost-attribution': t('costAttribution:title', SECTION_LABEL_DEFAULTS['cost-attribution']),
  'scheduled-reports': t('emailNotifications:scheduled.title', SECTION_LABEL_DEFAULTS['scheduled-reports']),
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

const AdministrationHeader: React.FC<{ section?: AdministrationSection; title?: string }> = ({ section, title }) => {
  const { t } = useTranslation();
  return (
    <PageHeader
      title={title ?? t('admin.nav.title', 'Administration')}
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
  /** The All settings page (#2746) is its own route, listed after the sections for an org Admin. */
  showAllSettings?: boolean;
}> = ({ section, sections, isOperator, label, showAllSettings }) => {
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

  const listed = [...ORGANIZATION_SECTIONS, 'clearance' as const, 'cost-attribution' as const, 'scheduled-reports' as const].filter((id) => sections.includes(id));
  const operatorListed = isOperator ? OPERATOR_SECTIONS : [];
  const narrow = useIsNarrow();
  const navigate = useNavigate();

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
          {showAllSettings && <option value="all-settings">{t('allSettings.title', 'All settings')}</option>}
        </select>
      </nav>
    );
  }

  return (
    <nav aria-label={t('admin.nav.ariaLabel', 'Administration sections')} className="mb-4 min-w-0 md:mb-6">
      <div className="grid min-w-0 max-w-full grid-cols-2 items-stretch gap-1 rounded-lg bg-secondary p-1 md:flex md:flex-wrap md:items-center">
        {links(listed)}
        {showAllSettings && (
          <Link to="/administration/all-settings" className={linkClass(false)}>{t('allSettings.title', 'All settings')}</Link>
        )}
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
      <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-mark-neutral" />
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
  const { t } = useTranslation(['billingSteps', 'siteReport']);
  switch (section) {
    case 'users':
      return (
        <div data-testid="administration-panel-users" className="min-w-0">
          <AdminUsers embedded />
        </div>
      );
    case 'document-types':
      return <div data-testid="administration-panel-document-types"><SectionName name={label('document-types')} /><DocumentTypes /></div>;
    case 'people':
      return (
        <div data-testid="administration-panel-people" className="min-w-0">
          <SectionName name={label('people')} />
          <OrgAttendanceTimeRoles />
          <People />
          <ModuleGate module="modulePeopleCrews"><OrgBuiltInRoles /></ModuleGate>
        </div>
      );
    case 'clearance':
      return (
        <div data-testid="administration-panel-clearance" className="min-w-0">
          <SectionName name={label('clearance')} />
          <ModuleGate module="modulePeopleCrews"><Clearance /></ModuleGate>
          {HIDE_PRICES_SETTING_AVAILABLE && <OrgHidePrices />}
        </div>
      );
    case 'integrations':
      return (
        <div data-testid="administration-panel-integrations" className="min-w-0">
          <SectionName name={label('integrations')} />
          <IntegrationsView />
          <FeedbackSurveysSetting />
          <EmailNotificationsSetting />
        </div>
      );
    case 'modules':
      return (
        <div data-testid="administration-panel-modules" className="min-w-0">
          <SectionName name={label('modules')} />
          <OrgModules />
        </div>
      );
    case 'accounting':
      return (
        <div data-testid="administration-panel-accounting" className="min-w-0">
          <SectionName name={label('accounting')} />
          <div className="space-y-6 [&>section+section]:border-t [&>section+section]:border-border [&>section+section]:pt-6">
            <StockIssueCostSettings />
            <OrgTaxDefault />
            <OrgFiscalYearStart />
            <SpendApprovers />
            <OrgWithholdingAccount />
            <OrgVendorTaxAccounts />
            <OrgDownPaymentItem />
            <OrgClaimOverCap />
            <OrgProcurementGates />
            <div id="work-order-checklist" className="scroll-mt-4">
              <OrgSwitchSetting setting="workOrderChecklist"
                label={t('billingSteps:settings.workOrderChecklist.label', 'Edit issued work-order checklists')}
                helper={t('billingSteps:settings.workOrderChecklist.helper', 'When on, billing-step runners can add steps to issued work orders, and Finance or an Admin can save a checklist as a template for new work orders.')} />
            </div>
            <ModuleGate module="modulePurchasingExtras"><PurchaseOrderSettingsSection /><OrderJobRolesSection /></ModuleGate>
            <OrgThreeWayMatch />
            <ModuleGate module="modulePurchasingExtras"><OrgPaymentChannels /></ModuleGate>
            <ModuleGate module="modulePurchasingExtras"><OrgPurchaseLines /></ModuleGate>
            <OrgOrderNeededBy />
            <BudgetAccountMap />
            <ExpenseAccountMap />
          </div>
        </div>
      );
    case 'cost-attribution':
      return (
        <div data-testid="administration-panel-cost-attribution" className="min-w-0">
          <CostAttribution />
          <div className="mt-6 border-t border-border pt-6"><LabourCostSettings /></div>
        </div>
      );
    case 'projects':
      return (
        <div data-testid="administration-panel-projects" className="min-w-0">
          <SectionName name={label('projects')} />
          <div className="space-y-6 [&>section+section]:border-t [&>section+section]:border-border [&>section+section]:pt-6">
            <OrgProjectNumberPattern />
            <OrgProjectClassificationOptions />
            <SiteReportLists />
            <DailyReportValidateRoles />
            <OrgSwitchSetting setting="qsReportRevenue"
              label={t('siteReport:revenue.qsAccess', 'Quantity Surveyors see validated daily report revenue')}
              helper={t('siteReport:revenue.qsAccessHelp', 'Shows frozen rates and amounts for one validated report. Other revenue and cost permissions stay unchanged.')} />
            <OrgIssueTypes />
            <ModuleGate module="moduleBillingExtras"><RevenuePlanSettings /></ModuleGate>
            <NonWorkingDatesCard />
            <SiteCheckpointTemplate />
            <WorkOrderCandidateTemplate />
            <ModuleGate module="moduleSiteDay"><SafetyLists /></ModuleGate>
            <CostDisciplines />
            <WorkOrderCloseoutTemplate />
            <WorkOrderLists />
            <ModuleGate module="moduleSiteDay"><OrgPerformanceIndices /></ModuleGate>
            <OrgAttendanceTarget />
            <IssueClosingReportSettings />
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
    case 'terminology':
      return (
        <div data-testid="administration-panel-terminology" className="min-w-0">
          <SectionName name={label('terminology')} />
          <AdministrationTerminology />
        </div>
      );
    case 'document-categories':
      return (
        <div data-testid="administration-panel-document-categories-section" className="min-w-0">
          <SectionName name={label('document-categories')} />
          <AdministrationDocumentCategories />
        </div>
      );
    case 'scheduled-reports':
      return (
        <div data-testid="administration-panel-scheduled-reports" className="min-w-0">
          <SectionName name={label('scheduled-reports')} />
          <ScheduledReportsSetting standalone />
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
  const { realRole, effectiveRole } = useEffectiveRole();
  const operatorMembership = useOperatorMembership();
  const section = administrationSectionForPath(pathname);
  const isAdminViewer = may('view', 'user');
  const canFx = may('view', 'fxRate');
  const canManageCostAttribution = may('manage', 'costAttribution');
  const canManageDocumentCategories = may('manage', 'documentCategory');
  const canViewCostAttribution = isAdminViewer || canManageCostAttribution;
  const isFinance = realRole === 'Finance';
  const isOperator = operatorMembership.isOperator;
  const operatorRoute = section !== undefined && isOperatorSection(section);
  const fxRoute = section === 'exchange-rates';
  const costAttributionRoute = section === 'cost-attribution';
  const canViewPeople = may('view', 'person');
  const peopleRoute = (section === 'people' || section === 'document-types') && canViewPeople;
  // #2707: the Clearance section exists only while the organisation setting is on (default off: Administration is unchanged).
  const clearanceEnabled = useOrgSwitch('clearance').data === true;
  const clearanceRoute = section === 'clearance' && may('view', 'personClearance');
  const showClearance = clearanceEnabled && may('view', 'personClearance');
  const authCtx = useContext(AuthContext);
  const builtInRoleKey = currentUser?.built_in_role ?? authCtx?.currentUser?.built_in_role ?? null;
  const viewOnly = realRole !== effectiveRole;
  const pcmScheduledReportsEnabled = useOrgSwitch(
    'pcmScheduledReports',
    builtInRoleKey === 'project_control_manager' && !viewOnly,
  ).data === true;
  const canManageScheduledReports = may('manage', 'scheduledReport', {
    record: {
      viewOnly,
      pcm_scheduled_reports_enabled: pcmScheduledReportsEnabled,
    },
  });
  const scheduledReportsRoute = section === 'scheduled-reports' && canManageScheduledReports;
  const canEnterAdministration = isAdminViewer || isOperator || peopleRoute || clearanceRoute || scheduledReportsRoute || (fxRoute && isFinance && canFx) || (costAttributionRoute && isFinance && canManageCostAttribution);
  const needsOperatorCheck = operatorRoute || (!isAdminViewer && !isFinance && !peopleRoute && !clearanceRoute && !scheduledReportsRoute);
  const navigationSections: AdministrationSection[] = !isAdminViewer && !isFinance && !isOperator
    ? ['people', 'document-types', ...(showClearance ? ['clearance' as const] : []), ...(canManageScheduledReports ? ['scheduled-reports' as const] : [])]
    : isFinance
    ? [...FINANCE_SECTIONS.filter((id) => (id !== 'cost-attribution' || canManageCostAttribution) && (id !== 'document-types' || canViewPeople)), ...(showClearance ? ['clearance' as const] : [])]
    : [
      ...ORGANIZATION_SECTIONS.filter((id) => id !== 'exchange-rates' || canFx)
        // "Your plan" is the org Admin's read-only page (FR-PLN-014); an Operator reaches it too.
        .filter((id) => id !== 'plan' || isAdminViewer || isOperator)
        // #2579: document categories are an Admin-only page; the nav entry is not rendered for anyone else.
        .filter((id) => id !== 'document-categories' || canManageDocumentCategories),
      ...(showClearance ? ['clearance' as const] : []),
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
      <AdministrationHeader section={section} title={section ? label(section) : undefined} />

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
      ) : section === 'document-categories' && !canManageDocumentCategories ? (
        <>
          {isAdminViewer && <AdministrationNavigation section={section} sections={navigationSections} isOperator={isOperator} label={label} />}
          <GateNotice variant="blocked">
            {t('administration:documentCategories.denied', 'Document categories are managed by an Admin.')}
          </GateNotice>
        </>
      ) : section === 'scheduled-reports' && !canManageScheduledReports ? (
        <>
          {isAdminViewer && <AdministrationNavigation section={section} sections={navigationSections} isOperator={isOperator} label={label} />}
          <GateNotice variant="blocked">
            {t('emailNotifications:scheduled.denied', 'Scheduled reports are managed by an Admin or an enabled Project Control Manager.')}
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
          <AdministrationNavigation section={section} sections={navigationSections} isOperator={isOperator} label={label} showAllSettings={isAdminViewer} />
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
