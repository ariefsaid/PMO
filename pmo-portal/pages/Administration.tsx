import OrgProjectClassificationOptions from './admin/OrgProjectClassificationOptions';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link, Navigate, useLocation } from 'react-router';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useOperatorMembership } from '@/src/auth/useIsOperator';
import { cn } from '@/src/components/ui/cn';
import { GateNotice, ListState, SectionHeader } from '@/src/components/ui';
import AdminUsers from './AdminUsers';
import AdministrationCredits from './AdministrationCredits';
import { AdministrationUsage } from './AdministrationUsage';
import AdministrationFeatures from './AdministrationFeatures';
import { AgentCostMetrics } from '@/src/components/admin/AgentCostMetrics';
import { IntegrationsView } from '@/src/components/integrations/IntegrationsView';
import OrgTaxDefault from './admin/OrgTaxDefault';
import SpendApprovers from './admin/SpendApprovers';
import OrgProjectNumberPattern from './admin/OrgProjectNumberPattern';
import BudgetAccountMap from './admin/BudgetAccountMap';
import { useUsage, useAgentRunStats } from '@/src/hooks/useUsage';

export type AdministrationSection =
  | 'users'
  | 'integrations'
  | 'accounting'
  | 'projects'
  | 'credits'
  | 'usage'
  | 'features';

/** Canonical section order (Task 4/6): the four organization destinations, then the Operator-only pair. */
const ORGANIZATION_SECTIONS: AdministrationSection[] = ['users', 'integrations', 'accounting', 'projects', 'credits'];
const OPERATOR_SECTIONS: AdministrationSection[] = ['usage', 'features'];
const ALL_SECTIONS: AdministrationSection[] = [...ORGANIZATION_SECTIONS, ...OPERATOR_SECTIONS];

/** English defaults for the shell's labels — the translatable source (i18next-parser convention). */
const SECTION_LABEL_DEFAULTS: Record<AdministrationSection, string> = {
  users: 'Users',
  integrations: 'Organization integrations',
  accounting: 'Accounting setup',
  projects: 'Project setup',
  credits: 'Credits',
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

const AdministrationHeader: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="mb-4 min-w-0">
      <h1 className="text-[24px] font-bold tracking-[-0.02em]">
        {t('admin.nav.title', 'Administration')}
      </h1>
      <p className="mt-0.5 max-w-[68ch] text-sm text-muted-foreground">
        {t('admin.nav.description', 'Organization setup and governance.')}
      </p>
    </div>
  );
};

const AdministrationNavigation: React.FC<{
  section: AdministrationSection;
  isOperator: boolean;
  label: (id: AdministrationSection) => string;
}> = ({ section, isOperator, label }) => {
  const { t } = useTranslation();
  const linkClass = (active: boolean) =>
    cn(
      'touch-target flex min-h-11 min-w-0 items-center justify-center rounded-md px-2.5 py-1.5 text-center text-[13px] leading-tight transition-colors md:min-h-0',
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

  return (
    <nav aria-label={t('admin.nav.ariaLabel', 'Administration sections')} className="mb-6 min-w-0">
      <div className="grid min-w-0 grid-cols-2 gap-1 rounded-lg bg-secondary p-1 md:flex md:flex-wrap">
        {links(ORGANIZATION_SECTIONS)}
        {isOperator && (
          <>
            <span className="col-span-2 px-2 pt-2 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground md:col-span-1 md:ml-1 md:self-center md:px-1 md:pt-0">
              {t('admin.nav.platform', 'Platform')}
            </span>
            {links(OPERATOR_SECTIONS)}
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
      className="flex items-start gap-2.5 rounded-lg border border-border bg-secondary/35 px-3.5 py-3 text-[13px] text-muted-foreground"
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
          <SectionHeader title={label('integrations')} />
          <IntegrationsView />
        </div>
      );
    case 'accounting':
      return (
        <div data-testid="administration-panel-accounting" className="min-w-0">
          <SectionHeader title={label('accounting')} />
          <div className="space-y-6">
            <OrgProjectNumberPattern />
            <OrgTaxDefault />
            <SpendApprovers />
            <BudgetAccountMap />
          </div>
        </div>
      );
    case 'projects':
      return <div data-testid="administration-panel-projects" className="min-w-0"><SectionHeader title={label('projects')} /><OrgProjectClassificationOptions /></div>;
    case 'credits':
      return (
        <div data-testid="administration-panel-credits" className="min-w-0">
          <AdministrationCredits isOperator={isOperator} orgId={orgId} />
        </div>
      );
    case 'usage':
      return (
        <div data-testid="administration-panel-usage" className="min-w-0">
          <SectionHeader title={label('usage')} />
          <UsagePanel />
        </div>
      );
    case 'features':
      return (
        <div data-testid="administration-panel-features" className="min-w-0">
          <SectionHeader title={label('features')} />
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
  const operatorMembership = useOperatorMembership();
  const section = administrationSectionForPath(pathname);
  const isAdminViewer = may('view', 'user');
  const isOperator = operatorMembership.isOperator;
  const canEnterAdministration = isAdminViewer || isOperator;
  const operatorRoute = section !== undefined && isOperatorSection(section);
  const needsOperatorCheck = operatorRoute || !isAdminViewer;
  const sectionLabels = buildSectionLabels(t);
  const label = (id: AdministrationSection) => sectionLabels[id];

  if (pathname === '/administration') {
    const target = hash === '#budget-account-map'
      ? '/administration/accounting#budget-account-map'
      : '/administration/users';
    return <Navigate to={target} replace />;
  }

  if (!section) {
    return <Navigate to="/administration/users" replace />;
  }

  return (
    <div className="min-w-0">
      <AdministrationHeader />

      {operatorMembership.isPending && needsOperatorCheck ? (
        <OperatorMembershipPending />
      ) : operatorMembership.isError && needsOperatorCheck ? (
        <>
          {isAdminViewer && <AdministrationNavigation section={section} isOperator={false} label={label} />}
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
      ) : operatorRoute && !isOperator ? (
        <>
          <AdministrationNavigation section={section} isOperator={false} label={label} />
          <GateNotice variant="blocked">
            {t(
              'admin.access.operatorOnly',
              'Operator-only access: Usage and Features are available to platform Operators.',
            )}
          </GateNotice>
        </>
      ) : (
        <>
          <AdministrationNavigation section={section} isOperator={isOperator} label={label} />
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
