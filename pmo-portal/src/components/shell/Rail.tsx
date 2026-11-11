import React, { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useIsOperator } from '@/src/auth/useIsOperator';
import { UserRole } from '@/types';
import { cn } from '@/src/components/ui/cn';
import { Icon, type IconName } from '@/src/components/ui/icons';
import { usePermission } from '@/src/auth/usePermission';
import { useTimesheetsAwaitingApproval, useReopenableApprovedTimesheets } from '@/src/hooks/useTimesheetApproval';
import { AuthContext } from '@/src/auth/AuthContext';
import { useFeature } from '@/src/auth/useFeature';
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

type NavigationGroup = 'My work' | 'Delivery' | 'Sales' | 'Finance';

interface NavItem {
  to: string;
  text: string;
  icon: IconName;
  roles: UserRole[];
  /** Missing for the three unheaded destinations above the grouped sections. */
  group?: NavigationGroup;
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

// This is the one ordered navigation registry. Role, feature and real-role gates only remove
// entries from this sequence; the order never changes for the current role. The `ALL_ITEMS` name
// is load-bearing: scripts/check-module-completeness.mjs parses this block by it.
// eslint-disable-next-line react-refresh/only-export-components -- registry constant co-located with its rail; HMR-only lint concern
export const ALL_ITEMS: NavItem[] = [
  { to: '/', text: 'Dashboard', icon: 'dashboard', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  { to: '/approvals', text: 'Approvals', icon: 'approvals', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  { to: '/views', text: 'My Views', icon: 'views', group: undefined, feature: 'user_views', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  { to: '/my-tasks', text: 'My Tasks', icon: 'tasks', group: 'My work', roles: [UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  { to: '/timesheets', text: 'Timesheets', icon: 'clock', group: 'My work', feature: 'timesheets', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Engineer, UserRole.Admin] },
  // #775: every member files their own claims; RLS scopes reads to own ∪ approval rank.
  { to: '/expenses', text: 'Expenses', icon: 'expenses', group: 'My work', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  // #1515: floats are visible to approval rank (policy imprestFloat.view = master-data roles); Engineers see none.
  { to: '/imprest', text: 'Site cash', icon: 'site-cash', group: 'My work', feature: 'imprest', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  // #1982: Calendar — what is due across projects. Reads are RLS-scoped, so every role gets it.
  { to: '/calendar', text: 'Calendar', icon: 'cal', group: 'My work', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  { to: '/projects', text: 'Projects', icon: 'projects', group: 'Delivery', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  { to: '/procurement', text: 'Procurement', icon: 'procurement', group: 'Delivery', feature: 'procurement', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  { to: '/stock', text: 'Stock', icon: 'inbox', group: 'Delivery', feature: 'stock', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  // #1519: every member logs equipment usage; the Assets and approvals views gate by role inside the page.
  { to: '/equipment', text: 'Equipment', icon: 'equipment', group: 'Delivery', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  // Incidents is visible to EVERY role — any member may file an incident (rbac-visibility.md §A/§G).
  // Gated behind the `incidents` feature flag (UI-hide-first); currently hidden (features.ts).
  { to: '/incidents', text: 'Incidents', icon: 'alert', group: 'Delivery', feature: 'incidents', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  // #526: Meetings — EVERY role may minute a meeting (OD-MTG-1, Engineer included); reads are RLS-scoped.
  { to: '/meetings', text: 'Meetings', icon: 'meetings', group: 'Delivery', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
  { to: '/sales', text: 'Sales Pipeline', icon: 'pipeline', group: 'Sales', feature: 'sales_pipeline', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  { to: '/companies', text: 'Companies', icon: 'companies', group: 'Sales', feature: 'crm', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  // Without CRM, PM and Finance keep their existing supplier doorway in this same ordered slot.
  { to: '/companies?type=Vendor', text: 'Suppliers', icon: 'cart', group: 'Sales', unlessFeature: 'crm', roles: [UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  { to: '/contacts', text: 'Contacts', icon: 'contacts', group: 'Sales', feature: 'crm', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin] },
  // Finance section — gated by the relevant org entitlements. OD-NAR-2 (owner,
  // 2026-10-07, #784; supersedes DD-NAR-14 for navigation): with NO explicit org_features row the
  // entitlement follows revenue ownership — ON when no ERP owns revenue (PMO-native invoicing is
  // the default), OFF once an ERP owns it; an explicit row still wins, so an Operator can turn it
  // off. Resolution lives in useOrgFeatures (one place). Shown to Finance, Executive and Admin.
  { to: '/finance', text: 'Overview', icon: 'dollar', group: 'Finance', realRoleOnly: true, roles: [UserRole.Executive, UserRole.Finance, UserRole.Admin] },
  { to: '/finance/receivables', text: 'Receivables', icon: 'download', group: 'Finance', feature: 'revenue', realRoleOnly: true, roles: [UserRole.Executive, UserRole.Finance, UserRole.Admin] },
  { to: '/finance/payables', text: 'Payables', icon: 'payments', group: 'Finance', feature: 'procurement', realRoleOnly: true, roles: [UserRole.Executive, UserRole.Finance, UserRole.Admin] },
  { to: '/finance/reports', text: 'Reports', icon: 'reports', group: 'Finance', feature: 'management_pack', realRoleOnly: true, roles: [UserRole.Executive, UserRole.Finance, UserRole.Admin] },
  { to: '/finance/statements', text: 'Statements', icon: 'statements', group: 'Finance', feature: 'financial_statements', realRoleOnly: true, roles: [UserRole.Executive, UserRole.Finance, UserRole.Admin] },
];

const GROUP_ORDER: NavigationGroup[] = ['My work', 'Delivery', 'Sales', 'Finance'];
const NAV_GROUPS_STORAGE_KEY = 'shell.navigation.collapsedGroups';
const NAV_GROUPS_CHANGED_EVENT = 'navigationgroupschange';

function readCollapsedGroups(): Set<NavigationGroup> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(NAV_GROUPS_STORAGE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is NavigationGroup => GROUP_ORDER.includes(value as NavigationGroup)));
  } catch {
    return new Set();
  }
}

function saveCollapsedGroups(groups: Set<NavigationGroup>): void {
  try {
    window.localStorage.setItem(NAV_GROUPS_STORAGE_KEY, JSON.stringify([...groups]));
  } catch {
    // The in-memory state still applies when storage is unavailable.
  }
  window.dispatchEvent(new Event(NAV_GROUPS_CHANGED_EVENT));
}

/** Whether `pathname` is inside the rail item `to` (query ignored; `/` and Finance match exactly). */
const pathInItem = (pathname: string, to: string): boolean => {
  const base = to.split('?')[0];
  if (base === '/' || base.startsWith('/finance')) return pathname === base;
  return pathname === base || pathname.startsWith(`${base}/`);
};

/** Maximum number of user-view entries displayed in the rail (OD-7, FR-VR-065). */
const MAX_NAV_VIEWS = 8;

/** Base classes shared by every nav anchor (primary items + Administration foot). */
const NAV_LINK_BASE =
  'touch-target flex h-[var(--control-height)] w-full items-center gap-3 rounded-md px-2.5 text-control font-medium [&_svg]:size-5 [&_svg]:shrink-0';

/** The two items that get stage-aware active-state overrides on `/projects/:id`. */
const STAGE_AWARE_PATHS = new Set(['/projects', '/sales']);

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
   * Only rendered when the deployment flag AND the org's `agent_assistant` entitlement hold; absent otherwise.
   */
  onOpenAssistant?: () => void;
  /**
   * Whether the AssistantPanel is currently open. Used for aria-pressed on the
   * toggle button (WCAG 4.1.2 name/role/value; D-A2-1, Blocker 5/9).
   * Defaults to false when not provided.
   */
  assistantPanelOpen?: boolean;
  /**
   * #1834: fired with a rail link's `href` on hover, focus and pointerdown, so
   * the destination's code starts downloading before the click. The app wires
   * this to `preloadForPath`; absent, the rail never preloads (tests, storybook).
   */
  onPreloadHref?: (href: string) => void;
}

export const Rail: React.FC<RailProps> = React.memo(function Rail(props) {
  const auth = useContext(AuthContext);
  const { effectiveRole } = useEffectiveRole();
  return auth && effectiveRole === 'Engineer' ? <RailWithTimesheetEligibility {...props} /> : <RailContent {...props} />;
});

const RailWithTimesheetEligibility: React.FC<RailProps> = (props) => {
  const pending = useTimesheetsAwaitingApproval();
  const corrections = useReopenableApprovedTimesheets();
  return <RailContent {...props} hasEligibleTimesheets={Boolean(pending.data?.length || corrections.data?.length || pending.isPending || corrections.isPending || pending.isError || corrections.isError)} />;
};

const RailContent: React.FC<RailProps & { hasEligibleTimesheets?: boolean }> = ({ onNavigate, railActiveOverride, onOpenAssistant, assistantPanelOpen, operatorAccessError = false, hasEligibleTimesheets = false, onPreloadHref }) => {
  const { t } = useTranslation();
  const location = useLocation();
  const { effectiveRole, realRole } = useEffectiveRole();
  const role = toUserRole(effectiveRole);
  const realRoleValue = toUserRole(realRole);
  const may = usePermission();
  const canViewStatements = may('view', 'financialStatements');

  // Must call hooks unconditionally BEFORE early returns (rules-of-hooks).
  // ops-admin-surface S6: resolve per-org entitlements ONCE. `data` is undefined while loading;
  // each gated item then falls back to its FEATURE_ENV_DEFAULT (the rail resolves gracefully on
  // first paint — an always-on module is never hidden by a loading state).
  const { data: orgFeatures } = useOrgFeatures();
  const featureEnabled = (key: OrgFeatureKey): boolean =>
    orgFeatures?.[key] ?? FEATURE_ENV_DEFAULT[key];
  // The two deployment-gated keys resolve through useFeature so their ENV KILL SWITCH stays an
  // additional AND over the entitlement (S3 constraint): an Operator cannot re-enable a capability
  // the deployment turned off, and flipping the env var still hides the surface for every org.
  const userViewsEnabled = useFeature('user_views');
  // The saved-views read only runs for an org that has the module (the rail is on every page).
  const { data: userViews } = useUserViews(userViewsEnabled);
  const agentAssistantEnabled = useFeature('agent_assistant');

  // AC-ADMIA-002: a REAL server-confirmed platform Operator (any base role) can reach
  // /administration by URL, so the rail's Administration footer must be discoverable for them.
  // Sourced from the settled `useIsOperator()` projection — never the effective/preview role — so
  // a plain Engineer stays hidden while a genuine Operator gains the entry. Fail-closed (false).
  const isOperator = useIsOperator();
  const railId = useId().replaceAll(':', '');
  const [collapsedGroups, setCollapsedGroups] = useState(readCollapsedGroups);
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const [hasScrollCue, setHasScrollCue] = useState(false);
  useLayoutEffect(() => {
    const active = scrollRegionRef.current?.querySelector<HTMLElement>('a[aria-current="page"]');
    active?.scrollIntoView?.({ block: 'nearest' });
  }, [location.pathname, location.search]);
  useLayoutEffect(() => {
    const region = scrollRegionRef.current;
    if (!region) return;
    const updateCue = () => setHasScrollCue(region.scrollHeight > region.clientHeight + 1);
    updateCue();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateCue);
    observer.observe(region);
    return () => observer.disconnect();
  }, [role, userViews?.length, collapsedGroups, orgFeatures]);
  useEffect(() => {
    const onChange = () => setCollapsedGroups(readCollapsedGroups());
    const onStorage = (event: StorageEvent) => {
      if (event.key === NAV_GROUPS_STORAGE_KEY) onChange();
    };
    window.addEventListener(NAV_GROUPS_CHANGED_EVENT, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(NAV_GROUPS_CHANGED_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  if (!role) return null;

  const items = ALL_ITEMS.filter(
    (i) => (i.realRoleOnly
      ? role !== null && realRoleValue !== null && i.roles.includes(role) && i.roles.includes(realRoleValue)
      : (i.roles.includes(role) || (i.to === '/approvals' && hasEligibleTimesheets))) && (!i.feature || featureEnabled(i.feature)) && (!i.unlessFeature || !featureEnabled(i.unlessFeature)) && (i.to !== '/finance/statements' || canViewStatements),
  ).filter((i) => i.to !== '/views' || userViewsEnabled);
  const currentGroup = items.find((item) =>
    item.group && (pathInItem(location.pathname, item.to) || railParentForPath(location.pathname) === item.to),
  )?.group;
  const toggleGroup = (group: NavigationGroup) => {
    if (group === currentGroup) return;
    const next = new Set(collapsedGroups);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    setCollapsedGroups(next);
    saveCollapsedGroups(next);
  };
  // My Views group + the Assistant toggle follow BOTH the entitlement and their deployment kill
  // switch (resolved inside useFeature), not the env flag alone.
  const myViewsItems = (userViews ?? []).slice(0, MAX_NAV_VIEWS);

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
    '/imprest': t('imprest:nav.siteCash', 'Site cash'),
    '/equipment': t('equipment:nav.equipment', 'Equipment'),
    '/finance': t('financeHub:nav.overview', 'Overview'),
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
    '/calendar': t('shell.nav.calendar', 'Calendar'),
    '/my-tasks': t('shell.nav.myTasks', 'My Tasks'),
    '/views': t('shell.rail.myViews', 'My Views'),
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
  const groupLabels: Record<NavigationGroup, string> = {
    'My work': t('shell.rail.group.workforce', 'My work'),
    Delivery: t('shell.rail.group.delivery', 'Delivery'),
    Sales: t('shell.rail.group.crm', 'Sales'),
    Finance: t('shell.rail.group.finance', 'Finance'),
  };
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

  // #1834: hovering, focusing or pressing a rail link starts the destination's
  // route chunk downloading BEFORE the click, so navigation pays only for the
  // data. Container-level (focus via capture) covers every link variant —
  // NavLink, Link, views, administration — without touching each one.
  const preloadFromEvent = (event: React.PointerEvent<HTMLElement> | React.FocusEvent<HTMLElement>) => {
    const href = (event.target as HTMLElement).closest('a')?.getAttribute('href');
    if (href) onPreloadHref?.(href);
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
        <span className="text-group font-bold tracking-[-0.01em]">PMO Portal{/* i18n-exempt: PMO brand name stays verbatim */}</span>
      </div>

      <nav
        aria-label={t('shell.rail.primaryNavigation', 'Primary navigation')}
        className="flex min-h-0 flex-1 flex-col"
        onPointerOver={preloadFromEvent}
        onPointerDown={preloadFromEvent}
        onFocusCapture={preloadFromEvent}
      >
        <div className="relative min-h-0 flex-1">
          <div ref={scrollRegionRef} data-rail-scroll-region className="min-h-0 h-full overflow-y-auto p-2.5">
            {items.filter((item) => !item.group).map((item) => (
              <React.Fragment key={item.to}>
                {renderItem(item)}
                {item.to === '/views' && myViewsItems.length > 0 && (
                  <div role="group" className="mb-2 border-l border-border pl-8" aria-label={t('shell.rail.myViews', 'My Views')}>
                    {myViewsItems.map((view) => (
                      <NavLink
                        key={view.id}
                        to={`/views/${view.id}`}
                        onClick={onNavigate}
                        className={({ isActive }: { isActive: boolean }) =>
                          cn(
                            'touch-target flex min-h-11 w-full items-center rounded-md px-2 text-control',
                            isActive ? 'bg-nav-selected-surface font-semibold text-nav-active-text' : 'text-foreground hover:bg-surface-hover',
                          )
                        }
                      >
                        <span className="break-words">{view.name}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </React.Fragment>
            ))}
            {GROUP_ORDER.map((group) => {
              const groupItems = items.filter((i) => i.group === group);
              if (groupItems.length === 0) return null;
              const expanded = group === currentGroup || !collapsedGroups.has(group);
              const groupId = `${railId}-group-${group.toLowerCase().replaceAll(' ', '-')}`;
              return (
                <div key={group} role="group" aria-label={groupLabels[group]}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-disabled={group === currentGroup || undefined}
                    aria-controls={groupId}
                    onClick={() => toggleGroup(group)}
                    className={cn(
                      'touch-target flex min-h-11 w-full items-center gap-2 rounded-md px-2.5 text-left text-control font-normal text-muted-foreground hover:bg-surface-hover',
                      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-disabled:hover:bg-transparent',
                    )}
                  >
                    <Icon name="chev" className={cn('transition-transform', expanded && 'rotate-90')} />
                    <span>{groupLabels[group]}</span>
                  </button>
                  <div id={groupId} hidden={!expanded}>
                    {groupItems.map(renderItem)}
                  </div>
                </div>
              );
            })}
          </div>
          {hasScrollCue && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-2.5 bottom-0 h-6 bg-gradient-to-t from-[hsl(var(--surface-panel))] to-transparent" />
          )}
        </div>
      </nav>

      {/* FR-AP-005 / AC-AP-004: "Assistant" toggle — flag-gated, visible to ALL roles.
          Not a NavLink (routes nowhere) — a <button> with aria-pressed (toggle
          semantics). Placed above the Administration footer. */}
      {agentAssistantEnabled && (
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
