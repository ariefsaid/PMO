export interface RouteAnalytics {
  route: string;
  module: string;
  tab_id?: string;
}

const stripQuery = (path: string) => path.split('?')[0] || '/';

/** Known safe top-level route segments. Anything else is "unknown". */
const KNOWN_TOP_LEVEL_SEGMENTS = new Set([
  'login', 'projects', 'procurement', 'sales', 'settings',
  'approvals', 'timesheets', 'companies', 'incidents', 'my-tasks', 'reports', 'administration',
]);

/** Safe tab pattern: lowercase alphanumeric + hyphens, no PII-like content. */
const SAFE_TAB_ID = /^[a-z][a-z0-9-]{0,62}$/;

export function routeAnalyticsForPath(path: string): RouteAnalytics {
  const clean = stripQuery(path);
  const parts = clean.split('/').filter(Boolean);

  if (clean === '/') return { route: '/', module: 'dashboard' };
  if (parts[0] === 'login') return { route: '/login', module: 'auth' };

  if (parts[0] === 'projects' && parts.length >= 3) {
    const tabId = SAFE_TAB_ID.test(parts[2]) ? parts[2] : 'unknown_tab';
    return { route: '/projects/:projectId/:tab', module: 'projects', tab_id: tabId };
  }
  if (parts[0] === 'projects' && parts.length === 2) {
    return { route: '/projects/:projectId', module: 'projects' };
  }
  if (parts[0] === 'projects') return { route: '/projects', module: 'projects' };

  if (parts[0] === 'procurement' && parts.length === 2) {
    return { route: '/procurement/:procurementId', module: 'procurement' };
  }
  if (parts[0] === 'procurement') return { route: '/procurement', module: 'procurement' };

  if (parts[0] === 'sales' && parts.length === 2) {
    return { route: '/sales/:opportunityId', module: 'sales' };
  }

  if (parts[0] && KNOWN_TOP_LEVEL_SEGMENTS.has(parts[0])) {
    return { route: `/${parts[0]}`, module: parts[0] };
  }

  return { route: '/unknown', module: 'unknown' };
}
