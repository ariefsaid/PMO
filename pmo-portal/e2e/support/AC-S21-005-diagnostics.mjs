const ENDPOINT_CATEGORY_BY_PATH = new Map([
  ['/auth/v1/user', 'auth-user'],
  ['/rest/v1/profiles', 'rest-profile'],
  ['/rest/v1/projects', 'rest-project'],
  ['/rest/v1/external_org_bindings', 'rest-org-bindings'],
  ['/rest/v1/external_project_bindings', 'rest-project-bindings'],
  ['/rest/v1/tasks', 'rest-tasks'],
  ['/functions/v1/external-lists', 'function-external-lists'],
]);

const DOM_BOOLEAN_FIELDS = [
  'tasksHeadingVisible',
  'emptyTaskStateVisible',
  'bindingLoadingVisible',
  'compactCardPresent',
  'compactCardUnique',
  'clickupTierCardPresent',
  'bindingErrorVisible',
  'listErrorVisible',
  'listDetailsLoadingVisible',
  'savedListIdentityVisible',
  'initialSourceVisible',
  'pendingTransferNoticeVisible',
];

const MAX_ENDPOINT_EVENTS = 48;

/** Return a fixed category for an exact same-origin endpoint; never return URL material. */
export function classifyS21DiagnosticEndpoint(requestUrl, apiOrigin) {
  if (typeof requestUrl !== 'string' || typeof apiOrigin !== 'string') return null;
  try {
    const url = new URL(requestUrl);
    const expectedOrigin = new URL(apiOrigin).origin;
    if (url.origin !== expectedOrigin || url.username || url.password || url.hash) return null;
    return ENDPOINT_CATEGORY_BY_PATH.get(url.pathname) ?? null;
  } catch {
    return null;
  }
}

/**
 * Accumulate only fixed endpoint categories, HTTP statuses, failure booleans, and named DOM
 * booleans. Raw request/response data and arbitrary DOM properties never enter the snapshot.
 */
export function createS21ReloadDiagnostic() {
  const endpoints = [];
  const record = (category, status, failed) => {
    if (!isEndpointCategory(category) || endpoints.length >= MAX_ENDPOINT_EVENTS) return;
    const safeStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
    if (!failed && safeStatus === null) return;
    endpoints.push({ category, status: safeStatus, failed: failed === true });
  };

  return {
    recordResponse(category, status) {
      record(category, status, false);
    },
    recordFailure(category) {
      record(category, null, true);
    },
    snapshot(dom = {}) {
      const safeDom = {};
      for (const field of DOM_BOOLEAN_FIELDS) safeDom[field] = dom?.[field] === true;
      return {
        dom: safeDom,
        endpoints: endpoints.map(({ category, status, failed }) => ({ category, status, failed })),
      };
    },
  };
}

function isEndpointCategory(value) {
  for (const category of ENDPOINT_CATEGORY_BY_PATH.values()) {
    if (value === category) return true;
  }
  return false;
}
