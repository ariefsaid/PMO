/** Canonical navigation order shared by the rail and the search destination list. */
export const NAVIGATION_ORDER = [
  '/approvals', '/',
  '/sales', '/companies', '/contacts',
  '/projects', '/work-orders', '/procurement', '/stock', '/equipment', '/equipment/assets', '/safety', '/site-reports', '/crews', '/leave', '/companies?type=Vendor', '/incidents', '/meetings', '/calendar',
  '/finance', '/finance/billing-board', '/finance/receivables', '/finance/payables', '/finance/reports', '/finance/statements', '/journals',
  '/timesheets', '/expenses', '/imprest', '/material-requests', '/my-tasks', '/views',
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

/**
 * A person's function (the built-in role's `functionKey`) refines the access level's order: the menu
 * is ordered by what that person does daily, and a function lists ONLY the groups it uses. HR never
 * sees Sales or Finance headings; a storekeeper opens on stock, not on the sales pipeline.
 */
export const FUNCTION_GROUP_ORDER: Record<string, readonly NavigationGroup[]> = {
  hr: ['My work', 'Delivery'],
  safety: ['Delivery', 'My work'],
  equipment: ['Delivery', 'My work'],
  materials: ['Delivery', 'My work'],
  construction: ['Delivery', 'My work'],
  field: ['My work', 'Delivery'],
};

/** Inside a group the function's own places come first, then the registry order. */
export const FUNCTION_ITEM_PRIORITY: Record<string, readonly string[]> = {
  hr: ['/leave', '/crews', '/timesheets', '/expenses'],
  safety: ['/safety', '/incidents', '/site-reports'],
  equipment: ['/equipment', '/equipment/assets'],
  materials: ['/stock', '/material-requests', '/procurement'],
  construction: ['/site-reports', '/crews', '/work-orders'],
};

export function groupOrderForRole(role: string | null | undefined, functionKey?: string | null): readonly NavigationGroup[] {
  return (functionKey && FUNCTION_GROUP_ORDER[functionKey]) || (role && ROLE_GROUP_ORDER[role]) || DEFAULT_GROUP_ORDER;
}

/** Sort key for an item inside its group for this function: priority places first, the rest keep registry order. */
export function functionItemRank(functionKey: string | null | undefined, path: string): number {
  const index = functionKey ? FUNCTION_ITEM_PRIORITY[functionKey]?.indexOf(path) ?? -1 : -1;
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
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
