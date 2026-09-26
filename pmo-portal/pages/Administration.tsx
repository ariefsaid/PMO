import React from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useOperatorMembership } from '@/src/auth/useIsOperator';
import { cn } from '@/src/components/ui/cn';
import { GateNotice, SectionHeader } from '@/src/components/ui';
import AdminUsers from './AdminUsers';
import AdministrationCredits from './AdministrationCredits';
import { AdministrationUsage } from './AdministrationUsage';
import AdministrationFeatures from './AdministrationFeatures';
import { AgentCostMetrics } from '@/src/components/admin/AgentCostMetrics';
import { IntegrationsView } from '@/src/components/integrations/IntegrationsView';
import OrgTaxDefault from './admin/OrgTaxDefault';
import BudgetAccountMap from './admin/BudgetAccountMap';
import { useUsage, useAgentRunStats } from '@/src/hooks/useUsage';

export type AdministrationSection =
  | 'users'
  | 'integrations'
  | 'accounting'
  | 'credits'
  | 'usage'
  | 'features';

const ORGANIZATION_SECTIONS: ReadonlyArray<{ id: AdministrationSection; label: string }> = [
  { id: 'users', label: 'Users' },
  { id: 'integrations', label: 'Organization integrations' },
  { id: 'accounting', label: 'Accounting setup' },
  { id: 'credits', label: 'Credits' },
];

const OPERATOR_SECTIONS: ReadonlyArray<{ id: AdministrationSection; label: string }> = [
  { id: 'usage', label: 'Usage' },
  { id: 'features', label: 'Features' },
];

const ALL_SECTIONS = [...ORGANIZATION_SECTIONS, ...OPERATOR_SECTIONS];

function administrationSectionForPath(pathname: string): AdministrationSection | undefined {
  const prefix = '/administration/';
  if (!pathname.startsWith(prefix)) return undefined;
  const section = pathname.slice(prefix.length);
  if (section.includes('/')) return undefined;
  return ALL_SECTIONS.some(({ id }) => id === section) ? (section as AdministrationSection) : undefined;
}

const isOperatorSection = (section: AdministrationSection): boolean =>
  section === 'usage' || section === 'features';

const AdministrationHeader: React.FC = () => (
  <div className="mb-4 min-w-0">
    <h1 className="text-[24px] font-bold tracking-[-0.02em]">Administration</h1>
    <p className="mt-0.5 max-w-[68ch] text-sm text-muted-foreground">
      Organization setup and governance.
    </p>
  </div>
);

const AdministrationNavigation: React.FC<{
  section: AdministrationSection;
  isOperator: boolean;
}> = ({ section, isOperator }) => {
  const linkClass = (active: boolean) =>
    cn(
      'min-w-0 rounded-md px-2.5 py-1.5 text-center text-[13px] leading-tight transition-colors',
      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
      active
        ? 'bg-background font-semibold text-nav-active-text shadow-sm'
        : 'text-foreground hover:bg-accent hover:text-accent-foreground',
    );

  const links = (items: ReadonlyArray<{ id: AdministrationSection; label: string }>) =>
    items.map(({ id, label }) => (
      <Link
        key={id}
        to={`/administration/${id}`}
        aria-current={section === id ? 'page' : undefined}
        className={linkClass(section === id)}
      >
        {label}
      </Link>
    ));

  return (
    <nav aria-label="Administration sections" className="mb-6 min-w-0">
      <div className="grid min-w-0 grid-cols-2 gap-1 rounded-lg bg-secondary p-1 md:flex md:flex-wrap">
        {links(ORGANIZATION_SECTIONS)}
        {isOperator && (
          <>
            <span className="col-span-2 px-2 pt-2 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground md:col-span-1 md:ml-1 md:self-center md:px-1 md:pt-0">
              Platform
            </span>
            {links(OPERATOR_SECTIONS)}
          </>
        )}
      </div>
    </nav>
  );
};

const OperatorMembershipPending: React.FC = () => (
  <div
    role="status"
    aria-live="polite"
    className="flex items-start gap-2.5 rounded-lg border border-border bg-secondary/35 px-3.5 py-3 text-[13px] text-muted-foreground"
  >
    <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground" />
    <span>Checking your Administration access…</span>
  </div>
);

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
}> = ({ section, orgId, isOperator }) => {
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
          <SectionHeader title="Organization integrations" />
          <IntegrationsView />
        </div>
      );
    case 'accounting':
      return (
        <div data-testid="administration-panel-accounting" className="min-w-0">
          <SectionHeader title="Accounting setup" />
          <div className="space-y-6">
            <OrgTaxDefault />
            <BudgetAccountMap />
          </div>
        </div>
      );
    case 'credits':
      return (
        <div data-testid="administration-panel-credits" className="min-w-0">
          <AdministrationCredits isOperator={isOperator} orgId={orgId} />
        </div>
      );
    case 'usage':
      return (
        <div data-testid="administration-panel-usage" className="min-w-0">
          <SectionHeader title="Usage" />
          <UsagePanel />
        </div>
      );
    case 'features':
      return (
        <div data-testid="administration-panel-features" className="min-w-0">
          <SectionHeader title="Features" />
          <AdministrationFeatures isOperator={isOperator} orgId={orgId} />
        </div>
      );
  }
};

const Administration: React.FC = () => {
  const { pathname, hash } = useLocation();
  const may = usePermission();
  const { currentUser } = useAuth();
  const operatorMembership = useOperatorMembership();
  const section = administrationSectionForPath(pathname);
  const isAdminViewer = may('view', 'user');
  const isOperator = operatorMembership.isOperator;
  const canEnterAdministration = isAdminViewer || isOperator;
  const operatorRoute = section !== undefined && isOperatorSection(section);

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

      {operatorMembership.isPending && (operatorRoute || !canEnterAdministration) ? (
        <OperatorMembershipPending />
      ) : !canEnterAdministration ? (
        <GateNotice variant="blocked">
          Administration is an Admin, Executive, or platform Operator area. You don&rsquo;t have access.
        </GateNotice>
      ) : operatorRoute && !isOperator ? (
        <>
          <AdministrationNavigation section={section} isOperator={false} />
          <GateNotice variant="blocked">
            Operator-only access: Usage and Features are available to platform Operators.
          </GateNotice>
        </>
      ) : (
        <>
          <AdministrationNavigation section={section} isOperator={isOperator} />
          <SelectedAdministrationPanel
            section={section}
            orgId={currentUser?.org_id ?? ''}
            isOperator={isOperator}
          />
        </>
      )}
    </div>
  );
};

export default Administration;
