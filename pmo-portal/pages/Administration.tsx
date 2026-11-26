import OrgProjectClassificationOptions from './admin/OrgProjectClassificationOptions';
import CostDisciplines from './admin/CostDisciplines';
import WorkOrderLists from './admin/WorkOrderLists';
import React, { useContext, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useIsDesktop } from '@/src/components/ui/useIsDesktop';
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
import { SettingsGroup, SettingsGroups } from '@/src/components/admin/SettingsGroup';
import { OrgSwitchSetting } from '@/src/components/admin/OrgSwitchSetting';
import SiteCheckpointTemplate from './admin/SiteCheckpointTemplate';
import WorkOrderCheckTemplate from './admin/WorkOrderCheckTemplate';
import SafetyLists from './admin/SafetyLists';
import OrgProjectNumberPattern from './admin/OrgProjectNumberPattern';
import OrgPerformanceIndices from './admin/OrgPerformanceIndices';
import OrgAttendanceTarget from './admin/OrgAttendanceTarget';
import OrgWorkInHandCapacity from './admin/OrgWorkInHandCapacity';
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

/** The sections grouped by the job they serve, in the order the side navigation lists them (#1126). */
type NavGroup = 'access' | 'setup' | 'connections' | 'plan';
const NAV_GROUPS: ReadonlyArray<{ id: NavGroup; sections: ReadonlyArray<AdministrationSection> }> = [
  { id: 'access', sections: ['users', 'people', 'document-types', 'clearance'] },
  { id: 'setup', sections: ['modules', 'accounting', 'projects', 'terminology', 'document-categories', 'exchange-rates', 'cost-attribution'] },
  { id: 'connections', sections: ['integrations', 'scheduled-reports'] },
  { id: 'plan', sections: ['plan', 'credits'] },
];

const navGroupLabel = (t: TFunction, id: NavGroup): string => {
  switch (id) {
    case 'access': return t('admin.navGroups.access', 'People and access');
    case 'setup': return t('admin.navGroups.setup', 'Setup');
    case 'connections': return t('admin.navGroups.connections', 'Connections');
    case 'plan': return t('admin.navGroups.plan', 'Plan');
  }
};

/** The setting groups on the two long setup pages, by job (#1126). The side navigation links to each one. */
type SettingsGroupId =
  | 'accounting-tax' | 'accounting-approvals' | 'accounting-orders' | 'accounting-posting'
  | 'projects-numbering' | 'projects-site' | 'projects-work-orders' | 'projects-issues';
const SETTINGS_GROUPS: Partial<Record<AdministrationSection, ReadonlyArray<SettingsGroupId>>> = {
  accounting: ['accounting-tax', 'accounting-approvals', 'accounting-orders', 'accounting-posting'],
  projects: ['projects-numbering', 'projects-site', 'projects-work-orders', 'projects-issues'],
};

const settingsGroupLabel = (t: TFunction, id: SettingsGroupId): string => {
  switch (id) {
    case 'accounting-tax': return t('admin.settingsGroups.accountingTax', 'Tax and fiscal year');
    case 'accounting-approvals': return t('admin.settingsGroups.accountingApprovals', 'Approvals and checks');
    case 'accounting-orders': return t('admin.settingsGroups.accountingOrders', 'Purchase orders');
    case 'accounting-posting': return t('admin.settingsGroups.accountingPosting', 'Costs and account mapping');
    case 'projects-numbering': return t('admin.settingsGroups.projectsNumbering', 'Numbering and project lists');
    case 'projects-site': return t('admin.settingsGroups.projectsSite', 'Daily site reports');
    case 'projects-work-orders': return t('admin.settingsGroups.projectsWorkOrders', 'Work orders');
    case 'projects-issues': return t('admin.settingsGroups.projectsIssues', 'Issues');
  }
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
  const listed = [...ORGANIZATION_SECTIONS, 'clearance' as const, 'cost-attribution' as const, 'scheduled-reports' as const].filter((id) => sections.includes(id));
  const operatorListed = isOperator ? OPERATOR_SECTIONS : [];
  // Below the side-navigation width (768px) every section sits in one picker.
  const narrow = !useIsDesktop();
  const navigate = useNavigate();
  const ariaLabel = t('admin.nav.ariaLabel', 'Administration sections');

  if (narrow) {
    // A phone shows every section in one control instead of a strip that scrolls out of sight.
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

  // Wider screens: one list down the side, grouped by the job each section serves; the open section lists its own
  // setting groups under it, so a setting is found by what it does without scrolling a long page (#1126).
  const groups = NAV_GROUPS
    .map((g) => ({ id: g.id, items: g.sections.filter((id) => listed.includes(id)) }))
    .filter((g) => g.items.length > 0);
  const ungrouped = listed.filter((id) => !NAV_GROUPS.some((g) => g.sections.includes(id)));
  const subGroups = SETTINGS_GROUPS[section] ?? [];
  const groupHeading = 'px-3 pb-1 text-control font-medium text-muted-foreground';
  const item = (id: AdministrationSection) => (
    <li key={id}>
      <Link to={`/administration/${id}`} aria-current={section === id ? 'page' : undefined} className={sideLinkClass(section === id)}>
        {label(id)}
      </Link>
      {section === id && subGroups.length > 0 && (
        <ul className="mb-1 mt-0.5 space-y-0.5 border-l border-border pl-2 ml-3">
          {subGroups.map((g) => (
            <li key={g}>
              <a href={`#${g}`} className="flex min-h-8 items-center rounded-md px-2 text-control text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                {settingsGroupLabel(t, g)}
              </a>
            </li>
          ))}
        </ul>
      )}
    </li>
  );

  return (
    <nav aria-label={ariaLabel} className="mb-4 min-w-0 md:mb-0 md:sticky md:top-0 md:self-start">
      {groups.map((g) => (
        <div key={g.id} className="mt-5 first:mt-0">
          <p className={groupHeading}>{navGroupLabel(t, g.id)}</p>
          <ul className="space-y-0.5">{g.items.map(item)}</ul>
        </div>
      ))}
      {ungrouped.length > 0 && <ul className="mt-2 space-y-0.5">{ungrouped.map(item)}</ul>}
      {showAllSettings && (
        <ul className="mt-3 border-t border-border pt-3">
          <li><Link to="/administration/all-settings" className={sideLinkClass(false)}>{t('allSettings.title', 'All settings')}</Link></li>
        </ul>
      )}
      {operatorListed.length > 0 && (
        <div className="mt-5">
          <p className={groupHeading}>{t('admin.nav.platform', 'Platform')}</p>
          <ul className="space-y-0.5">{operatorListed.map(item)}</ul>
        </div>
      )}
    </nav>
  );
};

/** Side-navigation link: 32px row on desktop, the open section on the selected surface. */
const sideLinkClass = (active: boolean) =>
  cn(
    'touch-target flex min-h-8 min-w-0 items-center rounded-md px-3 py-1 text-control leading-tight transition-colors',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
    active ? 'bg-secondary font-semibold text-nav-active-text' : 'text-foreground hover:bg-accent hover:text-accent-foreground',
  );

/** The frame every Administration section shares: the side navigation beside the section's content (#1126). */
const AdministrationFrame: React.FC<{ nav: React.ReactNode; children: React.ReactNode }> = ({ nav, children }) => !nav ? <>{children}</> : (
  <div className="min-w-0 md:grid md:grid-cols-[12rem_minmax(0,1fr)] md:gap-6 xl:grid-cols-[13.5rem_minmax(0,1fr)] xl:gap-8">
    {nav}
    <div className="min-w-0">{children}</div>
  </div>
);

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
  const { t } = useTranslation(['common', 'billingSteps', 'siteReport']);
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
          <SettingsGroups>
            <SettingsGroup id="accounting-tax" title={settingsGroupLabel(t, 'accounting-tax')}>
              <OrgTaxDefault />
              <OrgFiscalYearStart />
              <OrgWithholdingAccount />
              <OrgVendorTaxAccounts />
              <OrgDownPaymentItem />
            </SettingsGroup>
            <SettingsGroup id="accounting-approvals" title={settingsGroupLabel(t, 'accounting-approvals')}>
              <SpendApprovers />
              <OrgProcurementGates />
              <OrgThreeWayMatch />
              <OrgClaimOverCap />
              <div id="work-order-checklist" className="scroll-mt-4">
                <OrgSwitchSetting setting="workOrderChecklist"
                  label={t('billingSteps:settings.workOrderChecklist.label', 'Edit issued work-order checklists')}
                  helper={t('billingSteps:settings.workOrderChecklist.helper', 'When on, billing-step runners can add steps to issued work orders, and Finance or an Admin can save a checklist as a template for new work orders.')} />
              </div>
            </SettingsGroup>
            <SettingsGroup id="accounting-orders" title={settingsGroupLabel(t, 'accounting-orders')}>
              <ModuleGate module="modulePurchasingExtras"><OrderJobRolesSection /><PurchaseOrderSettingsSection /></ModuleGate>
              <ModuleGate module="modulePurchasingExtras"><OrgPaymentChannels /></ModuleGate>
              <ModuleGate module="modulePurchasingExtras"><OrgPurchaseLines /></ModuleGate>
              <OrgOrderNeededBy />
            </SettingsGroup>
            <SettingsGroup id="accounting-posting" title={settingsGroupLabel(t, 'accounting-posting')}>
              <StockIssueCostSettings />
              <BudgetAccountMap />
              <ExpenseAccountMap />
            </SettingsGroup>
          </SettingsGroups>
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
          <SettingsGroups>
            <SettingsGroup id="projects-numbering" title={settingsGroupLabel(t, 'projects-numbering')}>
              <OrgProjectNumberPattern />
              <OrgProjectClassificationOptions />
              <CostDisciplines />
            </SettingsGroup>
            <SettingsGroup id="projects-site" title={settingsGroupLabel(t, 'projects-site')}>
              <SiteReportLists />
              <DailyReportValidateRoles />
              <OrgSwitchSetting setting="qsReportRevenue"
                label={t('siteReport:revenue.qsAccess', 'Quantity Surveyors see validated daily report revenue')}
                helper={t('siteReport:revenue.qsAccessHelp', 'Shows frozen rates and amounts for one validated report. Other revenue and cost permissions stay unchanged.')} />
              <SiteCheckpointTemplate />
              <ModuleGate module="moduleSiteDay"><SafetyLists /></ModuleGate>
              <NonWorkingDatesCard />
              <OrgAttendanceTarget />
              <ModuleGate module="moduleSiteDay"><OrgPerformanceIndices /></ModuleGate>
            </SettingsGroup>
            <SettingsGroup id="projects-work-orders" title={settingsGroupLabel(t, 'projects-work-orders')}>
              <WorkOrderLists />
              <WorkOrderCheckTemplate />
              <WorkOrderCloseoutTemplate />
              <ModuleGate module="moduleBillingExtras"><RevenuePlanSettings /></ModuleGate>
              <OrgWorkInHandCapacity />
            </SettingsGroup>
            <SettingsGroup id="projects-issues" title={settingsGroupLabel(t, 'projects-issues')}>
              <OrgIssueTypes />
              <IssueClosingReportSettings />
            </SettingsGroup>
          </SettingsGroups>
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
        <AdministrationFrame nav={isAdminViewer && <AdministrationNavigation section={section} sections={navigationSections} isOperator={false} label={label} />}>
          <ListState
            variant="error"
            title={t('admin.access.verifyError', 'Could not verify access')}
            sub={t('admin.access.verifyErrorSub', 'Try again to open Administration controls.')}
            onRetry={operatorMembership.retry}
          />
        </AdministrationFrame>
      ) : !canEnterAdministration ? (
        <GateNotice variant="blocked">
          {t(
            'admin.access.denied',
            "Administration is an Admin, Executive, or platform Operator area. You don't have access.",
          )}
        </GateNotice>
      ) : fxRoute && !canFx ? (
        <AdministrationFrame nav={isAdminViewer && <AdministrationNavigation section={section} sections={navigationSections} isOperator={isOperator} label={label} />}>
          <GateNotice variant="blocked">
            {t('fx.denied', 'Exchange rates are available to Finance and Admin.')}
          </GateNotice>
        </AdministrationFrame>
      ) : section === 'document-categories' && !canManageDocumentCategories ? (
        <AdministrationFrame nav={isAdminViewer && <AdministrationNavigation section={section} sections={navigationSections} isOperator={isOperator} label={label} />}>
          <GateNotice variant="blocked">
            {t('administration:documentCategories.denied', 'Document categories are managed by an Admin.')}
          </GateNotice>
        </AdministrationFrame>
      ) : section === 'scheduled-reports' && !canManageScheduledReports ? (
        <AdministrationFrame nav={isAdminViewer && <AdministrationNavigation section={section} sections={navigationSections} isOperator={isOperator} label={label} />}>
          <GateNotice variant="blocked">
            {t('emailNotifications:scheduled.denied', 'Scheduled reports are managed by an Admin or an enabled Project Control Manager.')}
          </GateNotice>
        </AdministrationFrame>
      ) : operatorRoute && !isOperator ? (
        <AdministrationFrame nav={<AdministrationNavigation section={section} sections={navigationSections} isOperator={false} label={label} />}>
          <GateNotice variant="blocked">
            {t(
              'admin.access.operatorOnly',
              'Operator-only access: Usage and Features are available to platform Operators.',
            )}
          </GateNotice>
        </AdministrationFrame>
      ) : (
        <AdministrationFrame nav={<AdministrationNavigation section={section} sections={navigationSections} isOperator={isOperator} label={label} showAllSettings={isAdminViewer} />}>
          <SelectedAdministrationPanel
            section={section}
            orgId={currentUser?.org_id ?? ''}
            isOperator={isOperator}
            label={label}
          />
        </AdministrationFrame>
      )}
    </div>
  );
};

export default Administration;
