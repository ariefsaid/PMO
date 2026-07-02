/**
 * E4 Route Bridge (AC-411) — GREEN phase
 *
 * Wires agent navigation commands to PMO (react-router navigate).
 * Uses `useAgentRouteState` from `@agent-native/core/client`.
 *
 * Spec: `docs/plans/2026-07-01-agent-native-adoption-epic.md` E4
 */

import { useNavigate } from 'react-router-dom';
import { useAgentRouteState } from '@agent-native/core/client';
import { isFeatureEnabled } from '@/src/lib/features';

/**
 * PMO navigation command shape from the agent.
 *
 * The agent can issue commands like:
 * - { view: 'projects' } → /projects
 * - { view: 'projects', recordId: 'proj_123' } → /projects/proj_123
 * - { view: 'projects', recordId: 'proj_123', tab: 'tasks' } → /projects/proj_123/tasks
 */
export interface PmoNavigationCommand {
  /** Target view name */
  view: string;
  /** Optional record ID for detail pages */
  recordId?: string;
  /** Optional tab for tabbed routes */
  tab?: string;
}

export interface PmoRouteBridgeOptions {
  enabled?: boolean;
}

/**
 * Tab allow-list per route (AC-411 security).
 *
 * Only the tabs each route ACTUALLY renders. A `tab` is honored ONLY when the
 * view is present here AND the tab is in its set; everything else is rejected.
 * Mirrors `pages/project-detail/ProjectDetail.tsx` (PTab) and
 * `pages/ProcurementDetails.tsx` (PROC_TAB_VALUES).
 */
const TAB_ALLOWLIST: Readonly<Record<string, ReadonlySet<string>>> = {
  projects: new Set(['overview', 'budget', 'procurement', 'tasks', 'documents']),
  procurement: new Set(['overview', 'items', 'documents', 'quotes']),
};

/**
 * Validate a single dynamic path segment (AC-411 security).
 *
 * Reject anything that could escape its segment or open a query/fragment:
 * `/`, `?`, `#`, and the RFC-3986 dot-segments `.` / `..`. A rejected segment
 * makes the whole command a no-op (mapCommandToPath → null → no navigation).
 */
function isValidDynamicSegment(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.includes('/') || value.includes('?') || value.includes('#')) return false;
  if (value === '.' || value === '..') return false;
  return true;
}

/**
 * Resolve a `tab` for a view, or signal rejection.
 *
 * Returns the encoded tab when it is a real tab of a real tabbed route,
 * `undefined` when no tab was requested, or `null` when the tab is invalid
 * (route has no tabs, or the tab isn't in the route's allow-list).
 */
function resolveTab(
  view: string,
  tab: string | undefined,
): string | undefined | null {
  if (tab === undefined) return undefined;
  const allow = TAB_ALLOWLIST[view];
  if (!allow || !allow.has(tab)) return null;
  return encodeURIComponent(tab);
}

/**
 * Map a PMO navigation command to a React Router path.
 *
 * Returns null for unsupported OR malformed commands. The framework's
 * `onCommand` treats a null path as a no-op (`if (!path) return;`), so a null
 * return means NO navigation. Dynamic segments are validated and encoded.
 */
export function mapCommandToPath(command: PmoNavigationCommand): string | null {
  const { view, recordId, tab } = command;

  // If a tab is present it must resolve to a real tab of a real tabbed route,
  // otherwise the whole command is a safe no-op (no navigation).
  const resolvedTab = resolveTab(view, tab);
  if (resolvedTab === null) {
    return null;
  }

  // Validate + encode the recordId once (shared by all detail routes).
  const encodedId = recordId === undefined ? undefined : isValidDynamicSegment(recordId) ? encodeURIComponent(recordId) : null;
  if (encodedId === null) {
    return null;
  }

  switch (view) {
    case 'projects':
      if (encodedId) {
        return resolvedTab !== undefined
          ? `/projects/${encodedId}/${resolvedTab}`
          : `/projects/${encodedId}`;
      }
      return '/projects';

    case 'sales-pipeline':
    case 'sales':
      return '/sales';

    case 'companies':
      return encodedId ? `/companies/${encodedId}` : '/companies';

    case 'procurement':
      if (encodedId) {
        return resolvedTab !== undefined
          ? `/procurement/${encodedId}/${resolvedTab}`
          : `/procurement/${encodedId}`;
      }
      return '/procurement';

    case 'contacts':
      return encodedId ? `/contacts/${encodedId}` : '/contacts';

    case 'incidents':
      return encodedId ? `/incidents/${encodedId}` : '/incidents';

    case 'my-tasks':
      return '/my-tasks';

    case 'timesheets':
      return '/timesheets';

    case 'approvals':
      return '/approvals';

    case 'reports':
      return '/reports';

    case 'administration':
    case 'admin':
      return '/administration';

    case 'views':
      return encodedId ? `/views/${encodedId}` : '/views';

    case 'home':
      return '/';

    default:
      // Unsupported view
      return null;
  }
}

/**
 * Hook that wires agent navigation commands to PMO routing.
 *
 * When enabled, it uses `useAgentRouteState` to:
 * 1. Expose PMO's current navigation state to the agent (via getNavigationState)
 * 2. Consume agent-authored navigation commands (via getCommandPath + onNavigate)
 *
 * @param options - Bridge configuration options
 */
export function usePmoRouteBridge(options: PmoRouteBridgeOptions = {}): void {
  const { enabled: optionsEnabled } = options;
  const navigate = useNavigate();

  // Check both local option and global feature flag
  const enabled = optionsEnabled !== false && isFeatureEnabled('agentNativeEmbed');

  useAgentRouteState<PmoNavigationCommand>({
    enabled,

    // Expose PMO's current navigation state to the agent
    getNavigationState: ({ pathname }) => {
      // Parse the current path to extract semantic state
      // This is a simplified version - in production you might want to include
      // query params, active filters, etc.
      if (pathname.startsWith('/projects/')) {
        const parts = pathname.split('/');
        return {
          view: 'projects',
          recordId: parts[2] || undefined,
          tab: parts[3] || undefined,
        };
      }

      if (pathname.startsWith('/companies/')) {
        const parts = pathname.split('/');
        return {
          view: 'companies',
          recordId: parts[2] || undefined,
        };
      }

      if (pathname.startsWith('/procurement/')) {
        const parts = pathname.split('/');
        return {
          view: 'procurement',
          recordId: parts[2] || undefined,
          tab: parts[3] || undefined,
        };
      }

      if (pathname.startsWith('/contacts/')) {
        const parts = pathname.split('/');
        return {
          view: 'contacts',
          recordId: parts[2] || undefined,
        };
      }

      if (pathname.startsWith('/incidents/')) {
        const parts = pathname.split('/');
        return {
          view: 'incidents',
          recordId: parts[2] || undefined,
        };
      }

      if (pathname.startsWith('/views/')) {
        const parts = pathname.split('/');
        return {
          view: 'views',
          recordId: parts[2] || undefined,
        };
      }

      // Map index pages to view names
      if (pathname === '/projects') return { view: 'projects' };
      if (pathname === '/companies') return { view: 'companies' };
      if (pathname === '/procurement') return { view: 'procurement' };
      if (pathname === '/contacts') return { view: 'contacts' };
      if (pathname === '/incidents') return { view: 'incidents' };
      if (pathname === '/sales') return { view: 'sales-pipeline' };
      if (pathname === '/my-tasks') return { view: 'my-tasks' };
      if (pathname === '/timesheets') return { view: 'timesheets' };
      if (pathname === '/approvals') return { view: 'approvals' };
      if (pathname === '/reports') return { view: 'reports' };
      if (pathname === '/administration') return { view: 'administration' };
      if (pathname === '/views') return { view: 'views' };
      if (pathname === '/') return { view: 'home' };

      return null;
    },

    // Convert agent command to PMO path
    getCommandPath: mapCommandToPath,

    // Navigate when a valid command is received
    onNavigate: (command, path) => {
      if (path) {
        navigate(path);
      }
    },
  });
}