/** Routes using the content-track breadcrumb frame; page bodies own their h1, scope and action slots. */
export function usesContentPageFramePath(pathname: string): boolean {
  const projectRecordRoute = /^\/projects\/[^/]+(?:\/[^/]+)?$/u.test(pathname) && pathname !== '/projects/new';
  const moneyOutRoute = pathname === '/procurement' || pathname.startsWith('/procurement/')
    || pathname === '/erp-purchases' || pathname === '/expenses' || pathname.startsWith('/expenses/');
  return pathname === '/' || pathname === '/projects' || projectRecordRoute
    || pathname === '/approvals' || pathname === '/timesheets' || moneyOutRoute
    || pathname === '/administration' || pathname.startsWith('/administration/') || pathname === '/integrations';
}

/** Parent label for routes that keep a named in-content return control on phones. */
export function contentPageFrameReturnKey(pathname: string): 'projects' | 'procurement' | 'expenses' | undefined {
  if (/^\/projects\/[^/]+(?:\/[^/]+)?$/u.test(pathname) && pathname !== '/projects/new') return 'projects';
  if (pathname === '/erp-purchases' || pathname === '/procurement/new'
    || /^\/procurement\/[^/]+(?:\/[^/]+)?$/u.test(pathname)) return 'procurement';
  if (pathname === '/expenses/new' || /^\/expenses\/[^/]+$/u.test(pathname)) return 'expenses';
  return undefined;
}
