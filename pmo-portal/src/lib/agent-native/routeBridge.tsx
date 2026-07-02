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
 * Map a PMO navigation command to a React Router path.
 *
 * Returns null for unsupported commands.
 */
export function mapCommandToPath(command: PmoNavigationCommand): string | null {
  const { view, recordId, tab } = command;

  switch (view) {
    case 'projects':
      if (recordId) {
        if (tab) {
          return `/projects/${recordId}/${tab}`;
        }
        return `/projects/${recordId}`;
      }
      return '/projects';

    case 'sales-pipeline':
    case 'sales':
      return '/sales';

    case 'companies':
      if (recordId) {
        return `/companies/${recordId}`;
      }
      return '/companies';

    case 'procurement':
      if (recordId) {
        if (tab) {
          return `/procurement/${recordId}/${tab}`;
        }
        return `/procurement/${recordId}`;
      }
      return '/procurement';

    case 'contacts':
      if (recordId) {
        return `/contacts/${recordId}`;
      }
      return '/contacts';

    case 'incidents':
      if (recordId) {
        return `/incidents/${recordId}`;
      }
      return '/incidents';

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
      if (recordId) {
        return `/views/${recordId}`;
      }
      return '/views';

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