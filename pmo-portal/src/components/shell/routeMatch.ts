import { matchPath } from 'react-router-dom';
import type { IconName } from '@/src/components/ui/icons';
import type { BreadcrumbPart } from './Breadcrumb';
import { projectStatusGroup, type ProjectStatusGroup } from '@/src/lib/db/projectTransitions';
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
}

/** The module IA — the index + detail routes the rail and ⌘K palette read. */
export const MODULES: ModuleDef[] = [
  // Dashboard: every authenticated role (no roles restriction = all).
  { module: 'dashboard', icon: 'grid', label: 'Dashboard', path: '/' },
  {
    module: 'sales',
    icon: 'pipe',
    label: 'Sales Pipeline',
    path: '/sales',
    detail: { pattern: '/sales/:opportunityId', param: 'opportunityId' },
    // Mirror Rail: Exec·PM·Finance·Admin (Engineer has no Sales nav — rbac-visibility §C).
    roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin],
  },
  {
    module: 'procurement',
    icon: 'cart',
    label: 'Procurement',
    path: '/procurement',
    detail: { pattern: '/procurement/:procurementId', param: 'procurementId' },
    // Mirror Rail: Exec·PM·Finance·Admin (Engineer has no Procurement nav — rbac-visibility §E).
    roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin],
  },
  {
    module: 'projects',
    icon: 'folder',
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
    icon: 'doc',
    label: 'Companies',
    path: '/companies',
    // CW-4b: /companies/:id is a routable detail page (retires the drawer-as-record) — the detail
    // pattern makes the breadcrumb drill [Companies > <record>] and lets ⌘K open one.
    detail: { pattern: '/companies/:companyId', param: 'companyId' },
    // Mirror Rail: Exec·PM·Finance·Admin (Engineer has no Companies nav — rbac-visibility §D).
    roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Admin],
  },
  {
    module: 'contacts',
    icon: 'doc',
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
  // AC-W3-N4: My Tasks — the IC's primary landing. Was in PLACEHOLDER_TITLES only (no ⌘K target).
  // Adding here makes it reachable via ⌘K Navigate for roles that have the nav item.
  // Mirror Rail: Engineer·Admin (B-1, AC-W2-IXD-001, OD-W2-4).
  {
    module: 'my-tasks',
    icon: 'check',
    label: 'My Tasks',
    path: '/my-tasks',
    roles: [UserRole.Engineer, UserRole.Admin],
  },
  // Fix #7 (AC-FIX7-CMDK-*): Approvals — promoted from PLACEHOLDER_TITLES to MODULES
  // so it appears in the ⌘K Navigate group for roles that can approve (mirrors Rail).
  // Finance approves procurement; Exec·PM·Admin approve timesheets. Engineer stays OUT.
  {
    module: 'approvals',
    icon: 'check',
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
 * C5 — placeholder route titles. These routes are intentionally NOT registered
 * as modules (they have no rail entry / ⌘K target yet), so a URL-derived
 * breadcrumb has no module to resolve and would otherwise fall back to
 * "Dashboard". This map is the single source of their page title, kept in sync
 * with the placeholder `<Route>` titles in App.tsx.
 */
export const PLACEHOLDER_TITLES: Record<string, string> = {
  // /tasks + /work-orders routes removed — see App.tsx (Tasks live in the project tab).
  // /companies + /incidents promoted to MODULES (B-7, AC-W2-IA-002) — no longer placeholders.
  // /approvals promoted to MODULES (fix #7) — breadcrumb now resolves via the module, not here.
  // B-10 (AC-W2-IA-005): /reports stays a route (deep-links resolve) but is not a rail item.
  '/reports': 'Reports',
  '/administration': 'Administration',
  // My Tasks page (B-1) has its own nav item but no detail route — register so the breadcrumb
  // resolves "My Tasks" on direct deep-link (not "Dashboard").
  '/my-tasks': 'My Tasks',
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
  navigate?: (path: string) => void,
  recordResolved = false,
  // FIX-2: the stage group is no longer used to change the breadcrumb ancestry for
  // /projects/:id — that ancestry is always "Projects" so breadcrumb + rail agree.
  // The param is kept in the signature so App.tsx callers don't need updating.
  _recordStatusGroup?: ProjectStatusGroup,
): BreadcrumbPart[] {
  // Placeholder routes win first — they are not tracked modules, so they would
  // otherwise fall through to the Dashboard fallback (AC-NAV-005).
  const placeholderTitle = PLACEHOLDER_TITLES[pathname];
  if (placeholderTitle) return [{ label: placeholderTitle }];

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
        return [
          { label: parentLabel, onClick: () => navigate?.(parentPath) },
          { label: recordCrumb },
        ];
      }
    }
    // Index route → a single current crumb.
    if (matchPath({ path: m.path, end: true }, pathname)) {
      return [{ label: m.label }];
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

  return undefined;
}
