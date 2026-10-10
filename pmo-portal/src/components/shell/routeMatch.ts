import { matchPath } from 'react-router';
import type { IconName } from '@/src/components/ui/icons';
import type { BreadcrumbPart } from './Breadcrumb';
import { projectStatusGroup, type ProjectStatusGroup } from '@/src/lib/db/projectTransitions';
import type { RunContext } from '@/src/lib/agent/runtime/port';
import type { ListReturnNavigation } from '@/src/lib/listReturnContext';
import { UserRole } from '../../../types';

export interface ModuleDef {
  module: string;
  icon: IconName;
  label: string;
  /** Index route path. */
  path: string;
  /** Detail route pattern (record drill) + the param name carrying the id. */
  detail?: { pattern: string; param: string };
  /**
   * Roles that may navigate to this module (mirrors Rail.tsx ALL_ITEMS.roles).
   * Undefined = visible to all authenticated users (e.g. Dashboard).
   * AC-W3-N3: used by `modulesForRole` to filter the ⌘K Navigate group so it
   * matches the rail — a denied role never sees a Navigate item for a hidden module.
   */
  roles?: UserRole[];
  /** Canonical shell copy key shared by rail, palette, and breadcrumbs. */
  labelKey?: string;
}

/** The module IA — the index + detail routes the rail and ⌘K palette read. */
export const MODULES: ModuleDef[] = [
  // Dashboard: every authenticated role (no roles restriction = all).
  { module: 'dashboard', icon: 'dashboard', label: 'Dashboard', path: '/' },
  {
    module: 'sales',
    icon: 'pipeline',
    label: 'Sales Pipeline',
    path: '/sales',
    detail: { pattern: '/sales/:opportunityId', param: 'opportunityId' },
    // Mirror Rail: Exec·PM·Finance·Admin (Engineer has no Sales nav — rbac-visibility §C).
    roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin],
  },
  {
    module: 'procurement',
    icon: 'procurement',
    label: 'Procurement',
    path: '/procurement',
    detail: { pattern: '/procurement/:procurementId', param: 'procurementId' },
    // Mirror Rail: Exec·PM·Finance·Admin (Engineer has no Procurement nav — rbac-visibility §E).
    roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin],
  },
  {
    module: 'projects',
    icon: 'projects',
    label: 'Projects',
    path: '/projects',
    detail: { pattern: '/projects/:projectId', param: 'projectId' },
    // Projects: all roles (every role has the Projects nav item — rbac-visibility §B).
  },
  {
    module: 'timesheets',
    icon: 'clock',
    label: 'Timesheets',
    path: '/timesheets',
    // Mirror Rail: Exec·PM·Engineer·Admin (Finance excluded from Workforce surface).
    roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Engineer, UserRole.Admin],
  },
  // B-7 (AC-W2-IA-002): Companies + Incidents are full CRUD pages — promoted to MODULES so the
  // breadcrumb resolves via the module path and ⌘K Navigate includes them.
  {
    module: 'companies',
    icon: 'companies',
    label: 'Companies',
    path: '/companies',
    // CW-4b: /companies/:id is a routable detail page (retires the drawer-as-record) — the detail
    // pattern makes the breadcrumb drill [Companies > <record>] and lets ⌘K open one.
    detail: { pattern: '/companies/:companyId', param: 'companyId' },
    // Mirror Rail: Exec·PM·Finance·Admin (Engineer has no Companies nav — rbac-visibility §D).
    roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin],
  },
  {
    module: 'vendors',
    icon: 'companies',
    label: 'Vendors',
    labelKey: 'shell.nav.vendors',
    path: '/companies?type=Vendor',
    roles: [UserRole.ProjectManager, UserRole.Finance, UserRole.Admin],
  },
  {
    module: 'contacts',
    icon: 'contacts',
    label: 'Contacts',
    path: '/contacts',
    // CW-4b: /contacts/:id is a routable detail page (retires the drawer-as-record) — the detail
    // pattern makes the breadcrumb drill [Contacts > <record>] and lets ⌘K open one.
    detail: { pattern: '/contacts/:contactId', param: 'contactId' },
    // Mirror Rail: Exec·PM·Finance·Admin (Engineer has no CRM nav — master-data, like Companies).
    roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin],
  },
  {
    module: 'incidents',
    icon: 'alert',
    label: 'Incidents',
    path: '/incidents',
    // CW-4a: /incidents/:id is a routable detail page (fixes the Incidents dead-end) — the
    // detail pattern makes the breadcrumb drill [Incidents > <record>] and lets ⌘K open one.
    detail: { pattern: '/incidents/:incidentId', param: 'incidentId' },
    // Incidents: visible to every role (any member may file — rbac-visibility §A/§G).
  },
  // #526: Meetings — visible to EVERY role (any member may minute a meeting, OD-MTG-1; reads are
  // RLS-scoped to attendance ∪ author ∪ grant ∪ Admin, so the nav item is safe for all).
  {
    module: 'meetings',
    icon: 'cal',
    label: 'Meetings',
    path: '/meetings',
    detail: { pattern: '/meetings/:meetingId', param: 'meetingId' },
  },
  // #775: Expenses — every role (own claims); RLS scopes reads.
  { module: 'expenses', icon: 'expenses', label: 'Expenses', labelKey: 'shell.nav.expenses', path: '/expenses', detail: { pattern: '/expenses/:claimId', param: 'claimId' } },
  // UXS-007: My Tasks is the assignee-scoped personal doorway for PMs, Engineers and Admins.
  // Project-level Tasks remain available for oversight; Executive navigation is unchanged.
  {
    module: 'my-tasks',
    icon: 'tasks',
    label: 'My Tasks',
    labelKey: 'shell.nav.myTasks',
    path: '/my-tasks',
    roles: [UserRole.ProjectManager, UserRole.Engineer, UserRole.Admin],
  },
  // Fix #7 (AC-FIX7-CMDK-*): Approvals — promoted from PLACEHOLDER_TITLES to MODULES
  // so it appears in the ⌘K Navigate group for roles that can approve (mirrors Rail).
  // Finance approves procurement; Exec·PM·Admin approve timesheets. Engineer stays OUT.
  {
    module: 'approvals',
    icon: 'approvals',
    label: 'Approvals',
    path: '/approvals',
    roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin],
  },
  // Administration: Exec·Admin (shown in Rail's foot section for those roles only).
  {
    module: 'administration',
    icon: 'admin',
    label: 'Administration',
    path: '/administration',
    roles: [UserRole.Executive, UserRole.Admin],
  },
];

/**
 * Returns the subset of MODULES visible to the given role (AC-W3-N3 + AC-W3-N4).
 *
 * Modules with no `roles` array are visible to all authenticated users (e.g. Dashboard,
 * Projects, Incidents). Modules with a `roles` array are visible only to roles in that list.
 *
 * Used by the ⌘K palette's Navigate group so its items match the rail — a denied role
 * never sees a Navigate item for a module the rail hides from them.
 */
export function modulesForRole(role: UserRole): ModuleDef[] {
  return MODULES.filter((m) => !m.roles || m.roles.includes(role));
}

/**
 * Like `modulesForRole`, but additionally exposes the Administration module to a REAL platform
 * Operator regardless of their base role (AC-ADMIA-002).
 *
 * An authenticated Engineer who is a server-confirmed Operator can open `/administration` by URL
 * but could not discover it in the ⌘K Navigate group. `isOperator` MUST be the settled
 * `useIsOperator()` projection — never an effective/preview role — so a plain non-Operator
 * Engineer still never sees it, and a role already granted Administration (Executive/Admin) is
 * not duplicated. Keeps ⌘K aligned with the rail's real-Operator Administration footer.
 */
export function modulesForRoleWithOperator(role: UserRole, isOperator: boolean): ModuleDef[] {
  const base = modulesForRole(role);
  if (!isOperator || base.some((m) => m.module === 'administration')) return base;
  const administration = MODULES.find((m) => m.module === 'administration');
  return administration ? [...base, administration] : base;
}

/**
 * C5 — placeholder route titles. These routes are intentionally NOT registered
 * as modules (they have no rail entry / ⌘K target yet), so a URL-derived
 * breadcrumb has no module to resolve and would otherwise fall back to
 * "Dashboard". This map is the single source of their page title, kept in sync
 * with the placeholder `<Route>` titles in App.tsx.
 */
export const PLACEHOLDER_TITLES: Record<string, string> = {
  // Profile & preferences is a directly-routable personal page (account menu entry); keep its
  // route breadcrumb registered here (AC-ACCT-001).
  '/settings/profile': 'Profile & preferences',
  // /tasks + /work-orders routes removed — see App.tsx (Tasks live in the project tab).
  // /companies + /incidents promoted to MODULES (B-7, AC-W2-IA-002) — no longer placeholders.
  // /approvals promoted to MODULES (fix #7) — breadcrumb now resolves via the module, not here.
  // B-10 (AC-W2-IA-005): /reports stays a route (deep-links resolve) but is not a rail item.
  '/reports': 'Reports',
  '/administration': 'Administration',
  // My Tasks page (B-1) has its own nav item but no detail route — register so the breadcrumb
  // resolves "My Tasks" on direct deep-link (not "Dashboard").
  '/my-tasks': 'My Tasks',
  // /views index (OD-4, I4) now ships as MyViewsPage but is not a rail module, so its breadcrumb
  // must resolve here — otherwise it falls through to the "Not found" label (owner report 2026-07-14).
  '/views': 'My Views',
  // M365 connection-model (D2): the personal-connect surface. Not a rail MODULE (no detail route,
  // no ⌘K record drill) but it HAS a rail entry, so register the title here so the breadcrumb
  // resolves "My integrations" on direct deep-link rather than falling through to "Not found".
  // The label agrees with the rail + H1 (AC-ADMIA-006) and stays distinct from the ORGANIZATION
  // surface, whose label is ADMINISTRATION_SECTION_LABELS.integrations ("Organization integrations").
  '/integrations': 'My integrations',
  // #781 (AC-FIN-002): the three Finance lists are routable pages (deep-links resolve) but not
  // shell modules — register each title so the breadcrumb resolves it instead of falling through
  // to "Not found". The i18n keys (shell.nav.*) already ship and mirror the rail labels.
  '/sales-invoices': 'Sales Invoices',
  '/incoming-payments': 'Incoming Payments',
  '/revenue-by-project': 'Revenue by Project',
};

/** Canonical Administration child routes and their route-derived breadcrumb labels (English source). */
export const ADMINISTRATION_SECTION_LABELS = {
  users: 'Users',
  integrations: 'Organization integrations',
  accounting: 'Accounting setup',
  projects: 'Project setup',
  credits: 'Credits',
  usage: 'Usage',
  features: 'Features',
} as const;

/**
 * The ONE authoritative label mapping for the Administration sections, keyed to the shell's i18n
 * catalogue (`admin.nav.*`). The breadcrumb carries these keys so the rendered crumb agrees with
 * the section nav and embedded headings in every locale; `ADMINISTRATION_SECTION_LABELS` above is
 * the English source/fallback (i18next-parser convention), never a second translation.
 */
export const ADMINISTRATION_SECTION_I18N_KEY: Record<
  keyof typeof ADMINISTRATION_SECTION_LABELS,
  string
> = {
  users: 'admin.nav.users',
  integrations: 'admin.nav.integrations',
  accounting: 'admin.nav.accounting',
  projects: 'admin.nav.projects',
  credits: 'admin.nav.credits',
  usage: 'admin.nav.usage',
  features: 'admin.nav.features',
};

const administrationBreadcrumbForPath = (
  pathname: string,
  navigate?: (path: string) => void,
): BreadcrumbPart[] | undefined => {
  const prefix = '/administration/';
  if (!pathname.startsWith(prefix)) return undefined;

  const section = pathname.slice(prefix.length);
  const label =
    ADMINISTRATION_SECTION_LABELS[section as keyof typeof ADMINISTRATION_SECTION_LABELS];
  const parentLabel = 'Administration';
  const sectionLabel = label ?? 'Users';
  const sectionKey =
    ADMINISTRATION_SECTION_I18N_KEY[section as keyof typeof ADMINISTRATION_SECTION_I18N_KEY] ??
    ADMINISTRATION_SECTION_I18N_KEY.users;
  return [
    {
      label: parentLabel,
      i18nKey: 'shell.nav.administration',
      href: '/administration/users',
      onClick: () => navigate?.('/administration/users'),
    },
    { label: sectionLabel, i18nKey: sectionKey },
  ];
};

/**
 * Route-derived top-bar breadcrumb (URL is the single source of truth — the
 * existing invariant, preserved without the tab-state machine).
 *
 * - Module index route (`/projects`)  → a single current crumb `[Projects]`
 *   (AC-NAV-003).
 * - Detail route (`/projects/:id`, incl. the `/budget` deep-link variant)
 *   → `[Projects (link) > <record>]`, where the module segment navigates to its
 *   index via the passed-in `navigate` fn so the helper stays pure (AC-NAV-004).
 *   The record segment uses `recordLabel` once the cached list resolves it; on a
 *   cold deep-link while the list is still loading it shows a neutral "Loading…"
 *   — never the raw URL id (fixes the M3/M4 UUID leak). Once the list has
 *   RESOLVED but the record is still absent (a genuine not-found, e.g. a bad id),
 *   it resolves to a friendly "Not found" label instead of a perpetual
 *   "Loading…" (item I) — driven by the `recordResolved` flag.
 * - Placeholder route (`/companies`, `/tasks`, …) → its own page label, not
 *   "Dashboard" (AC-NAV-005), via the `PLACEHOLDER_TITLES` map.
 * - Unknown route → a single Dashboard crumb (the `*` route renders the
 *   dashboard).
 *
 * `navigate` is optional so the helper is testable in isolation; when omitted
 * the module-segment crumb carries a safe no-op `onClick` so it still renders as
 * a link. `recordResolved` defaults to false (still loading) so callers that
 * don't pass it keep the prior cold-deep-link "Loading…" behavior.
 *
 * Model B (ADR-0020, AC-IXD-PROJ-005): `/projects/:id` is the ONE canonical detail route for
 * every project/opportunity, so its breadcrumb ancestry follows the record's STAGE rather than
 * the URL prefix — a `pipeline | lost` record reads `Sales Pipeline > <name>` (and links back
 * to `/sales`), an `onHand | internal` record reads `Projects > <name>`. The caller resolves
 * the record's status group from the cached lists (`recordStatusForPath`) and threads it in via
 * `recordStatusGroup`; when omitted it defaults to the module's own ancestry (back-compat).
 */
export function breadcrumbForPath(
  pathname: string,
  recordLabel?: string,
  navigate?: (target: string | ListReturnNavigation) => void,
  recordResolved = false,
  // FIX-2: the stage group is no longer used to change the breadcrumb ancestry for
  // /projects/:id — that ancestry is always "Projects" so breadcrumb + rail agree.
  // The param is kept in the signature so App.tsx callers don't need updating.
  _recordStatusGroup?: ProjectStatusGroup,
  /** Same-owner return descriptor, minted only by `contextualListReturnNavigation`. */
  contextualParent?: ListReturnNavigation,
): BreadcrumbPart[] {
  const administrationBreadcrumb = administrationBreadcrumbForPath(pathname, navigate);
  if (administrationBreadcrumb) return administrationBreadcrumb;

  // Placeholder routes win first — they are not tracked modules, so they would
  // otherwise fall through to the Dashboard fallback (AC-NAV-005).
  const placeholderTitle = PLACEHOLDER_TITLES[pathname];
  if (placeholderTitle) {
    // Placeholder routes that own a REAL i18n key carry it so the crumb agrees with the rail's
    // own locally-labelled entries in every locale; all other placeholder routes keep their plain
    // (pure) English crumb. #781 (AC-FIN-002): the three Finance routes map to the existing
    // `shell.nav.salesInvoices` / `shell.nav.incomingPayments` / `shell.nav.revenueByProject` keys
    // the Finance rail already uses.
    const PLACEHOLDER_I18N_KEY: Record<string, string> = {
      '/administration': 'shell.nav.administration',
      '/integrations': 'shell.nav.integrations',
      '/sales-invoices': 'shell.nav.salesInvoices',
      '/incoming-payments': 'shell.nav.incomingPayments',
      '/revenue-by-project': 'shell.nav.revenueByProject',
      '/my-tasks': 'shell.nav.myTasks',
    };
    const i18nKey = PLACEHOLDER_I18N_KEY[pathname];
    return i18nKey
      ? [{ label: placeholderTitle, i18nKey }]
      : [{ label: placeholderTitle }];
  }

  // User-view detail route → [My Views (link to /) > <view.name>] (OD-4, FR-VR-053)
  // OD-4 note: 'My Views' currently links to '/' (Dashboard) because there is no
  // /views index route yet. The label is accurate (the section IS called My Views) but
  // the destination is unexpected for a screen-reader user — WCAG 2.4.6 (descriptive
  // link labels). To mitigate the mismatch the crumb carries an aria-label spelling out
  // the destination, consistent with option (a) of OD-4. When a /views index route ships
  // (I4/I5), update onClick to navigate('/views') and drop the aria-label override.
  if (pathname.startsWith('/views/')) {
    const viewCrumb = recordLabel || (recordResolved ? 'Not found' : 'Loading…');
    return [
      {
        label: 'My Views',
        href: '/',
        onClick: () => navigate?.('/'),
        ariaLabel: 'My Views — back to Dashboard',
      },
      { label: viewCrumb },
    ];
  }

  for (const m of MODULES) {
    // Detail route → [module link > record]. The dashboard has no detail route.
    if (m.detail) {
      const indexMatch = matchPath({ path: m.path, end: true }, pathname);
      // A path under the module index with a further segment is a detail route
      // (covers `/projects/:id` and the `/projects/:id/budget` deep-link).
      const isDetail = !indexMatch && pathname.startsWith(`${m.path}/`);
      if (isDetail) {
        // recordLabel resolved → the record name; still loading → "Loading…";
        // resolved-but-absent (bad id / deleted) → "Not found", never a
        // perpetual "Loading…" once the error card has rendered (item I).
        const recordCrumb = recordLabel || (recordResolved ? 'Not found' : 'Loading…');
        // FIX-2 (coherence): /projects/:id ALWAYS roots at "Projects", regardless of the
        // record's pipeline status. "Sales Pipeline" is a filter lens, not the record's home —
        // the breadcrumb and rail must agree: the rail highlights "Projects" for /projects/:id,
        // so the breadcrumb must do the same. The pipeline status cue stays on the status pill
        // and stepper, not the breadcrumb ancestry.
        const parentLabel = m.label;
        const parentPath = m.path;
        const parentKey = m.labelKey;
        return [
          {
            label: parentLabel,
            ...(parentKey ? { i18nKey: parentKey } : {}),
            // App passes a descriptor for every adopting list's detail route: the validated source
            // list URL, or the owning index when there is no usable context, with cleaned router
            // state (a one-shot scroll restore only when an offset was captured). Other modules'
            // detail routes have no descriptor and navigate to their bare index path.
            href: contextualParent?.path ?? parentPath,
            onClick: () => navigate?.(contextualParent ?? parentPath),
          },
          { label: recordCrumb },
        ];
      }
    }
    // Index route → a single current crumb.
    if (matchPath({ path: m.path, end: true }, pathname)) {
      return [{ label: m.label, ...(m.labelKey ? { i18nKey: m.labelKey } : {}) }];
    }
  }

  // Unknown route → "Not found" (C-MIN-4: the `*` route renders the 404 page, not the dashboard).
  return [{ label: 'Not found' }];
}

/** Cached index lists the breadcrumb reads to resolve a detail route's name. */
export interface RecordLists {
  projects?: { id: string; name: string }[];
  opportunities?: { id: string; name: string }[];
  procurements?: { id: string; title: string }[];
  /** CW-4a: incidents — the record "name" is its `type` (there is no title column). */
  incidents?: { id: string; type: string }[];
  /** CW-4b: companies — the record name is its `name`. */
  companies?: { id: string; name: string }[];
  /** CW-4b: contacts — the record name is its `full_name`. */
  contacts?: { id: string; full_name: string }[];
  /** #526: meetings — the record name is its `title`. */
  meetings?: { id: string; title: string }[];
  /** Expense claims resolve from the detail query cache; no additional list read. */
  expenses?: { id: string; claim_number?: string | null; title?: string | null }[];
  /** I3: user views — the record "name" is view.name, resolved from the useUserViews() cache. */
  userViews?: { id: string; name: string }[];
}

/** Cached lists carrying a status (for stage-aware breadcrumb ancestry, Model B). */
export interface RecordStatusLists {
  /** The active Projects partition (on-hand ∪ internal). */
  projects?: { id: string; status: string }[];
  /** The Sales Pipeline partition (pre-win + lost) — wins the lookup when ids overlap. */
  opportunities?: { id: string; status: string }[];
}

/** Extract a `/projects/:id` id (dropping any trailing `/budget`), else undefined. */
function projectIdFromPath(pathname: string): string | undefined {
  if (!pathname.startsWith('/projects/')) return undefined;
  return pathname.slice('/projects/'.length).split('/')[0] || undefined;
}

/**
 * Resolves a `/projects/:id` route's status from the cached lists (AC-IXD-PROJ-005). The
 * pipeline (opportunities) list takes precedence: under Model B the active projects list no
 * longer holds pre-win/lost rows, so a pipeline record is found ONLY in the pipeline cache, and
 * preferring it keeps the stage correct even during a brief post-win cache overlap. Returns the
 * raw status string (the caller maps it through `projectStatusGroup`), or undefined when the
 * path is not a project detail route or the id is not yet cached.
 */
export function recordStatusForPath(
  pathname: string,
  lists: RecordStatusLists,
): string | undefined {
  const id = projectIdFromPath(pathname);
  if (!id) return undefined;
  const fromPipeline = lists.opportunities?.find((o) => o.id === id)?.status;
  if (fromPipeline) return fromPipeline;
  return lists.projects?.find((p) => p.id === id)?.status;
}

/**
 * The `ProjectStatusGroup` for a `/projects/:id` route resolved from the cached lists, or
 * undefined when unresolved. A thin convenience over `recordStatusForPath` + `projectStatusGroup`
 * for App.tsx to thread into `breadcrumbForPath` (Model B, AC-IXD-PROJ-005).
 */
export function recordStatusGroupForPath(
  pathname: string,
  lists: RecordStatusLists,
): ProjectStatusGroup | undefined {
  const status = recordStatusForPath(pathname, lists);
  return status ? projectStatusGroup(status as never) : undefined;
}

/**
 * Maps a (pathname, statusGroup) pair to the rail's active-item override (Option A, Task D).
 *
 * Returns:
 *  - 'salesPipeline' when on a `/projects/:id` detail and the record is pipeline or lost
 *  - 'projects'      when on a `/projects/:id` detail and the record is onHand or internal
 *  - null            when the caches are still pending (statusGroup = undefined) OR when the
 *                    current route is not a `/projects/:id` detail — in both cases the Rail
 *                    falls back to its URL-based NavLink `isActive` logic.
 *
 * Only `/projects/<id>` (with any optional trailing `/tab`) qualifies — the index `/projects`
 * never triggers the override so the Projects nav item stays active there as usual.
 */
export function deriveRailActiveOverride(
  pathname: string,
  statusGroup: ProjectStatusGroup | undefined,
): 'salesPipeline' | 'projects' | null {
  // Must be a /projects/:id detail route (not the index).
  if (!pathname.startsWith('/projects/')) return null;
  const segment = pathname.slice('/projects/'.length).split('/')[0];
  if (!segment) return null; // bare /projects/ with no id

  // Caches still resolving → no override; let NavLink URL-matching stand.
  if (!statusGroup) return null;

  if (statusGroup === 'pipeline' || statusGroup === 'lost') return 'salesPipeline';
  return 'projects'; // onHand | internal
}

/**
 * Resolves a detail route's record name from the cached index lists (the same
 * lists the ⌘K palette indexes) — the breadcrumb's `recordLabel` source. Pure:
 * it reads the passed-in lists, never a query. Returns the human title, or
 * `undefined` when the path is not a detail route or the record is not yet
 * cached (a cold deep-link) — never the raw URL id (fixes M3/M4).
 */
export function recordLabelForPath(
  pathname: string,
  lists: RecordLists,
): string | undefined {
  const idFrom = (prefix: string): string | undefined => {
    if (!pathname.startsWith(`${prefix}/`)) return undefined;
    // segment after the module prefix, dropping any trailing `/budget` etc.
    return pathname.slice(prefix.length + 1).split('/')[0] || undefined;
  };

  const projectId = idFrom('/projects');
  if (projectId) {
    // Model B (ADR-0020): /projects/:id is the canonical route for EVERY stage. An on-hand /
    // internal record is in the active projects list; a pre-win / lost record is in the
    // pipeline (opportunities) list only — fall back to it so the crumb resolves either way.
    return (
      lists.projects?.find((p) => p.id === projectId)?.name ??
      lists.opportunities?.find((o) => o.id === projectId)?.name
    );
  }

  const salesId = idFrom('/sales');
  if (salesId) return lists.opportunities?.find((o) => o.id === salesId)?.name;

  const procurementId = idFrom('/procurement');
  if (procurementId) return lists.procurements?.find((p) => p.id === procurementId)?.title;

  // CW-4a: an incident's human label is its `type` (no title column).
  const incidentId = idFrom('/incidents');
  if (incidentId) return lists.incidents?.find((i) => i.id === incidentId)?.type;

  // CW-4b: a company's label is its `name`, a contact's is its `full_name`.
  const companyId = idFrom('/companies');
  if (companyId) return lists.companies?.find((c) => c.id === companyId)?.name;

  const contactId = idFrom('/contacts');
  if (contactId) return lists.contacts?.find((c) => c.id === contactId)?.full_name;

  // #526: a meeting's label is its `title`.
  const meetingId = idFrom('/meetings');
  if (meetingId) return lists.meetings?.find((m) => m.id === meetingId)?.title;

  // Expense detail breadcrumb uses its human-facing claim number, then its title.
  const expenseId = idFrom('/expenses');
  if (expenseId) {
    const claim = lists.expenses?.find((item) => item.id === expenseId);
    return claim?.claim_number || claim?.title || undefined;
  }

  // I3: user views — resolve view name from the useUserViews() cache (FR-VR-082).
  const viewId = idFrom('/views');
  if (viewId) return lists.userViews?.find((v) => v.id === viewId)?.name;

  return undefined;
}

/**
 * Resolves the agent's route entity from the same shell-level caches that make
 * the breadcrumb visible. This lets an immediate Assistant turn carry context
 * while the lazy detail-page chunk is still showing its loading fallback.
 */
export function agentEntityForPath(
  pathname: string,
  lists: RecordLists,
): RunContext['entity'] {
  const routes: Array<{ prefix: string; type: string }> = [
    { prefix: '/projects', type: 'project' },
    { prefix: '/procurement', type: 'procurement_case' },
    { prefix: '/companies', type: 'company' },
    { prefix: '/contacts', type: 'contact' },
  ];

  for (const route of routes) {
    if (!pathname.startsWith(`${route.prefix}/`)) continue;
    const id = pathname.slice(route.prefix.length + 1).split('/')[0];
    const label = recordLabelForPath(pathname, lists);
    // The route identity is synchronous and sufficient for server-side
    // caller-JWT/RLS grounding. Use the opaque id as an invisible temporary
    // label until the authorized cache supplies the human label.
    if (id) return { type: route.type, id, label: label ?? id };
  }

  return undefined;
}
