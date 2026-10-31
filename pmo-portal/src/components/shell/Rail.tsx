import React, { useContext } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useIsOperator } from '@/src/auth/useIsOperator';
import { UserRole } from '@/types';
import { cn } from '@/src/components/ui/cn';
import { Icon, type IconName } from '@/src/components/ui/icons';
import { Badge } from '@/src/components/ui/StatusPill';
import { usePermission } from '@/src/auth/usePermission';
import { useFinancePosition } from '@/src/hooks/useFinancePosition';
import { useTimesheetsAwaitingApproval, useReopenableApprovedTimesheets } from '@/src/hooks/useTimesheetApproval';
import { AuthContext } from '@/src/auth/AuthContext';
import { isFeatureEnabled } from '@/src/lib/features';
import { AppVersion } from '@/src/components/AppVersion';
import { ApprovalsNavCount } from './ApprovalsNavCount';
import {
  FEATURE_ENV_DEFAULT,
  type OrgFeatureKey,
} from '@/src/lib/features';
import { useOrgFeatures } from '@/src/hooks/useOrgFeatures';
import { useUserViews } from '@/src/hooks/useUserViews';
import { MODULES, railParentForPath } from './routeMatch';

// Map profiles.role string → UserRole enum explicitly (preserved from Sidebar.tsx).
// A future enum rename is a compile error here rather than a silent nav bug.
const ROLE_MAP: Record<string, UserRole> = {
  [UserRole.Executive]: UserRole.Executive,
  [UserRole.ProjectManager]: UserRole.ProjectManager,
  [UserRole.Finance]: UserRole.Finance,
  [UserRole.Engineer]: UserRole.Engineer,
  [UserRole.Admin]: UserRole.Admin,
};

function toUserRole(role: string | null): UserRole | null {
  if (!role) return null;
  return ROLE_MAP[role] ?? null;
}

interface NavItem {
  to: string;
  text: string;
  icon: IconName;
  roles: UserRole[];
  /** Owning rail group. */
  group: 'Overview' | 'CRM' | 'Delivery' | 'Workforce' | 'Finance';
  /**
   * Optional per-org entitlement gate (ops-admin-surface S6, FR-ENT-005). When set, the item
   * renders only if the org's `org_features` row (or the env default when absent) resolves the
   * key to true. An Operator may toggle these for an org (Admin › Features); core modules
   * (projects/dashboard/approvals/administration) are NEVER gated and stay ungated here.
   */
  feature?: OrgFeatureKey;
  /** Show only when this entitlement is OFF (the item's job is done elsewhere when it is on). */
  unlessFeature?: OrgFeatureKey;
  /** Finance destinations require both the signed-in role and the selected preview role. */
  realRoleOnly?: boolean;
}

// Role arrays preserved VERBATIM from Sidebar.tsx getNavItems (AC-AUTH-003/009/010/011).
const ALL_ITEMS: NavItem[] = [
  { to: '/', text: 'Dashboard', icon: 'dashboard', group: 'Overview', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  // FIN-S9: the personal "My integrations" doorway (/integrations) moved into the account menu.
  { to: '/projects', text: 'Projects', icon: 'projects', group: 'Delivery', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  { to: '/sales', text: 'Sales Pipeline', icon: 'pipeline', group: 'CRM', feature: 'crm', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  { to: '/procurement', text: 'Procurement', icon: 'procurement', group: 'Delivery', feature: 'procurement', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  { to: '/stock', text: 'Stock', icon: 'inbox', group: 'Delivery', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  { to: '/timesheets', text: 'Timesheets', icon: 'clock', group: 'Workforce', feature: 'timesheets', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Engineer, UserRole.Admin] },
  // #775: every member files their own claims; RLS scopes reads to own ∪ approval rank.
  { to: '/expenses', text: 'Expenses', icon: 'expenses', group: 'Workforce', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  // Ordinary role access is supplemented by record-scoped timesheet eligibility below.
  { to: '/approvals', text: 'Approvals', icon: 'approvals', group: 'Workforce', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  // Standalone /tasks nav removed — real Tasks CRUD lives in the project Tasks tab
  // (rbac-visibility §M.1: Tasks are reached through project detail, not a top-level nav).
  { to: '/companies', text: 'Companies', icon: 'companies', group: 'CRM', feature: 'crm', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  // Contacts (CRM v1): master-data directory of people, mirrors Companies — Exec·PM·Finance·Admin (Engineer = ○).
  // Without CRM there is no Companies item, so PM and Finance keep a direct path to vendors.
  { to: '/companies?type=Vendor', text: 'Suppliers', icon: 'companies', group: 'Delivery', unlessFeature: 'crm', roles: [UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  { to: '/contacts', text: 'Contacts', icon: 'contacts', group: 'CRM', feature: 'crm', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  // Incidents is visible to EVERY role — any member may file an incident (rbac-visibility.md §A/§G).
  // Gated behind the `incidents` feature flag (UI-hide-first); currently hidden (features.ts).
  { to: '/incidents', text: 'Incidents', icon: 'alert', group: 'Delivery', feature: 'incidents', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  // #526: Meetings — EVERY role may minute a meeting (OD-MTG-1, Engineer included); reads are
  // RLS-scoped to attendance ∪ author ∪ grant ∪ Admin, so the nav item is safe for all roles.
  { to: '/meetings', text: 'Meetings', icon: 'cal', group: 'Delivery', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  // UXS-007: PMs get a discoverable assignee-scoped doorway; project Tasks remain for oversight.
  // Engineer and Admin entries remain available; Executive navigation is intentionally unchanged.
  // Finance works assigned tasks like an Engineer (owner, 2026-10-23), so it gets the same doorway.
  { to: '/my-tasks', text: 'My Tasks', icon: 'tasks', group: 'Workforce', roles: [UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  // Finance section — gated by the relevant org entitlements. OD-NAR-2 (owner,
  // 2026-10-07, #784; supersedes DD-NAR-14 for navigation): with NO explicit org_features row the
  // entitlement follows revenue ownership — ON when no ERP owns revenue (PMO-native invoicing is
  // the default), OFF once an ERP owns it; an explicit row still wins, so an Operator can turn it
  // off. Resolution lives in useOrgFeatures (one place). Shown to Finance, Executive and Admin.
  { to: '/finance', text: 'Finance', icon: 'dollar', group: 'Finance', realRoleOnly: true, roles: [UserRole.Executive, UserRole.Finance, UserRole.Admin] },
  { to: '/finance/receivables', text: 'Receivables', icon: 'invoices', group: 'Finance', feature: 'revenue', realRoleOnly: true, roles: [UserRole.Executive, UserRole.Finance, UserRole.Admin] },
  { to: '/finance/payables', text: 'Payables', icon: 'procurement', group: 'Finance', feature: 'procurement', realRoleOnly: true, roles: [UserRole.Executive, UserRole.Finance, UserRole.Admin] },
  { to: '/finance/reports', text: 'Reports', icon: 'reports', group: 'Finance', feature: 'revenue', realRoleOnly: true, roles: [UserRole.Executive, UserRole.Finance, UserRole.Admin] },
  { to: '/finance/statements', text: 'Statements', icon: 'reports', group: 'Finance', realRoleOnly: true, roles: [UserRole.Executive, UserRole.Finance, UserRole.Admin] },
];

const GROUP_ORDER: NavItem['group'][] = ['Overview', 'CRM', 'Delivery', 'Finance', 'Workforce'];

/** Maximum number of user-view entries displayed in the rail (OD-7, FR-VR-065). */
const MAX_NAV_VIEWS = 8;

/** Base classes shared by every nav anchor (primary items + Administration foot). */
const NAV_LINK_BASE =
  'touch-target flex h-[var(--control-height)] w-full items-center gap-3 rounded-md px-2.5 text-control font-medium transition-colors [&_svg]:size-5 [&_svg]:shrink-0';

/** The two items that get stage-aware active-state overrides on `/projects/:id`. */
const STAGE_AWARE_PATHS = new Set(['/projects', '/sales']);

const FinanceOverdueCount: React.FC = () => {
  // Rail unit harnesses can render without an AuthProvider; in the application the provider is
  // always present. Keep the data query behind that boundary so such shell-only renders stay pure.
  const auth = useContext(AuthContext);
  if (!auth) return null;
  return <FinanceOverdueCountValue />;
};

const FinanceOverdueCountValue: React.FC = () => {
  const { t } = useTranslation();
  const { position, isPending, isError } = useFinancePosition();
  if (isPending || isError) return null;
  const count = position.overdue.length;
  return <Badge aria-label={t('financeHub:hub.overdueCount', '{{count}} overdue invoices', { count })}>{count}</Badge>;
};

export interface RailProps {
  onNavigate?: () => void;
  /** Membership check unavailable for a role that has no ordinary Administration entry. */
  operatorAccessError?: boolean;
  /**
   * Stage-aware active-item override for `/projects/:id` detail routes (Option A, Task D).
   *
   * When non-null, the "Projects" (/projects) and "Sales Pipeline" (/sales) items switch
   * their active class from NavLink's URL-based `isActive` to this override:
   *   'salesPipeline' → Sales Pipeline active, Projects inactive
   *   'projects'      → Projects active, Sales Pipeline inactive
   *   null            → both items fall back to NavLink URL-based behaviour (unchanged)
   */
  railActiveOverride?: 'salesPipeline' | 'projects' | null;
  /**
   * Callback fired when the flag-gated "Assistant" toggle button is clicked (FR-AP-005).
   * Only rendered when isFeatureEnabled('agentAssistant') is true; absent when flag is off.
   */
  onOpenAssistant?: () => void;
  /**
   * Whether the AssistantPanel is currently open. Used for aria-pressed on the
   * toggle button (WCAG 4.1.2 name/role/value; D-A2-1, Blocker 5/9).
   * Defaults to false when not provided.
   */
  assistantPanelOpen?: boolean;
}

export const Rail: React.FC<RailProps> = (props) => {
  const auth = useContext(AuthContext);
  const { effectiveRole } = useEffectiveRole();
  return auth && effectiveRole === 'Engineer' ? <RailWithTimesheetEligibility {...props} /> : <RailContent {...props} />;
};

const RailWithTimesheetEligibility: React.FC<RailProps> = (props) => {
  const pending = useTimesheetsAwaitingApproval();
  const corrections = useReopenableApprovedTimesheets();
  return <RailContent {...props} hasEligibleTimesheets={Boolean(pending.data?.length || corrections.data?.length || pending.isPending || corrections.isPending || pending.isError || corrections.isError)} />;
};

const RailContent: React.FC<RailProps & { hasEligibleTimesheets?: boolean }> = ({ onNavigate, railActiveOverride, onOpenAssistant, assistantPanelOpen, operatorAccessError = false, hasEligibleTimesheets = false }) => {
  const { t } = useTranslation();
  const location = useLocation();
  const { effectiveRole, realRole } = useEffectiveRole();
  const role = toUserRole(effectiveRole);
  const realRoleValue = toUserRole(realRole);
  const may = usePermission();
  const canViewStatements = may('view', 'financialStatements');

  // Must call hooks unconditionally BEFORE early returns (rules-of-hooks).
  const { data: userViews } = useUserViews();
  // ops-admin-surface S6: resolve per-org entitlements ONCE. `data` is undefined while loading;
  // each gated item then falls back to its FEATURE_ENV_DEFAULT (the rail resolves gracefully on
  // first paint — an always-on module is never hidden by a loading state).
  const { data: orgFeatures } = useOrgFeatures();
  const featureEnabled = (key: OrgFeatureKey): boolean =>
    orgFeatures?.[key] ?? FEATURE_ENV_DEFAULT[key];

  // AC-ADMIA-002: a REAL server-confirmed platform Operator (any base role) can reach
  // /administration by URL, so the rail's Administration footer must be discoverable for them.
  // Sourced from the settled `useIsOperator()` projection — never the effective/preview role — so
  // a plain Engineer stays hidden while a genuine Operator gains the entry. Fail-closed (false).
  const isOperator = useIsOperator();

  if (!role) return null;

  const items = ALL_ITEMS.filter(
    (i) => (i.realRoleOnly
      ? role !== null && realRoleValue !== null && i.roles.includes(role) && i.roles.includes(realRoleValue)
      : (i.roles.includes(role) || (i.to === '/approvals' && hasEligibleTimesheets))) && (!i.feature || featureEnabled(i.feature)) && (!i.unlessFeature || !featureEnabled(i.unlessFeature)) && (i.to !== '/finance/statements' || canViewStatements),
  );
  // My Views group + the Assistant toggle remain env-flag-driven (NOT org entitlements — plan M5):
  // `userViews`/`agentAssistant` are env-only sub-flags until the entitlements system absorbs them.
  const showMyViews =
    isFeatureEnabled('userViews') &&
    Array.isArray(userViews) &&
    userViews.length > 0;
  const myViewsItems = showMyViews
    ? (userViews ?? []).slice(0, MAX_NAV_VIEWS)
    : [];

  // Display labels for the nav, keyed by the SAME route/group values `ALL_ITEMS` already carries.
  // Written as literal `t(key, default)` calls rather than a field on `ALL_ITEMS` for one reason:
  // `i18next-parser` extracts literal keys only, so a `t(item.labelKey, item.text)` call site would
  // be invisible to the en-side completeness gate (FR-L10N-042a) and the key would read as orphaned.
  // `ALL_ITEMS` stays untouched data; its `text` remains the English source and the fallback for a
  // route added here without a label.
  const staticNavLabels: Record<string, string> = {
    // Literal translation calls keep catalogue extraction complete. Module metadata supplies
    // each shared key; these localized values are the parser-visible fallbacks for that key.
    '/': t('shell.nav.dashboard', 'Dashboard'),
    '/projects': t('shell.nav.projects', 'Projects'),
    '/sales': t('shell.nav.sales', 'Sales Pipeline'),
    '/procurement': t('shell.nav.procurement', 'Procurement'),
    '/stock': t('shell.nav.stock', 'Stock'),
    '/timesheets': t('shell.nav.timesheets', 'Timesheets'),
    '/expenses': t('shell.nav.expenses', 'Expenses'),
    '/finance': t('financeHub:nav.finance', 'Finance'),
    '/finance/receivables': t('financeHub:hub.receivables', 'Receivables'),
    '/finance/payables': t('financeHub:hub.payables', 'Payables'),
    '/finance/reports': t('financeHub:hub.reports', 'Reports'),
    '/finance/statements': t('financeHub:hub.statements', 'Statements'),
    '/approvals': t('shell.nav.approvals', 'Approvals'),
    '/companies': t('shell.nav.companies', 'Companies'),
    // No rail item any more (FIN-S9), but the breadcrumb and command palette share this key.
    '/companies?type=Vendor': t('shell.nav.vendors', 'Suppliers'),
    '/contacts': t('shell.nav.contacts', 'Contacts'),
    '/incidents': t('shell.nav.incidents', 'Incidents'),
    '/meetings': t('shell.nav.meetings', 'Meetings'),
    '/my-tasks': t('shell.nav.myTasks', 'My Tasks'),
    '/sales-invoices': t('shell.nav.salesInvoices', 'Sales Invoices'),
    '/incoming-payments': t('shell.nav.incomingPayments', 'Incoming Payments'),
    '/revenue-by-project': t('shell.nav.revenueByProject', 'Revenue by Project'),
    '/financial-statements': t('shell.nav.financialStatements', 'Financial statements'),
    '/reports': t('shell.nav.managementPack', 'Reports'),
  };
  const navLabels: Record<string, string> = Object.fromEntries(
    items.map((item) => {
      const route = MODULES.find((module) => module.path === item.to);
      return [
        item.to,
        route?.labelKey
          ? t(route.labelKey, staticNavLabels[item.to] ?? route.label)
          : staticNavLabels[item.to] ?? item.text,
      ];
    }),
  );
  const groupLabels: Record<NavItem['group'], string> = {
    Overview: t('shell.rail.group.overview', 'Overview'),
    CRM: t('shell.rail.group.crm', 'CRM'),
    Delivery: t('shell.rail.group.delivery', 'Delivery'),
    Workforce: t('shell.rail.group.workforce', 'Workforce'),
    Finance: t('shell.rail.group.finance', 'Finance'),
  };
  const myViewsLabel = t('shell.rail.myViews', 'My Views');
  const renderLabel = (item: NavItem) => {
    const label = navLabels[item.to] ?? item.text;
    if (item.to === '/approvals') {
      return (
        <>
          <span>{label}</span>
          <ApprovalsNavCount />
        </>
      );
    }
    if (item.to === '/finance') return <><span>{label}</span><FinanceOverdueCount /></>;
    return <span>{label}</span>;
  };

  const renderItem = (item: NavItem) => {
    // For the two stage-aware items, when an override is set, drive active from
    // the override instead of NavLink's built-in URL-prefix matching.
    const isStageAware = railActiveOverride != null && STAGE_AWARE_PATHS.has(item.to);
    const isCompanyDirectoryLink = item.to === '/companies';

    if (isCompanyDirectoryLink) {
      const active = location.pathname === '/companies';
      return (
        <Link
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          aria-current={active ? 'page' : undefined}
          className={cn(
            NAV_LINK_BASE,
            active ? 'bg-nav-selected-surface font-semibold text-nav-active-text' : 'text-foreground hover:bg-surface-hover',
          )}
        >
          <Icon name={item.icon} />
          {renderLabel(item)}
        </Link>
      );
    }

    if (isStageAware) {
      const overrideActive =
        (item.to === '/projects' && railActiveOverride === 'projects') ||
        (item.to === '/sales' && railActiveOverride === 'salesPipeline');
      return (
        <Link
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          aria-current={overrideActive ? 'page' : undefined}
          className={cn(
            NAV_LINK_BASE,
            overrideActive
              ? 'bg-nav-selected-surface font-semibold text-nav-active-text'
              : 'text-foreground hover:bg-surface-hover',
          )}
        >
          <Icon name={item.icon} />
          {renderLabel(item)}
        </Link>
      );
    }

    // Child routes outside the parent's URL (e.g. /erp-purchases under Procurement)
    // use the parent decision for both the selected treatment and its accessible state.
    if (railParentForPath(location.pathname) === item.to) {
      return (
        <Link
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          aria-current="page"
          className={cn(NAV_LINK_BASE, 'bg-nav-selected-surface font-semibold text-nav-active-text')}
        >
          <Icon name={item.icon} />
          {renderLabel(item)}
        </Link>
      );
    }

    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.to === '/' || item.to.includes('?') || item.to.startsWith('/finance')}
        onClick={onNavigate}
        className={({ isActive }: { isActive: boolean }) => {
          // A child page outside the module's URL (e.g. /erp-purchases under Procurement) lights its parent.
          const active = isActive || railParentForPath(location.pathname) === item.to;
          return cn(
            NAV_LINK_BASE,
            active
              ? 'bg-nav-selected-surface font-semibold text-nav-active-text'
              : 'text-foreground hover:bg-surface-hover',
          );
        }}
      >
        <Icon name={item.icon} />
        {renderLabel(item)}
      </NavLink>
    );
  };

  return (
    <aside
      className="flex min-h-0 flex-col border-r border-border bg-[hsl(var(--surface-panel))]"
      style={{ gridArea: 'rail' }}
    >
      <div
        className="flex flex-shrink-0 items-center gap-2.5 border-b border-border px-4"
        style={{ height: 'var(--header-h)' }}
      >
        <span
          className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-primary text-sm font-bold text-primary-foreground"
          aria-hidden
        >
          P
        </span>
        <span className="text-[15px] font-bold tracking-[-0.01em]">PMO Portal{/* i18n-exempt: PMO brand name stays verbatim */}</span>
      </div>

      <nav
        aria-label={t('shell.rail.primaryNavigation', 'Primary navigation')}
        className="flex min-h-0 flex-1 flex-col"
      >
        {items.some((item) => item.to === '/approvals') && (
          <div data-rail-pinned-approvals className="shrink-0 border-b border-border p-2.5">
            {items.filter((item) => item.to === '/approvals').map(renderItem)}
          </div>
        )}
        <div data-rail-scroll-region className="min-h-0 flex-1 overflow-y-auto p-2.5">
          {GROUP_ORDER.map((group) => {
            const groupItems = items.filter((i) => i.to !== '/approvals' && i.group === group);
            if (groupItems.length === 0) return null;
            return (
              <React.Fragment key={group}>
                <div className="px-2 pb-1.5 pt-3.5 text-support font-semibold text-muted-foreground">
                  {groupLabels[group]}
                </div>
                {groupItems.map(renderItem)}
              </React.Fragment>
            );
          })}
          {showMyViews && (
            <div role="group" aria-label={myViewsLabel}>
              <div className="px-2 pb-1.5 pt-3.5 text-support font-semibold text-muted-foreground">
                {myViewsLabel}
              </div>
              {myViewsItems.map((view) => (
                <NavLink
                  key={view.id}
                  to={`/views/${view.id}`}
                  onClick={onNavigate}
                  className={({ isActive }: { isActive: boolean }) =>
                    cn(
                      NAV_LINK_BASE,
                      isActive
                        ? 'bg-nav-selected-surface font-semibold text-nav-active-text'
                        : 'text-foreground hover:bg-surface-hover',
                    )
                  }
                >
                  <Icon name="views" />
                  <span className="truncate">{view.name}</span>
                </NavLink>
              ))}
            </div>
          )}
        </div>
      </nav>

      {/* FR-AP-005 / AC-AP-004: "Assistant" toggle — flag-gated, visible to ALL roles.
          Not a NavLink (routes nowhere) — a <button> with aria-pressed (toggle
          semantics). Placed above the Administration footer. */}
      {isFeatureEnabled('agentAssistant') && (
        <div className="flex-shrink-0 border-t border-border p-2.5">
          <button
            type="button"
            aria-pressed={assistantPanelOpen ?? false}
            onClick={() => {
              onOpenAssistant?.();
              onNavigate?.();
            }}
            className={cn(NAV_LINK_BASE, 'w-full text-foreground hover:bg-surface-hover aria-pressed:bg-nav-selected-surface aria-pressed:text-nav-active-text')}
          >
            <Icon name="message" />
            <span>{t('shell.rail.assistant', 'Assistant')}</span>
          </button>
        </div>
      )}

      {(role === UserRole.Executive || role === UserRole.Finance || role === UserRole.Admin || isOperator) && (
        <div className="flex-shrink-0 border-t border-border p-2.5">
          <NavLink
            to={role === UserRole.Finance ? '/administration/exchange-rates' : '/administration'}
            onClick={onNavigate}
            className={({ isActive }: { isActive: boolean }) =>
              cn(
                NAV_LINK_BASE,
                isActive
                  ? 'bg-nav-selected-surface font-semibold text-nav-active-text'
                  : 'text-foreground hover:bg-surface-hover',
              )
            }
          >
            <Icon name="admin" />
            <span>{t('shell.nav.administration', 'Administration')}</span>
          </NavLink>
        </div>
      )}
      {operatorAccessError && role !== UserRole.Executive && role !== UserRole.Admin && !isOperator && (
        <div className="flex-shrink-0 border-t border-border p-2.5">
          <NavLink
            to="/administration/users"
            onClick={onNavigate}
            className="touch-target flex min-h-11 items-center gap-3 rounded-md px-2.5 text-control text-foreground hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-5"
          >
            <Icon name="admin" aria-hidden="true" />
            <span>{t('admin.access.checkEntry', 'Check Administration access')}</span>
          </NavLink>
        </div>
      )}

      {/* Build version — a quiet sidebar footer. Moved here from a fixed bottom-left
          corner overlay that collided with this very nav; in normal flow it sits cleanly
          at the sidebar foot. Always visible, incl. prod (ADR-0042 §4). */}
      <div className="flex-shrink-0 border-t border-border px-4 py-2">
        <AppVersion />
      </div>
    </aside>
  );
};

export default Rail;
