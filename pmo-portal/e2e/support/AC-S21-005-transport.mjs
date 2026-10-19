export const S21_MAX_CLICKUP_GETS = 32;
export const S21_MAX_HANDLER_POSTS = 16;

const CLICKUP_ROUTE_KEYS = ['team', 'spaces', 'folders', 'lists', 'list', 'tasks', 'members'];

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Preserves the whole-journey browser policy when an ordered journey uses fresh pages.
 * @param {Array<{snapshot: {handlerPosts: number, clickupOnboardRequests: number}, blocked: Record<string, number>}>} guards
 * @returns {{handlerPosts: number, clickupOnboardRequests: number, blocked: Record<string, number>}}
 */
export function aggregateS21BrowserGuardSnapshots(guards) {
  if (!Array.isArray(guards) || guards.length === 0) throw new Error('S21_BROWSER_GUARD_SNAPSHOT_INVALID');

  const aggregate = { handlerPosts: 0, clickupOnboardRequests: 0, blocked: {} };
  for (const guard of guards) {
    if (!isRecord(guard) || !isRecord(guard.snapshot) || !isRecord(guard.blocked)) {
      throw new Error('S21_BROWSER_GUARD_SNAPSHOT_INVALID');
    }
    const { handlerPosts, clickupOnboardRequests } = guard.snapshot;
    if (!Number.isSafeInteger(handlerPosts) || handlerPosts < 0 ||
        !Number.isSafeInteger(clickupOnboardRequests) || clickupOnboardRequests < 0) {
      throw new Error('S21_BROWSER_GUARD_SNAPSHOT_INVALID');
    }
    aggregate.handlerPosts += handlerPosts;
    aggregate.clickupOnboardRequests += clickupOnboardRequests;
    for (const [reason, count] of Object.entries(guard.blocked)) {
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('S21_BROWSER_GUARD_SNAPSHOT_INVALID');
      aggregate.blocked[reason] = (aggregate.blocked[reason] ?? 0) + count;
    }
  }
  if (!Number.isSafeInteger(aggregate.handlerPosts) || !Number.isSafeInteger(aggregate.clickupOnboardRequests) ||
      Object.values(aggregate.blocked).some((count) => !Number.isSafeInteger(count))) {
    throw new Error('S21_BROWSER_GUARD_SNAPSHOT_INVALID');
  }
  if (aggregate.handlerPosts > S21_MAX_HANDLER_POSTS) throw new Error('S21_HANDLER_POST_CAP_EXCEEDED');
  return aggregate;
}

/** @param {unknown} counts @param {boolean} requireSuccess */
function successfulStatusCount(counts, requireSuccess) {
  if (!isRecord(counts)) return null;
  let total = 0;
  for (const [status, count] of Object.entries(counts)) {
    if (!/^2\d\d$/.test(status) || !Number.isSafeInteger(count) || count < 0) return null;
    total += count;
  }
  if (!Number.isSafeInteger(total) || (requireSuccess && total === 0)) return null;
  return total;
}

/**
 * Validates the actual Deno child summary before the journey records transport as proven.
 * @param {unknown} summary
 * @param {{requireLink?: boolean}} [options]
 * @returns {{handlerPosts: number, clickupGets: number}}
 */
export function validateS21TransportSummary(summary, { requireLink = true } = {}) {
  if (!isRecord(summary) || summary.event !== 'summary' || !isRecord(summary.handlerPosts) ||
      !isRecord(summary.handlerResponseStatusCounts) || !isRecord(summary.clickup)) {
    throw new Error('S21_TRANSPORT_SUMMARY_INVALID');
  }

  const externalLists = summary.handlerPosts.externalLists;
  const externalLink = summary.handlerPosts.externalLink;
  const handlerPosts = externalLists + externalLink;
  if (!Number.isSafeInteger(externalLists) || !Number.isSafeInteger(externalLink) ||
      externalLists < 1 || externalLink < (requireLink ? 1 : 0)) {
    throw new Error('S21_TRANSPORT_SUMMARY_INVALID');
  }
  if (handlerPosts > S21_MAX_HANDLER_POSTS) throw new Error('S21_HANDLER_POST_CAP_EXCEEDED');

  const listStatuses = successfulStatusCount(summary.handlerResponseStatusCounts.externalLists, true);
  const linkStatuses = successfulStatusCount(summary.handlerResponseStatusCounts.externalLink, requireLink);
  if (listStatuses === null || linkStatuses === null || listStatuses !== externalLists || linkStatuses !== externalLink) {
    throw new Error('S21_HANDLER_RESPONSE_NOT_SUCCESSFUL');
  }

  const clickup = summary.clickup;
  const { clickupGets, nonGetClickupRequests, blockedOutboundRequests, nonLocalOutboundRequests } = clickup;
  if (!Number.isSafeInteger(clickupGets) || clickupGets < 1) throw new Error('S21_TRANSPORT_SUMMARY_INVALID');
  if (clickupGets > S21_MAX_CLICKUP_GETS) throw new Error('S21_CLICKUP_GET_CAP_EXCEEDED');
  if (nonGetClickupRequests !== 0 || blockedOutboundRequests !== 0 || nonLocalOutboundRequests !== 0) {
    throw new Error('S21_TRANSPORT_POLICY_VIOLATION');
  }
  if (!isRecord(clickup.routeCounts) ||
      Object.keys(clickup.routeCounts).sort().join(',') !== CLICKUP_ROUTE_KEYS.slice().sort().join(',')) {
    throw new Error('S21_TRANSPORT_SUMMARY_INVALID');
  }
  const routeTotal = Object.values(clickup.routeCounts).reduce((sum, count) => {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('S21_TRANSPORT_SUMMARY_INVALID');
    return sum + count;
  }, 0);
  const clickupStatuses = successfulStatusCount(clickup.responseStatusCounts, true);
  if (routeTotal !== clickupGets || clickupStatuses !== clickupGets) {
    throw new Error('S21_TRANSPORT_SUMMARY_INVALID');
  }
  return { handlerPosts, clickupGets };
}

const CLICKUP_ORIGIN = 'https://api.clickup.com';
const CLICKUP_BASE_PATH = '/api/v2';
const TASK_QUERY = '?page=0&include_closed=true&subtasks=true&archived=true&include_timl=true';

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function clickUpBody(pathname, search, fixture) {
  const relativePath = pathname.slice(CLICKUP_BASE_PATH.length);
  if (search !== '') {
    if (relativePath === `/list/${fixture.listId}/task` && search === TASK_QUERY) {
      return ['tasks', { tasks: [] }];
    }
    return null;
  }

  if (relativePath === '/team') {
    return ['team', { teams: [{ id: fixture.teamId, name: fixture.teamName }] }];
  }
  if (relativePath === `/team/${fixture.teamId}/space`) {
    return ['spaces', { spaces: [{ id: fixture.spaceId, name: fixture.spaceName }] }];
  }
  if (relativePath === `/space/${fixture.spaceId}/folder`) return ['folders', { folders: [] }];
  if (relativePath === `/space/${fixture.spaceId}/list`) {
    return ['lists', {
      lists: [{ id: fixture.listId, name: fixture.listName, folder_id: null, space_id: fixture.spaceId }],
    }];
  }
  if (relativePath === `/list/${fixture.listId}`) {
    return ['list', {
      id: fixture.listId,
      name: fixture.listName,
      statuses: [
        { status: 'to do', type: 'open', orderindex: 0 },
        { status: 'in progress', type: 'custom', orderindex: 1 },
        { status: 'complete', type: 'done', orderindex: 2 },
      ],
    }];
  }
  if (relativePath === `/list/${fixture.listId}/member`) return ['members', { members: [] }];
  return null;
}

/**
 * Wraps the unchanged shipped handlers' global fetch. Local Supabase traffic passes to the
 * original fetch with redirects disabled. ClickUp traffic receives only this run's synthetic
 * GET fixtures. Every other destination, method, identity, query, or redirect fails closed.
 */
export function createS21ClickUpFetch({
  supabaseOrigin,
  teamId,
  teamName,
  spaceId,
  spaceName,
  listId,
  listName,
  sentinel,
  fetchImpl = globalThis.fetch,
}) {
  const localOrigin = new URL(supabaseOrigin).origin;
  if (typeof fetchImpl !== 'function' || !sentinel) throw new Error('S21_TRANSPORT_CONFIGURATION_INVALID');

  let clickupGets = 0;
  let nonGetClickupRequests = 0;
  let blockedOutboundRequests = 0;
  let nonLocalOutboundRequests = 0;
  const responseStatusCounts = {};
  const routeCounts = {
    team: 0,
    spaces: 0,
    folders: 0,
    lists: 0,
    list: 0,
    tasks: 0,
    members: 0,
  };
  const deny = (nonLocal = false) => {
    blockedOutboundRequests += 1;
    if (nonLocal) nonLocalOutboundRequests += 1;
    throw new Error('S21_OUTBOUND_BLOCKED');
  };

  const fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);

    if (url.origin === localOrigin) {
      if (url.hash) return deny();
      const localRequest = new Request(request, { redirect: 'manual' });
      const response = await fetchImpl(localRequest);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        const redirectedOutside = location && new URL(location, url).origin !== localOrigin;
        return deny(Boolean(redirectedOutside));
      }
      if (response.url) {
        const responseOrigin = new URL(response.url).origin;
        if (responseOrigin !== localOrigin) return deny(true);
      }
      return response;
    }

    if (url.origin !== CLICKUP_ORIGIN || url.protocol !== 'https:' || url.hash) return deny(true);
    if (request.method !== 'GET' || request.body !== null) {
      nonGetClickupRequests += 1;
      return deny();
    }
    if (request.headers.get('authorization') !== `Bearer ${sentinel}`) return deny();

    const pathname = url.pathname;
    if (!pathname.startsWith(`${CLICKUP_BASE_PATH}/`)) return deny();
    const result = clickUpBody(pathname, url.search, {
      teamId,
      teamName,
      spaceId,
      spaceName,
      listId,
      listName,
    });
    if (!result) return deny();

    if (clickupGets >= S21_MAX_CLICKUP_GETS) {
      blockedOutboundRequests += 1;
      throw new Error('S21_CLICKUP_GET_CAP');
    }
    clickupGets += 1;
    routeCounts[result[0]] += 1;
    responseStatusCounts['200'] = (responseStatusCounts['200'] ?? 0) + 1;
    return jsonResponse(result[1]);
  };

  return {
    fetch,
    snapshot: () => ({
      clickupGets,
      nonGetClickupRequests,
      blockedOutboundRequests,
      nonLocalOutboundRequests,
      responseStatusCounts: { ...responseStatusCounts },
      routeCounts: { ...routeCounts },
    }),
  };
}

/** @param {string} requestUrl @param {string} method @param {string} supabaseOrigin @param {string | null} [appOrigin=null] */
export function classifyS21BrowserRequest(requestUrl, method, supabaseOrigin, appOrigin = null) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return { kind: 'blocked', reason: 'invalid-url' };
  }

  const localSupabaseOrigin = new URL(supabaseOrigin).origin;
  if (appOrigin && url.origin === new URL(appOrigin).origin) return { kind: 'local' };
  if (url.origin !== localSupabaseOrigin) {
    return { kind: 'blocked', reason: 'non-local-origin' };
  }
  if (
    url.pathname === '/functions/v1/clickup-onboard' ||
    url.pathname.startsWith('/functions/v1/clickup-onboard/')
  ) {
    return { kind: 'blocked', reason: 'operator-initializer' };
  }
  if (url.pathname.startsWith('/functions/v1/')) {
    const pathByName = {
      '/functions/v1/external-lists': '/external-lists',
      '/functions/v1/external-link': '/external-link',
    };
    const targetPath = pathByName[url.pathname];
    if (!targetPath) return { kind: 'blocked', reason: 'unowned-function' };
    if (url.search || url.hash) return { kind: 'blocked', reason: 'unexpected-route-shape' };
    if (method !== 'POST' && method !== 'OPTIONS') return { kind: 'blocked', reason: 'unexpected-method' };
    return { kind: 'forward', path: targetPath };
  }
  if (url.hash) return { kind: 'blocked', reason: 'unexpected-route-shape' };
  return { kind: 'local' };
}

/** @param {string} supabaseOrigin @param {string | null} [appOrigin=null] */
export function createS21BrowserRequestGuard(supabaseOrigin, appOrigin = null) {
  let handlerPosts = 0;
  let clickupOnboardRequests = 0;

  return {
    classify(requestUrl, method) {
      const result = classifyS21BrowserRequest(requestUrl, method, supabaseOrigin, appOrigin);
      if (result.reason === 'operator-initializer') clickupOnboardRequests += 1;
      if (result.kind === 'forward' && method === 'POST') {
        if (handlerPosts >= S21_MAX_HANDLER_POSTS) return { kind: 'blocked', reason: 'handler-post-cap' };
        handlerPosts += 1;
      }
      return result;
    },
    snapshot: () => ({ handlerPosts, clickupOnboardRequests }),
  };
}
