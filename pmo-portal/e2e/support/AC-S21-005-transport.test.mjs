import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createS21ClickUpFetch,
  createS21BrowserRequestGuard,
  classifyS21BrowserRequest,
  S21_MAX_CLICKUP_GETS,
  validateS21TransportSummary,
} from './AC-S21-005-transport.mjs';

const fixture = {
  supabaseOrigin: 'http://127.0.0.1:54321',
  teamId: 'team_run_1',
  teamName: 'Synthetic Team',
  spaceId: 'space_run_1',
  spaceName: 'Synthetic Space',
  listId: 'list_run_1',
  listName: 'S21 Synthetic Project',
  sentinel: 'synthetic-token-only-in-memory',
};

function request(path, options = {}) {
  return new Request(`https://api.clickup.com/api/v2${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${fixture.sentinel}` },
    ...options,
  });
}

test('synthetic ClickUp transport serves only the seven exact handler GET contracts', async () => {
  const guarded = createS21ClickUpFetch({ ...fixture, fetchImpl: async () => assert.fail('no local call expected') });
  const cases = [
    ['/team', 'teams', fixture.teamId],
    [`/team/${fixture.teamId}/space`, 'spaces', fixture.spaceId],
    [`/space/${fixture.spaceId}/folder`, 'folders', undefined],
    [`/space/${fixture.spaceId}/list`, 'lists', fixture.listId],
    [`/list/${fixture.listId}`, 'name', fixture.listName],
    [`/list/${fixture.listId}/task?page=0&include_closed=true&subtasks=true&archived=true&include_timl=true`, 'tasks', undefined],
    [`/list/${fixture.listId}/member`, 'members', undefined],
  ];

  for (const [path, key, expected] of cases) {
    const response = await guarded.fetch(request(path));
    assert.equal(response.status, 200, path);
    const body = await response.json();
    if (key === 'name') assert.equal(body[key], expected, path);
    else if (expected) assert.equal(body[key][0].id, expected, path);
    else assert.deepEqual(body[key], [], path);
  }

  assert.deepEqual(guarded.snapshot(), {
    clickupGets: cases.length,
    nonGetClickupRequests: 0,
    blockedOutboundRequests: 0,
    nonLocalOutboundRequests: 0,
    responseStatusCounts: { '200': cases.length },
    routeCounts: {
      team: 1,
      spaces: 1,
      folders: 1,
      lists: 1,
      list: 1,
      tasks: 1,
      members: 1,
    },
  });
});

test('synthetic transport rejects non-ClickUp hosts, wrong auth, methods, IDs, paths, and query shapes', async () => {
  let localCalls = 0;
  const guarded = createS21ClickUpFetch({
    ...fixture,
    fetchImpl: async () => {
      localCalls += 1;
      return new Response('local');
    },
  });

  const wrongAuth = request('/team');
  wrongAuth.headers.set('Authorization', 'Bearer different-sentinel');
  const denied = [
    new Request('https://example.invalid/api'),
    wrongAuth,
    request('/team', { method: 'POST' }),
    request('/team/other/space'),
    request(`/space/${fixture.spaceId}/list?unexpected=1`),
    request(`/list/${fixture.listId}/task?page=0`),
    request(`/list/${fixture.listId}/unknown`),
    request(`/list/other`),
  ];

  for (const item of denied) await assert.rejects(guarded.fetch(item), /S21_OUTBOUND_BLOCKED/);
  assert.equal(localCalls, 0);
  assert.equal(guarded.snapshot().clickupGets, 0);
  assert.equal(guarded.snapshot().blockedOutboundRequests, denied.length);
  assert.equal(guarded.snapshot().nonLocalOutboundRequests, 1);
});

test('synthetic transport passes only exact local Supabase requests with redirects disabled', async () => {
  let received;
  const guarded = createS21ClickUpFetch({
    ...fixture,
    fetchImpl: async (input, init) => {
      received = { input, init };
      return new Response('local');
    },
  });

  const response = await guarded.fetch(new Request(`${fixture.supabaseOrigin}/auth/v1/.well-known/jwks.json`));
  assert.equal(await response.text(), 'local');
  assert.equal(new URL(received.input.url).origin, fixture.supabaseOrigin);
  assert.equal(received.input.redirect, 'manual');
  assert.equal(guarded.snapshot().clickupGets, 0);

  const redirectGuard = createS21ClickUpFetch({
    ...fixture,
    fetchImpl: async () => new Response('', { status: 302, headers: { location: 'https://other.invalid/' } }),
  });
  await assert.rejects(
    redirectGuard.fetch(new Request(`${fixture.supabaseOrigin}/auth/v1/redirect-probe`)),
    /S21_OUTBOUND_BLOCKED/,
  );
  assert.equal(redirectGuard.snapshot().blockedOutboundRequests, 1);
});

test('synthetic transport fails closed after the 32nd allowed ClickUp GET', async () => {
  const guarded = createS21ClickUpFetch({ ...fixture, fetchImpl: async () => assert.fail('no local call expected') });
  for (let index = 0; index < S21_MAX_CLICKUP_GETS; index += 1) {
    const response = await guarded.fetch(request('/team'));
    assert.equal(response.status, 200);
  }
  await assert.rejects(guarded.fetch(request('/team')), /S21_CLICKUP_GET_CAP/);
  assert.equal(guarded.snapshot().clickupGets, S21_MAX_CLICKUP_GETS);
  assert.equal(guarded.snapshot().blockedOutboundRequests, 1);
  assert.deepEqual(guarded.snapshot().responseStatusCounts, { '200': S21_MAX_CLICKUP_GETS });
});

test('browser forwarding is limited to POST/OPTIONS on the two exact local functions', () => {
  const appOrigin = 'http://localhost:3000';
  const cases = [
    [`${fixture.supabaseOrigin}/functions/v1/external-lists`, 'POST', { kind: 'forward', path: '/external-lists' }],
    [`${fixture.supabaseOrigin}/functions/v1/external-link`, 'OPTIONS', { kind: 'forward', path: '/external-link' }],
    [`${fixture.supabaseOrigin}/rest/v1/projects`, 'GET', { kind: 'local' }],
    [`${fixture.supabaseOrigin}/functions/v1/clickup-onboard`, 'POST', { kind: 'blocked', reason: 'operator-initializer' }],
    [`${fixture.supabaseOrigin}/functions/v1/clickup-onboard/extra`, 'POST', { kind: 'blocked', reason: 'operator-initializer' }],
    [`${fixture.supabaseOrigin}/functions/v1/external-connect`, 'POST', { kind: 'blocked', reason: 'unowned-function' }],
    [`${fixture.supabaseOrigin}/functions/v1/external-link?redirect=1`, 'POST', { kind: 'blocked', reason: 'unexpected-route-shape' }],
    ['https://api.clickup.com/api/v2/team', 'GET', { kind: 'blocked', reason: 'non-local-origin' }],
    [`${fixture.supabaseOrigin}/functions/v1/external-link`, 'GET', { kind: 'blocked', reason: 'unexpected-method' }],
    [`${appOrigin}/projects/test/tasks`, 'GET', { kind: 'local' }],
  ];

  for (const [url, method, expected] of cases) {
    assert.deepEqual(classifyS21BrowserRequest(url, method, fixture.supabaseOrigin, appOrigin), expected, `${method} ${url}`);
  }
});

test('browser forwarding enforces the 16 handler POST cap and counts the initializer as forbidden', () => {
  const guard = createS21BrowserRequestGuard(fixture.supabaseOrigin, 'http://localhost:3000');
  const target = `${fixture.supabaseOrigin}/functions/v1/external-link`;

  for (let index = 0; index < 16; index += 1) {
    assert.deepEqual(guard.classify(target, 'POST'), { kind: 'forward', path: '/external-link' });
  }
  assert.deepEqual(guard.classify(target, 'POST'), { kind: 'blocked', reason: 'handler-post-cap' });
  assert.deepEqual(
    guard.classify(`${fixture.supabaseOrigin}/functions/v1/clickup-onboard`, 'POST'),
    { kind: 'blocked', reason: 'operator-initializer' },
  );
  assert.deepEqual(
    guard.classify(`${fixture.supabaseOrigin}/functions/v1/clickup-onboard/extra`, 'POST'),
    { kind: 'blocked', reason: 'operator-initializer' },
  );
  assert.deepEqual(guard.snapshot(), { handlerPosts: 16, clickupOnboardRequests: 2 });
});

test('transport summary requires successful bounded handler posts and synthetic ClickUp GETs', () => {
  const summary = {
    event: 'summary',
    handlerPosts: { externalLists: 2, externalLink: 1 },
    handlerResponseStatusCounts: {
      externalLists: { '200': 2 },
      externalLink: { '200': 1 },
    },
    clickup: {
      clickupGets: 7,
      nonGetClickupRequests: 0,
      blockedOutboundRequests: 0,
      nonLocalOutboundRequests: 0,
      responseStatusCounts: { '200': 7 },
      routeCounts: { team: 1, spaces: 1, folders: 1, lists: 1, list: 1, tasks: 1, members: 1 },
    },
  };

  assert.deepEqual(validateS21TransportSummary(summary), { handlerPosts: 3, clickupGets: 7 });
  assert.throws(
    () => validateS21TransportSummary({ ...summary, clickup: { ...summary.clickup, blockedOutboundRequests: 1 } }),
    /S21_TRANSPORT_POLICY_VIOLATION/,
  );
  assert.throws(
    () => validateS21TransportSummary({ ...summary, handlerResponseStatusCounts: { ...summary.handlerResponseStatusCounts, externalLink: { '500': 1 } } }),
    /S21_HANDLER_RESPONSE_NOT_SUCCESSFUL/,
  );
  assert.throws(
    () => validateS21TransportSummary({ ...summary, clickup: { ...summary.clickup, clickupGets: S21_MAX_CLICKUP_GETS + 1 } }),
    /S21_CLICKUP_GET_CAP_EXCEEDED/,
  );
  assert.throws(
    () => validateS21TransportSummary({ ...summary, handlerPosts: { externalLists: 17, externalLink: 1 } }),
    /S21_HANDLER_POST_CAP_EXCEEDED/,
  );
  assert.throws(
    () => validateS21TransportSummary({ ...summary, clickup: { ...summary.clickup, routeCounts: { ...summary.clickup.routeCounts, tasks: 0 } } }),
    /S21_TRANSPORT_SUMMARY_INVALID/,
  );
});

test('failed journey validates list transport without requiring a link POST', () => {
  const summary = {
    event: 'summary',
    handlerPosts: { externalLists: 1, externalLink: 0 },
    handlerResponseStatusCounts: {
      externalLists: { '200': 1 },
      externalLink: {},
    },
    clickup: {
      clickupGets: 4,
      nonGetClickupRequests: 0,
      blockedOutboundRequests: 0,
      nonLocalOutboundRequests: 0,
      responseStatusCounts: { '200': 4 },
      routeCounts: { team: 1, spaces: 1, folders: 1, lists: 1, list: 0, tasks: 0, members: 0 },
    },
  };

  assert.throws(() => validateS21TransportSummary(summary), /S21_TRANSPORT_SUMMARY_INVALID/);
  assert.deepEqual(validateS21TransportSummary(summary, { requireLink: false }), { handlerPosts: 1, clickupGets: 4 });
});
