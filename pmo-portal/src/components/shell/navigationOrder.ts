/** Canonical navigation order shared by the rail and the search destination list. */
export const NAVIGATION_ORDER = [
  '/approvals', '/',
  '/sales', '/companies', '/contacts',
  '/projects', '/procurement', '/stock', '/equipment', '/companies?type=Vendor', '/incidents', '/meetings', '/calendar',
  '/finance', '/finance/receivables', '/finance/payables', '/finance/reports', '/finance/statements',
  '/timesheets', '/expenses', '/imprest', '/my-tasks', '/views',
  '/administration',
] as const;

const orderByPath = new Map<string, number>(NAVIGATION_ORDER.map((path, index) => [path, index]));

export function compareNavigationOrder(leftPath: string, rightPath: string): number {
  return (orderByPath.get(leftPath) ?? Number.MAX_SAFE_INTEGER) -
    (orderByPath.get(rightPath) ?? Number.MAX_SAFE_INTEGER);
}
