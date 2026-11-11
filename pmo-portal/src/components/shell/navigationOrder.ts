/** Canonical navigation order shared by the rail and the search destination list. */
export const NAVIGATION_ORDER = [
  '/', '/approvals', '/views',
  '/my-tasks', '/timesheets', '/expenses', '/imprest', '/calendar',
  '/projects', '/procurement', '/stock', '/equipment', '/incidents', '/meetings',
  '/sales', '/companies', '/companies?type=Vendor', '/contacts',
  '/finance', '/finance/receivables', '/finance/payables', '/finance/reports', '/finance/statements',
  '/administration',
] as const;

const orderByPath = new Map<string, number>(NAVIGATION_ORDER.map((path, index) => [path, index]));

export function compareNavigationOrder(leftPath: string, rightPath: string): number {
  return (orderByPath.get(leftPath) ?? Number.MAX_SAFE_INTEGER) -
    (orderByPath.get(rightPath) ?? Number.MAX_SAFE_INTEGER);
}
