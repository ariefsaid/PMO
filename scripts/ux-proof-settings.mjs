import path from 'node:path';

/** Read the proof baselines only for modes that consume them. */
export function loadProofSettings({ root, rulesOnly, fsApi }) {
  if (rulesOnly) return { budget: { targets: {} }, layoutBaseline: {} };

  const readJson = (relativePath) => {
    const file = path.join(root, relativePath);
    return fsApi.existsSync(file) ? JSON.parse(fsApi.readFileSync(file, 'utf8')) : {};
  };
  const budget = readJson('docs/ux/word-budget.json');
  budget.targets ||= {};
  return {
    budget,
    layoutBaseline: readJson('docs/ux/layout-baseline.json'),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A route with record ids normalised (`/work-orders/<uuid>` -> `/work-orders/:id`); query retained, hash dropped. */
export function routePattern(route) {
  const [withoutHash] = route.split('#');
  const queryAt = withoutHash.indexOf('?');
  const pathOnly = queryAt < 0 ? withoutHash : withoutHash.slice(0, queryAt);
  const query = queryAt < 0 ? '' : withoutHash.slice(queryAt);
  return pathOnly.split('/').map((segment) => (UUID.test(segment) ? ':id' : segment)).join('/') + query;
}

/**
 * The text-baseline key for a route: an exact-url key that already exists wins (every baseline written
 * before #2549), otherwise the route-pattern key, so any record id shares one baseline.
 */
export function baselineKey(budget, route, width, login) {
  const exact = `${route}@${width}@${login}`;
  if (Object.hasOwn(budget, exact) || Object.hasOwn(budget.targets ?? {}, exact) || Object.hasOwn(budget.charts ?? {}, exact)) return exact;
  return `${routePattern(route)}@${width}@${login}`;
}
