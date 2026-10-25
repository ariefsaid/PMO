import React from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useIsOperator } from '@/src/auth/useIsOperator';
import { UserRole } from '@/types';
import { cn } from '@/src/components/ui/cn';
import { Icon, type IconName } from '@/src/components/ui/icons';
import { isFeatureEnabled } from '@/src/lib/features';
import { AppVersion } from '@/src/components/AppVersion';
import { ApprovalsNavCount } from './ApprovalsNavCount';
import {
  FEATURE_ENV_DEFAULT,
  type OrgFeatureKey,
} from '@/src/lib/features';
import { useOrgFeatures } from '@/src/hooks/useOrgFeatures';
import { useUserViews } from '@/src/hooks/useUserViews';
import { MODULES, RAIL_PARENT_FOR_PATH } from './routeMatch';

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
  /** Owning job group. Dashboard and the Workspace setup utility render separately. */
  group: 'My work' | 'Deliver projects' | 'Manage money' | 'Work with partners';
  /**
   * Optional per-org entitlement gate (ops-admin-surface S6, FR-ENT-005). When set, the item
   * renders only if the org's `org_features` row (or the env default when absent) resolves the
   * key to true. An Operator may toggle these for an org (Admin › Features); core modules
   * (projects/dashboard/approvals/administration) are NEVER gated and stay ungated here.
   */
  feature?: OrgFeatureKey;
  /** Show only when this entitlement is OFF (the item's job is done elsewhere when it is on). */
  unlessFeature?: OrgFeatureKey;
  /** This destination uses the real authorization role while other legacy items keep preview-role behavior. */
  realRoleOnly?: boolean;
}

// Role arrays preserved VERBATIM from Sidebar.tsx getNavItems (AC-AUTH-003/009/010/011).
const ALL_ITEMS: NavItem[] = [
  { to: '/', text: 'Dashboard', icon: 'dashboard', group: 'My work', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  // FIN-S9: the personal "My integrations" doorway (/integrations) moved into the account menu.
  { to: '/projects', text: 'Projects', icon: 'projects', group: 'Deliver projects', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  { to: '/sales', text: 'Sales Pipeline', icon: 'pipeline', group: 'Work with partners', feature: 'crm', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  { to: '/procurement', text: 'Procurement', icon: 'procurement', group: 'Manage money', feature: 'procurement', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  { to: '/timesheets', text: 'Timesheets', icon: 'clock', group: 'My work', feature: 'timesheets', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Engineer, UserRole.Admin] },
  // #775: every member files their own claims; RLS scopes reads to own ∪ approval rank.
  { to: '/expenses', text: 'Expenses', icon: 'expenses', group: 'My work', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  // B-2 (AC-W2-IXD-003 / OD-W2-2): Approvals nav is limited to roles that CAN approve.
  // Engineer approval stays OFF (OD-W2-2 decision) — an IC landing on /approvals sees only
  // "sheets from your reports" which is misleading. Finance is now included: Finance approves
  // *procurement* (policy.ts `transition: allow([...MASTER_DATA])`) and reaches /approvals
  // only via a dashboard tile without the rail. Fix #7: add Finance to this list.
  { to: '/approvals', text: 'Approvals', icon: 'approvals', group: 'My work', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  // Standalone /tasks nav removed — real Tasks CRUD lives in the project Tasks tab
  // (rbac-visibility §M.1: Tasks are reached through project detail, not a top-level nav).
  { to: '/companies', text: 'Companies', icon: 'companies', group: 'Work with partners', feature: 'crm', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  // Contacts (CRM v1): master-data directory of people, mirrors Companies — Exec·PM·Finance·Admin (Engineer = ○).
  // Without CRM there is no Companies item, so PM and Finance keep a direct path to vendors.
  { to: '/companies?type=Vendor', text: 'Vendors', icon: 'companies', group: 'Work with partners', unlessFeature: 'crm', roles: [UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  { to: '/contacts', text: 'Contacts', icon: 'contacts', group: 'Work with partners', feature: 'crm', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  // Incidents is visible to EVERY role — any member may file an incident (rbac-visibility.md §A/§G).
  // Gated behind the `incidents` feature flag (UI-hide-first); currently hidden (features.ts).
  { to: '/incidents', text: 'Incidents', icon: 'alert', group: 'Deliver projects', feature: 'incidents', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  // #526: Meetings — EVERY role may minute a meeting (OD-MTG-1, Engineer included); reads are
  // RLS-scoped to attendance ∪ author ∪ grant ∪ Admin, so the nav item is safe for all roles.
  { to: '/meetings', text: 'Meetings', icon: 'cal', group: 'Deliver projects', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  // UXS-007: PMs get a discoverable assignee-scoped doorway; project Tasks remain for oversight.
  // Engineer and Admin entries remain available; Executive navigation is intentionally unchanged.
  // Finance works assigned tasks like an Engineer (owner, 2026-10-23), so it gets the same doorway.
  { to: '/my-tasks', text: 'My Tasks', icon: 'tasks', group: 'My work', roles: [UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  // Finance section — gated by the `revenue` feature flag (an org entitlement). OD-NAR-2 (owner,
  // 2026-10-07, #784; supersedes DD-NAR-14 for navigation): with NO explicit org_features row the
  // entitlement follows revenue ownership — ON when no ERP owns revenue (PMO-native invoicing is
  // the default), OFF once an ERP owns it; an explicit row still wins, so an Operator can turn it
  // off. Resolution lives in useOrgFeatures (one place). Shown to Finance, PM, Exec and Admin.
  { to: '/sales-invoices', text: 'Sales Invoices', icon: 'invoices', group: 'Manage money', feature: 'revenue', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  { to: '/incoming-payments', text: 'Incoming Payments', icon: 'payments', group: 'Manage money', feature: 'revenue', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  { to: '/financial-statements', text: 'Financial statements', icon: 'table', group: 'Manage money', realRoleOnly: true, roles: [UserRole.Admin, UserRole.Executive, UserRole.Finance] },
  { to: '/revenue-by-project', text: 'Revenue by Project', icon: 'table', group: 'Manage money', feature: 'revenue', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  // #765: the Reports module's first report — the monthly management pack. Same read set and the same
  // `revenue` entitlement as the other Finance items (it is built from sales invoices).
  { to: '/reports', text: 'Management pack', icon: 'reports', group: 'Manage money', feature: 'revenue', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
];

const GROUP_ORDER: Record<UserRole, NavItem['group'][]> = {
  [UserRole.Admin]: ['My work', 'Deliver projects', 'Manage money', 'Work with partners'],
  [UserRole.Executive]: ['My work', 'Deliver projects', 'Manage money', 'Work with partners'],
  [UserRole.Finance]: ['My work', 'Manage money', 'Deliver projects', 'Work with partners'],
  [UserRole.ProjectManager]: ['My work', 'Deliver projects', 'Work with partners', 'Manage money'],
  [UserRole.Engineer]: ['My work', 'Deliver projects'],
};

/** Maximum number of user-view entries displayed in the rail (OD-7, FR-VR-065). */
const MAX_NAV_VIEWS = 8;

/** Base classes shared by every nav anchor (primary items + Administration foot). */
const NAV_LINK_BASE =
  'flex h-9 w-full items-center gap-[11px] rounded-md px-2.5 text-[13.5px] font-medium transition-colors [&_svg]:size-[17px] [&_svg]:shrink-0';

export interface RailProps {
  onNavigate?: () => void;
  /** Membership check unavailable for a role that has no ordinary Administration entry. */
  operatorAccessError?: boolean;
  /**
   * Canonical Projects ownership for project record routes, regardless of lifecycle stage.
   */
  railActiveOverride?: 'projects' | null;
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

export const Rail: React.FC<RailProps> = ({ onNavigate, railActiveOverride, onOpenAssistant, assistantPanelOpen, operatorAccessError = false }) => {
  const { t } = useTranslation();
  const location = useLocation();
  const { effectiveRole, realRole } = useEffectiveRole();
  const role = toUserRole(effectiveRole);
  const realRoleValue = toUserRole(realRole);

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
      ? realRoleValue !== null && i.roles.includes(realRoleValue)
      : i.roles.includes(role)) && (!i.feature || featureEnabled(i.feature)) && (!i.unlessFeature || !featureEnabled(i.unlessFeature)),
  );
  // My Views group + the Assistant toggle remain env-flag-driven (NOT org entitlements — plan M5):
  // `userViews`/`agentAssistant` are env-only sub-flags until the entitlements system absorbs them.
  const showViews = isFeatureEnabled('userViews');
  const viewsItems = showViews && Array.isArray(userViews)
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
    '/timesheets': t('shell.nav.timesheets', 'Timesheets'),
    '/expenses': t('shell.nav.expenses', 'Expenses'),
    '/approvals': t('shell.nav.approvals', 'Approvals'),
    '/companies': t('shell.nav.companies', 'Companies'),
    // No rail item any more (FIN-S9), but the breadcrumb and command palette share this key.
    '/companies?type=Vendor': t('shell.nav.vendors', 'Vendors'),
    '/contacts': t('shell.nav.contacts', 'Contacts'),
    '/incidents': t('shell.nav.incidents', 'Incidents'),
    '/meetings': t('shell.nav.meetings', 'Meetings'),
    '/my-tasks': t('shell.nav.myTasks', 'My Tasks'),
    '/sales-invoices': t('shell.nav.salesInvoices', 'Sales Invoices'),
    '/incoming-payments': t('shell.nav.incomingPayments', 'Incoming Payments'),
    '/revenue-by-project': t('shell.nav.revenueByProject', 'Revenue by Project'),
    '/financial-statements': t('shell.nav.financialStatements', 'Financial statements'),
    '/reports': t('shell.nav.managementPack', 'Management pack'),
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
    'My work': t('shell.rail.group.myWork', 'My work'),
    'Deliver projects': t('shell.rail.group.deliverProjects', 'Deliver projects'),
    'Manage money': t('shell.rail.group.manageMoney', 'Manage money'),
    'Work with partners': t('shell.rail.group.workWithPartners', 'Work with partners'),
  };
  const workspaceSetupLabel = t('shell.rail.group.workspaceSetup', 'Workspace setup');
  const viewsLabel = t('shell.rail.group.views', 'Views');
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
    return <span>{label}</span>;
  };

  const renderItem = (item: NavItem) => {
    // For the two stage-aware items, when an override is set, drive active from
    // the override instead of NavLink's built-in URL-prefix matching.
    const isStageAware = railActiveOverride === 'projects' && item.to === '/projects';
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
            active ? 'bg-primary/10 font-semibold text-nav-active-text' : 'text-foreground hover:bg-accent',
          )}
        >
          <Icon name={item.icon} />
          {renderLabel(item)}
        </Link>
      );
    }

    if (isStageAware) {
      const overrideActive = item.to === '/projects' && railActiveOverride === 'projects';
      return (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/' || item.to.includes('?')}
          onClick={onNavigate}
          // Ignore NavLink's built-in isActive; use the override decision.
          className={() =>
            cn(
              NAV_LINK_BASE,
              overrideActive
                ? 'bg-primary/10 font-semibold text-nav-active-text'
                : 'text-foreground hover:bg-accent',
            )
          }
        >
          <Icon name={item.icon} />
          {renderLabel(item)}
        </NavLink>
      );
    }

    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.to === '/' || item.to.includes('?')}
        onClick={onNavigate}
        className={({ isActive }: { isActive: boolean }) => {
          // A child page outside the module's URL (e.g. /erp-purchases under Procurement) lights its parent.
          const active = isActive || RAIL_PARENT_FOR_PATH[location.pathname] === item.to;
          return cn(
            NAV_LINK_BASE,
            active
              ? 'bg-primary/10 font-semibold text-nav-active-text'
              : 'text-foreground hover:bg-accent',
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
      className="flex min-h-0 flex-col border-r border-border bg-card"
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
        <div data-rail-pinned-dashboard className="shrink-0 border-b border-border p-2.5">
          {items.filter((item) => item.to === '/').map(renderItem)}
        </div>
        <section role="group" aria-label={groupLabels['My work']} data-rail-pinned-work className="shrink-0 border-b border-border px-2.5 pb-2.5">
          <div data-nav-group-heading="My work" className="px-2 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {groupLabels['My work']}
          </div>
          {items.filter((item) => item.to === '/approvals').map(renderItem)}
        </section>
        <div data-rail-scroll-region className="min-h-0 flex-1 overflow-y-auto p-2.5">
          {items.filter((item) => item.group === 'My work' && item.to !== '/' && item.to !== '/approvals').map(renderItem)}
          {GROUP_ORDER[role].map((group) => {
            if (group === 'My work') return null;
            const groupItems = items.filter((item) =>
              item.group === group && item.to !== '/' && item.to !== '/approvals',
            );
            if (groupItems.length === 0) return null;
            return (
              <section key={group} role="group" aria-label={groupLabels[group]}>
                <div data-nav-group-heading={group} className="px-2 pb-1.5 pt-3.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  {groupLabels[group]}
                </div>
                {groupItems.map(renderItem)}
              </section>
            );
          })}
          {showViews && (
            <section role="group" aria-label={viewsLabel}>
              <div className="px-2 pb-1.5 pt-3.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {viewsLabel}
              </div>
              <NavLink
                to="/views"
                onClick={onNavigate}
                end
                className={({ isActive }: { isActive: boolean }) =>
                  cn(NAV_LINK_BASE, isActive ? 'bg-primary/10 font-semibold text-nav-active-text' : 'text-foreground hover:bg-accent')
                }
              >
                <Icon name="views" />
                <span>{viewsLabel}</span>
              </NavLink>
              {viewsItems.map((view) => (
                <NavLink
                  key={view.id}
                  to={`/views/${view.id}`}
                  onClick={onNavigate}
                  className={({ isActive }: { isActive: boolean }) =>
                    cn(
                      NAV_LINK_BASE,
                      isActive
                        ? 'bg-primary/10 font-semibold text-nav-active-text'
                        : 'text-foreground hover:bg-accent',
                    )
                  }
                >
                  <Icon name="views" />
                  <span className="truncate">{view.name}</span>
                </NavLink>
              ))}
            </section>
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
            className={cn(NAV_LINK_BASE, 'w-full text-foreground hover:bg-accent')}
          >
            <Icon name="message" />
            <span>{t('shell.rail.assistant', 'Assistant')}</span>
          </button>
        </div>
      )}

      {(role === UserRole.Executive || role === UserRole.Finance || role === UserRole.Admin || isOperator) && (
        <div aria-label={workspaceSetupLabel} className="flex-shrink-0 border-t border-border p-2.5">
          <div data-nav-group-heading="Workspace setup" className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {workspaceSetupLabel}
          </div>
          <NavLink
            to={role === UserRole.Finance ? '/administration/exchange-rates' : '/administration'}
            onClick={onNavigate}
            className={({ isActive }: { isActive: boolean }) =>
              cn(
                NAV_LINK_BASE,
                isActive
                  ? 'bg-primary/10 font-semibold text-nav-active-text'
                  : 'text-foreground hover:bg-accent',
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
            className="touch-target flex min-h-11 items-center gap-2 rounded-md px-2.5 text-sm text-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
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
