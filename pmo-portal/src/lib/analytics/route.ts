export interface RouteAnalytics {
  route: string;
  module: string;
  tab_id?: string;
}

const stripQuery = (path: string) => path.split('?')[0] || '/';

export function routeAnalyticsForPath(path: string): RouteAnalytics {
  const clean = stripQuery(path);
  const parts = clean.split('/').filter(Boolean);

  if (clean === '/') return { route: '/', module: 'dashboard' };
  if (parts[0] === 'login') return { route: '/login', module: 'auth' };

  if (parts[0] === 'projects' && parts.length >= 3) {
    return { route: '/projects/:projectId/:tab', module: 'projects', tab_id: parts[2] };
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

  if (parts[0]) return { route: `/${parts[0]}`, module: parts[0] };

  return { route: '/', module: 'dashboard' };
}
