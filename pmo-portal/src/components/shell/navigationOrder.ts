/** Canonical navigation order shared by the rail and the search destination list. */
export const NAVIGATION_ORDER = [
  '/approvals', '/',
  '/sales', '/companies', '/contacts',
  '/projects', '/procurement', '/stock', '/equipment', '/crews', '/companies?type=Vendor', '/incidents', '/meetings', '/calendar',
  '/finance', '/finance/receivables', '/finance/payables', '/finance/reports', '/finance/statements', '/journals',
  '/timesheets', '/expenses', '/imprest', '/my-tasks', '/views',
  '/administration',
] as const;

const orderByPath = new Map<string, number>(NAVIGATION_ORDER.map((path, index) => [path, index]));

export function compareNavigationOrder(leftPath: string, rightPath: string): number {
  return (orderByPath.get(leftPath) ?? Number.MAX_SAFE_INTEGER) -
    (orderByPath.get(rightPath) ?? Number.MAX_SAFE_INTEGER);
}

/** The rail's headed sections. */
export type NavigationGroup = 'My work' | 'Delivery' | 'Sales' | 'Finance';

/**
 * Each role reads its menu in the order it works: an engineer's site work first, finance's money
 * first. The order is fixed per role (never re-sorted by use), and a group the role does not see is
 * simply absent. Gates only ever remove entries; this table only orders what is left.
 */
export const ROLE_GROUP_ORDER: Record<string, readonly NavigationGroup[]> = {
  Engineer: ['Delivery', 'My work'],
  'Project Manager': ['Delivery', 'My work', 'Sales'],
  Finance: ['Finance', 'Delivery', 'My work', 'Sales'],
  Executive: ['Finance', 'Sales', 'Delivery', 'My work'],
  Admin: ['Delivery', 'Sales', 'Finance', 'My work'],
};

const DEFAULT_GROUP_ORDER: readonly NavigationGroup[] = ['Delivery', 'Sales', 'Finance', 'My work'];

export function groupOrderForRole(role: string | null | undefined): readonly NavigationGroup[] {
  return (role && ROLE_GROUP_ORDER[role]) || DEFAULT_GROUP_ORDER;
}

/**
 * Phone bar: Home, then the role's most-used destinations in thumb reach (first one the role can
 * open wins each slot), then Search and More. At most three destinations, so five slots in all.
 */
export const ROLE_PHONE_DESTINATIONS: Record<string, readonly string[]> = {
  Engineer: ['/approvals', '/my-tasks', '/timesheets', '/projects'],
  'Project Manager': ['/approvals', '/projects', '/my-tasks'],
  Finance: ['/approvals', '/finance', '/my-tasks'],
  Executive: ['/approvals', '/finance', '/projects'],
  Admin: ['/approvals', '/projects', '/my-tasks'],
};

export const PHONE_DESTINATION_SLOTS = 2;
