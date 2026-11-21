import path from 'node:path';

function appSource(root, fsApi) {
  const file = path.join(root, 'pmo-portal/App.tsx');
  return fsApi.existsSync(file) ? routeTablePaths(fsApi.readFileSync(file, 'utf8')) : [];
}

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
    routePaths: appSource(root, fsApi),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The route paths of `appRouteConfig` in pmo-portal/App.tsx: the app's one route table (#2549). */
export function routeTablePaths(appSource) {
  const start = appSource.indexOf('export const appRouteConfig');
  if (start < 0) throw new Error('could not read appRouteConfig from pmo-portal/App.tsx');
  const end = appSource.indexOf('\n];', start);
  const block = appSource.slice(start, end < 0 ? undefined : end);
  return [...block.matchAll(/\bpath:\s*(['"])(.*?)\1/g)].map((m) => m[2]);
}

/** Split a concrete url into path segments and its query; hash and a trailing slash are dropped. */
function splitRoute(route) {
  const [withoutHash] = route.split('#');
  const queryAt = withoutHash.indexOf('?');
  const pathOnly = queryAt < 0 ? withoutHash : withoutHash.slice(0, queryAt);
  const query = queryAt < 0 ? '' : withoutHash.slice(queryAt);
  const segments = pathOnly.split('/').filter(Boolean);
  return { segments, query };
}

/** Segment-wise match of a route-table path; returns the pattern segments or null. Record-id params (`:id`, `...Id`) become `:id`. */
function matchPath(tablePath, segments) {
  if (tablePath === '*') return null;
  const parts = tablePath.split('/').filter(Boolean);
  if (parts.length !== segments.length) return null;
  const out = [];
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i].startsWith(':')) out.push(/id$/i.test(parts[i]) ? ':id' : segments[i]);
    else if (parts[i] === segments[i]) out.push(segments[i]);
    else return null;
  }
  return out;
}

/**
 * A concrete route as its route pattern (`/work-orders/WO-7` -> `/work-orders/:id`), resolved against the app's
 * route table. Literal routes beat param routes (`/projects/new`); only record-id params collapse to `:id`
 * (lowercase `:id` and camelCase `...Id` alike; a `:tab`/`:kind` value is a different screen and stays);
 * the query is kept, the hash and trailing slash dropped.
 * A route the table does not know falls back to uuid-segment detection.
 */
export function routePatternFor(route, routePaths = []) {
  const { segments, query } = splitRoute(route);
  let best = null;
  let bestLiterals = -1;
  for (const tablePath of routePaths) {
    const matched = matchPath(tablePath, segments);
    if (!matched) continue;
    const literals = tablePath.split('/').filter((s) => s && !s.startsWith(':')).length;
    if (literals > bestLiterals) { best = matched; bestLiterals = literals; }
  }
  const resolved = best ?? segments.map((s) => (UUID.test(s) ? ':id' : s));
  return `/${resolved.join('/')}${query}`;
}

/** Uuid-only normalisation (no route table); kept for callers without one. */
export function routePattern(route) {
  return routePatternFor(route, []);
}

/**
 * The text-baseline key for a route: an exact-url key that already exists wins (every baseline written
 * before #2549), otherwise the route-pattern key, so any record id shares one baseline.
 */
export function baselineKey(budget, route, width, login, routePaths = []) {
  const exact = `${route}@${width}@${login}`;
  if (Object.hasOwn(budget, exact) || Object.hasOwn(budget.targets ?? {}, exact) || Object.hasOwn(budget.charts ?? {}, exact)) return exact;
  return `${routePatternFor(route, routePaths)}@${width}@${login}`;
}
